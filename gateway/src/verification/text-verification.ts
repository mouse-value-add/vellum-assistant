/**
 * Gateway-owned text-channel verification intercept.
 *
 * Called from handleInbound before forwardToRuntime. When a message is a
 * bare verification code AND there is a pending/active session for this
 * channel, the gateway handles the entire flow:
 *
 *   1. Parse code from message content
 *   2. Check rate limits
 *   3. Hash + find matching session
 *   4. Verify identity binding (outbound sessions)
 *   5. Consume the session, apply its grant (guardian binding OR trusted
 *      contact), and owe the reply, in one gateway transaction
 *   6. Deliver deterministic reply
 *
 * The assistant NEVER sees verification code messages. Both success and
 * failure are short-circuited at the gateway.
 */

import {
  applyGuardianBindingGatewayWrites,
  mirrorGuardianBinding,
} from "../auth/guardian-bootstrap.js";
import { getGatewayDb } from "../db/connection.js";
import {
  newOwedReplyId,
  recordOwedReply,
} from "../db/gateway-reply-outbox-store.js";
import {
  consumeSession,
  findPendingSessionByHash,
  hasInterceptableSession,
} from "../db/session-store.js";
import { getLogger } from "../logger.js";

import {
  getExistingGuardianBinding,
  resolveCanonicalPrincipal,
  revokeExistingChannelGuardian,
} from "./binding-helpers.js";
import {
  extractEmailReplyBody,
  parseVerificationCode,
  hashVerificationSecret,
} from "./code-parsing.js";
import {
  applyVerifiedChannelGatewayWrites,
  type ContactChannelRow,
  gatewayChannelStatus,
  mirrorCommittedGrant,
  mirrorVerifiedChannel,
  readMirrorChannelSoftly,
} from "./contact-helpers.js";
import { canonicalizeInboundIdentity } from "./identity.js";
import { checkIdentityMatch } from "./identity-match.js";
import {
  isRateLimited,
  recordInvalidAttempt,
  resetRateLimit,
} from "./rate-limit-helpers.js";
import {
  composeVerificationFailureReply,
  composeVerificationSuccessReply,
  deliverOwedReply,
  sendGatewayReply,
} from "./reply-delivery.js";

const log = getLogger("text-verification");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TextVerificationInterceptParams {
  sourceChannel: string;
  messageContent: string;
  actorExternalUserId: string;
  actorChatId: string;
  /** The wire-proven readership fact, when the channel states one. */
  isDirectMessage?: boolean;
  actorDisplayName?: string;
  actorUsername?: string;
  replyCallbackUrl?: string;
  assistantId?: string;
}

export type TextVerificationResult =
  | { intercepted: false }
  | {
      intercepted: true;
      outcome: "verified" | "failed" | "wrong_conversation";
      trustClass: "guardian" | "trusted_contact";
      /** Reply text when replyCallbackUrl was unavailable (e.g. email channel). */
      pendingReplyText?: string;
    };

// ---------------------------------------------------------------------------
// Main intercept
// ---------------------------------------------------------------------------

export async function tryTextVerificationIntercept(
  params: TextVerificationInterceptParams,
): Promise<TextVerificationResult> {
  const {
    sourceChannel,
    messageContent,
    actorExternalUserId,
    actorChatId,
    isDirectMessage,
    actorDisplayName,
    actorUsername,
    replyCallbackUrl,
    assistantId,
  } = params;

  // 1. Parse — only bare 6-digit numeric or 64-char hex codes are intercepted.
  //    For email, strip quoted reply content first so the code isn't buried
  //    under signatures and quoted thread text.
  const effectiveContent =
    sourceChannel === "email"
      ? extractEmailReplyBody(messageContent)
      : messageContent;
  const code = parseVerificationCode(effectiveContent);
  if (code === undefined) {
    return { intercepted: false };
  }

  // 2. Fast guard — is there any pending session for this channel?
  if (!hasInterceptableSession(sourceChannel)) {
    return { intercepted: false };
  }

  // 2b. Lane guard. A verification code completes only where one reader
  // exists: the copy that carried it said "reply here" in a direct message,
  // and a code posted into a room was already shown to everyone in it. The
  // message is still intercepted, so the code never reaches the assistant
  // or the transcript, but it is never redeemed, and the reply says where
  // to send it without saying whether it was valid. Keyed on the wire's
  // readership fact rather than its visibility axis, because Discord can
  // prove a guild message is not a DM while proving nothing about the
  // room's visibility; a channel that states nothing (or a true DM) is
  // unaffected.
  if (isDirectMessage === false) {
    log.info(
      { sourceChannel },
      "Verification code arrived outside a direct message; not redeemed",
    );
    const pendingReplyText = await replyWithFailure(
      replyCallbackUrl,
      actorChatId,
      assistantId,
      "For security, verification codes only work in a direct message. Send it to me there.",
    );
    return {
      intercepted: true,
      outcome: "wrong_conversation",
      trustClass: "guardian",
      pendingReplyText,
    };
  }

  const canonicalUserId =
    canonicalizeInboundIdentity(sourceChannel, actorExternalUserId) ??
    actorExternalUserId;

  // 3. Rate limit check
  if (isRateLimited(sourceChannel, canonicalUserId, actorChatId)) {
    log.info(
      { sourceChannel, actorExternalUserId: canonicalUserId },
      "Verification attempt rate-limited",
    );
    const pendingReplyText = await replyWithFailure(
      replyCallbackUrl,
      actorChatId,
      assistantId,
      "The verification code is invalid or has expired.",
    );
    return {
      intercepted: true,
      outcome: "failed",
      trustClass: "guardian",
      pendingReplyText,
    };
  }

  // 4. Hash + find session
  const challengeHash = hashVerificationSecret(code);
  const session = findPendingSessionByHash(sourceChannel, challengeHash);

  if (!session) {
    await recordInvalidAttempt(sourceChannel, canonicalUserId, actorChatId);
    log.info(
      { sourceChannel, actorExternalUserId: canonicalUserId },
      "Verification code did not match any pending session",
    );
    const pendingReplyText = await replyWithFailure(
      replyCallbackUrl,
      actorChatId,
      assistantId,
      "The verification code is invalid or has expired.",
    );
    return {
      intercepted: true,
      outcome: "failed",
      trustClass: "guardian",
      pendingReplyText,
    };
  }

  // 5. Identity binding check (outbound sessions)
  if (!checkIdentityMatch(session, canonicalUserId, actorChatId)) {
    await recordInvalidAttempt(sourceChannel, canonicalUserId, actorChatId);
    log.info(
      { sourceChannel, sessionId: session.id },
      "Verification identity mismatch (anti-oracle: same error as invalid code)",
    );
    const pendingReplyText = await replyWithFailure(
      replyCallbackUrl,
      actorChatId,
      assistantId,
      "The verification code is invalid or has expired.",
    );
    return {
      intercepted: true,
      outcome: "failed",
      trustClass:
        session.verificationPurpose === "trusted_contact"
          ? "trusted_contact"
          : "guardian",
      pendingReplyText,
    };
  }

  const purpose: "guardian" | "trusted_contact" =
    session.verificationPurpose === "trusted_contact"
      ? "trusted_contact"
      : "guardian";
  const mirror = await readMirrorChannelSoftly(sourceChannel, canonicalUserId);
  const grantParams: VerificationGrantParams = {
    sourceChannel,
    canonicalUserId,
    actorChatId,
    actorUsername,
    displayName: verifiedDisplayName(mirror, {
      canonicalUserId,
      actorDisplayName,
      actorUsername,
    }),
    mirror,
  };
  const owedReplyId = replyCallbackUrl ? newOwedReplyId() : undefined;

  // 5. Consume the session and apply its grant in one gateway transaction,
  //    with the success reply recorded as owed inside it: the consume is
  //    status-guarded, so only the first consumer wins; a grant never lands
  //    without the reply announcing it; and a thrown write rolls the consume
  //    back, so the code stays redeemable when the provider retries. A
  //    blocked/revoked authoritative gateway row refuses the grant: the actor
  //    must not regain trusted status nor see a success reply, and the code
  //    is still spent.
  const committed = getGatewayDb().transaction(() => {
    const { consumed } = consumeSession(
      session.id,
      canonicalUserId,
      actorChatId,
    );
    if (!consumed) {
      return { consumed: false as const };
    }
    const grant =
      purpose === "guardian"
        ? applyGuardianGrantWrites(grantParams)
        : applyTrustedContactGrantWrites(grantParams);
    if (grant && replyCallbackUrl && owedReplyId) {
      recordOwedReply(owedReplyId, {
        callbackUrl: replyCallbackUrl,
        chatId: actorChatId,
        text: composeVerificationSuccessReply(grant.role),
        assistantId,
      });
    }
    return { consumed: true as const, grant };
  });

  if (!committed.consumed) {
    log.warn(
      { sessionId: session.id },
      "Session already consumed by concurrent request",
    );
    const pendingReplyText = await replyWithFailure(
      replyCallbackUrl,
      actorChatId,
      assistantId,
      "The verification code is invalid or has expired.",
    );
    return {
      intercepted: true,
      outcome: "failed",
      trustClass: purpose,
      pendingReplyText,
    };
  }

  // Reset rate limits on success
  await resetRateLimit(sourceChannel, canonicalUserId, actorChatId);

  const { grant } = committed;
  if (!grant) {
    log.warn(
      { sourceChannel, actorExternalUserId: canonicalUserId, purpose },
      "Verification rejected: authoritative gateway channel is blocked/revoked",
    );
    const pendingReplyText = await replyWithFailure(
      replyCallbackUrl,
      actorChatId,
      assistantId,
      "The verification code is invalid or has expired.",
    );
    return {
      intercepted: true,
      outcome: "failed",
      trustClass: purpose,
      pendingReplyText,
    };
  }

  await mirrorCommittedGrant(grant.postCommit);

  // 6. Deliver success reply
  let pendingReplyText: string | undefined;
  if (owedReplyId) {
    await deliverOwedReply(owedReplyId);
  } else {
    pendingReplyText = composeVerificationSuccessReply(grant.role);
  }

  log.info(
    {
      sourceChannel,
      actorExternalUserId: canonicalUserId,
      trustClass: grant.role,
      sessionId: session.id,
    },
    "Text verification succeeded",
  );

  return {
    intercepted: true,
    outcome: "verified",
    trustClass: grant.role,
    pendingReplyText,
  };
}

// ---------------------------------------------------------------------------
// Grants
// ---------------------------------------------------------------------------

/** What a consumed code granted, and the mirror update that follows it. */
interface VerificationGrant {
  role: "guardian" | "trusted_contact";
  postCommit: () => Promise<void>;
}

/** The sender and chat a consumed code grants access to. */
interface VerificationGrantParams {
  sourceChannel: string;
  canonicalUserId: string;
  actorChatId: string;
  actorUsername?: string;
  displayName: string;
  /** The assistant mirror's view of the channel, read before the grant. */
  mirror: ContactChannelRow | null;
}

/**
 * The name a verified sender is recorded under: the assistant mirror's
 * curated name when the channel already has one, otherwise the platform's.
 */
export function verifiedDisplayName(
  mirror: ContactChannelRow | null,
  sender: {
    canonicalUserId: string;
    actorDisplayName?: string;
    actorUsername?: string;
  },
): string {
  return mirror?.displayName?.trim().length
    ? mirror.displayName
    : (sender.actorDisplayName ??
        sender.actorUsername ??
        sender.canonicalUserId);
}

/**
 * Trusted-contact grant for a consumed code: the verified-channel gateway
 * writes, composed inside the consume's transaction. Shared with the
 * session service's validate+consume path so the write has exactly one
 * implementation. Returns null when the authoritative gateway row is
 * blocked or revoked.
 */
export function applyTrustedContactGrantWrites(
  params: VerificationGrantParams,
): VerificationGrant | null {
  const result = applyVerifiedChannelGatewayWrites({
    sourceChannel: params.sourceChannel,
    externalUserId: params.canonicalUserId,
    externalChatId: params.actorChatId,
    displayName: params.displayName,
    username: params.actorUsername,
    existingMirrorChannel: params.mirror
      ? {
          channelId: params.mirror.channelId,
          contactId: params.mirror.contactId,
        }
      : null,
  });
  if (!result.verified) {
    return null;
  }
  return {
    role: "trusted_contact",
    postCommit: () => mirrorVerifiedChannel(result.mirror),
  };
}

/**
 * Guardian grant for a consumed code, composed inside the consume's
 * transaction. When another sender already guards the channel, this sender
 * becomes a trusted contact instead, and the grant says so.
 */
function applyGuardianGrantWrites(
  params: VerificationGrantParams,
): VerificationGrant | null {
  const { sourceChannel, canonicalUserId } = params;

  const existing = getExistingGuardianBinding(sourceChannel);
  if (existing?.address && existing.address !== canonicalUserId) {
    log.warn(
      {
        sourceChannel,
        existingGuardian: existing.address,
        newActor: canonicalUserId,
      },
      "Guardian binding conflict: another user already holds this channel",
    );
    return applyTrustedContactGrantWrites(params);
  }

  // The gateway is the source of truth: a blocked/revoked gateway row rejects
  // the binding. Check BEFORE the same-user revoke below so a legitimately
  // re-verifying guardian (whose current row is active) isn't blocked by their
  // own about-to-be-revoked row. The binding writes "active" unconditionally,
  // so this guard is the only thing stopping a blocked actor.
  const gwStatus = gatewayChannelStatus(sourceChannel, canonicalUserId);
  if (gwStatus === "blocked" || gwStatus === "revoked") {
    log.warn(
      { sourceChannel, address: canonicalUserId, status: gwStatus },
      "Skipping guardian binding: authoritative gateway channel is blocked or revoked",
    );
    return null;
  }

  // Same-user re-verification replaces the current binding; the revoke and
  // the new binding commit together.
  revokeExistingChannelGuardian(sourceChannel);
  const writes = applyGuardianBindingGatewayWrites({
    channel: sourceChannel,
    externalUserId: canonicalUserId,
    deliveryChatId: params.actorChatId,
    guardianPrincipalId: resolveCanonicalPrincipal(canonicalUserId),
    displayName: params.displayName,
    verifiedVia: "challenge",
    reactivateRevoked: true,
  });
  return { role: "guardian", postCommit: () => mirrorGuardianBinding(writes) };
}

// ---------------------------------------------------------------------------
// Reply helpers
// ---------------------------------------------------------------------------

async function replyWithFailure(
  replyCallbackUrl: string | undefined,
  chatId: string,
  assistantId: string | undefined,
  reason: string,
): Promise<string | undefined> {
  const text = composeVerificationFailureReply(reason);
  if (!replyCallbackUrl) return text;
  await sendGatewayReply({
    callbackUrl: replyCallbackUrl,
    chatId,
    text,
    assistantId,
  });
  return undefined;
}
