/**
 * Delivery of the replies the gateway composes for messages it answers at
 * ingress (a verification code, an invite redemption).
 *
 * The gateway composes the reply and never sends to a provider itself: it
 * hands the reply to the daemon's channel transport for the chat the answered
 * message came from, over the `deliver_gateway_reply` IPC method. The
 * assistant never sees the message being answered.
 *
 * Every reply is owed before it is sent. It is recorded in the gateway reply
 * outbox (`db/gateway-reply-outbox-store.ts`), in the same transaction as the
 * grant when it announces one, and then delivered: once inline, so the common
 * case is immediate, and from the sweep for whatever the inline attempt could
 * not settle. The daemon may be restarting or still migrating when an access
 * grant commits, and for someone who just redeemed an invite or a code the
 * reply is the only thing that tells them it worked.
 *
 * An attempt is repeated only when the reply provably never left: the
 * connection to the daemon never opened, or the daemon refused the method
 * before running it because its database is not migrated yet. Once the
 * request reached the daemon, a missing answer (a timeout, a dropped socket)
 * leaves the reply possibly posted, and a second attempt could post it twice,
 * so the outcome is logged as unknown and the reply is not sent again. A
 * refusal from the handler (a callback no transport owns, a transport that
 * did not acknowledge) is final.
 */

import {
  ChannelDeliveryResultSchema,
  DELIVER_GATEWAY_REPLY_IPC_METHOD,
  type GatewayReplyRequest,
} from "@vellumai/gateway-client";
import { DB_MIGRATIONS_UNAVAILABLE_ERROR_CODE } from "@vellumai/ipc-server-utils";

import {
  claimOwedReply,
  dropAbandonedOwedReplies,
  dropExpiredOwedReplies,
  hasOwedReplies,
  listDueOwedReplyIds,
  newOwedReplyId,
  type OwedReplyRow,
  recordOwedReply,
  releaseOwedReply,
  settleOwedReply,
} from "../db/gateway-reply-outbox-store.js";
import {
  IpcHandlerError,
  IpcTransportError,
  ipcCallAssistant,
} from "../ipc/assistant-client.js";
import { getLogger } from "../logger.js";

const log = getLogger("verification-reply");

/**
 * How long one attempt waits for the daemon's answer. Not a delivery
 * deadline: the transports' own retries can outlast it (a Telegram send
 * allows 15 seconds per attempt across three retries), and the daemon keeps
 * sending after the gateway stops waiting, which is why a wait that runs out
 * is an unknown outcome rather than a failure.
 */
const DELIVERY_WAIT_MS = 10_000;

/**
 * How long a claimed reply may go unsettled before its attempt is taken as
 * abandoned by a gateway that stopped mid-send. An attempt's call is bounded
 * by {@link DELIVERY_WAIT_MS} and its settle is one write bounded by the
 * gateway DB's 5-second busy timeout, so three times the call bound is past
 * any attempt that is still running.
 */
const ATTEMPT_ABANDONED_AFTER_MS = 3 * DELIVERY_WAIT_MS;

/**
 * How often the sweep retries what the daemon could not take. It is the most
 * a reply waits once the daemon is back. A pass costs one read of a table
 * that is empty outside an outage, plus one refused connection per owed
 * reply while the daemon is down.
 */
export const OWED_REPLY_SWEEP_INTERVAL_MS = 10_000;

/** Bounds one sweep pass. A reply is owed per intercepted message, so a
 * backlog is a handful of rows. */
const SWEEP_BATCH_LIMIT = 50;

// ---------------------------------------------------------------------------
// Reply templates (mirrors assistant's verification-templates.ts)
// ---------------------------------------------------------------------------

export function composeVerificationSuccessReply(
  verificationType?: "guardian" | "trusted_contact",
): string {
  if (verificationType === "trusted_contact") {
    return "Verification successful! You can now message the assistant.";
  }
  return "Verification successful. You are now set as the guardian for this channel.";
}

export function composeVerificationFailureReply(reason?: string): string {
  return reason ?? "The verification code is invalid or has expired.";
}

// ---------------------------------------------------------------------------
// Delivery
// ---------------------------------------------------------------------------

/**
 * Owe a reply that announces no grant (a failure, an already-member notice)
 * and try it at once. A reply that announces a grant is recorded with
 * `recordOwedReply` inside the grant's own transaction instead, then handed
 * to {@link deliverOwedReply}.
 *
 * Never throws: the code or invite is already consumed when this runs, and a
 * failure that propagated would error the webhook and let the provider retry
 * a consumed code into the normal pipeline.
 */
export async function sendGatewayReply(
  reply: GatewayReplyRequest,
): Promise<void> {
  const id = newOwedReplyId();
  try {
    recordOwedReply(id, reply);
  } catch (err) {
    log.error(
      { err, chatId: reply.chatId },
      "Could not record the gateway reply as owed; it will not be sent",
    );
    return;
  }
  await deliverOwedReply(id);
}

/**
 * Make one delivery attempt for an owed reply. A reply another attempt holds,
 * or one that is gone or expired, is left alone. Never throws.
 */
export async function deliverOwedReply(id: string): Promise<void> {
  try {
    const row = claimOwedReply(id);
    if (!row) {
      return;
    }
    if ((await attemptDelivery(row)) === "not_sent") {
      releaseOwedReply(id);
    } else {
      settleOwedReply(id);
    }
  } catch (err) {
    log.error({ err, replyId: id }, "Gateway reply bookkeeping failed");
  }
}

/**
 * Hand one reply to the daemon and classify what came back. `not_sent` is
 * returned only when the reply provably never left, so repeating it cannot
 * post it twice.
 */
async function attemptDelivery(
  row: OwedReplyRow,
): Promise<"settled" | "not_sent"> {
  const logContext = { replyId: row.id, chatId: row.chatId };
  const request: GatewayReplyRequest = {
    callbackUrl: row.callbackUrl,
    chatId: row.chatId,
    text: row.text,
    ...(row.assistantId ? { assistantId: row.assistantId } : {}),
  };
  try {
    const result = await ipcCallAssistant(
      DELIVER_GATEWAY_REPLY_IPC_METHOD,
      { body: request },
      { timeoutMs: DELIVERY_WAIT_MS },
    );
    if (ChannelDeliveryResultSchema.safeParse(result).data?.ok) {
      log.info(logContext, "Gateway reply delivered");
    } else {
      log.error(
        logContext,
        "Gateway reply was not acknowledged by the channel",
      );
    }
    return "settled";
  } catch (err) {
    if (provablyNotSent(err)) {
      log.debug(
        { ...logContext, err },
        "Daemon could not take the gateway reply; it stays owed",
      );
      return "not_sent";
    }
    if (err instanceof IpcHandlerError) {
      log.error({ ...logContext, err }, "Gateway reply delivery failed");
      return "settled";
    }
    log.warn(
      { ...logContext, err },
      "Gateway reply outcome unknown: no answer from the daemon",
    );
    return "settled";
  }
}

function provablyNotSent(err: unknown): boolean {
  if (err instanceof IpcTransportError) {
    return !err.requestWritten;
  }
  return (
    err instanceof IpcHandlerError &&
    err.code === DB_MIGRATIONS_UNAVAILABLE_ERROR_CODE
  );
}

// ---------------------------------------------------------------------------
// Sweep
// ---------------------------------------------------------------------------

let sweeping = false;

/**
 * One pass over the outbox: drop what can no longer be sent, then attempt
 * what is still owed. Single-flight, so a pass that runs long is not
 * overlapped by the next tick. Never throws.
 */
export async function sweepOwedReplies(): Promise<void> {
  if (sweeping) {
    return;
  }
  sweeping = true;
  try {
    if (!hasOwedReplies()) {
      return;
    }
    const now = Date.now();
    for (const row of dropAbandonedOwedReplies(
      now - ATTEMPT_ABANDONED_AFTER_MS,
    )) {
      log.warn(
        { replyId: row.id, chatId: row.chatId },
        "Gateway reply outcome unknown: its attempt was cut off mid-send",
      );
    }
    for (const row of dropExpiredOwedReplies(now)) {
      log.warn(
        { replyId: row.id, chatId: row.chatId, createdAt: row.createdAt },
        "Gateway reply expired before the daemon could take it; not sent",
      );
    }
    for (const id of listDueOwedReplyIds(SWEEP_BATCH_LIMIT, now)) {
      await deliverOwedReply(id);
    }
  } catch (err) {
    log.error({ err }, "Gateway reply sweep failed");
  } finally {
    sweeping = false;
  }
}
