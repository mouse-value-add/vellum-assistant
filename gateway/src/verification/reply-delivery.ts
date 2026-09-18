/**
 * Verification reply delivery for gateway-owned text-channel verification.
 *
 * Delivers deterministic template-driven replies to the chat the answered
 * message came from, through the daemon's channel transport for that
 * channel. The gateway composes the reply and never sends to a provider
 * itself; the assistant never sees verification code messages.
 */

import {
  ChannelDeliveryResultSchema,
  DELIVER_GATEWAY_REPLY_IPC_METHOD,
  type GatewayReplyRequest,
} from "@vellumai/gateway-client";

import { ipcCallAssistant } from "../ipc/assistant-client.js";
import { getLogger } from "../logger.js";

const log = getLogger("verification-reply");

const DELIVERY_TIMEOUT_MS = 10_000;

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
 * Deliver a verification reply through the channel transport the inbound
 * message's callback URL names, over the daemon's `deliver_gateway_reply`
 * IPC method.
 *
 * Never throws: the code or invite is already consumed when this runs, and a
 * failure that propagated would error the webhook and let the provider retry
 * a consumed code into the normal pipeline. Not retried either, because a
 * call that timed out may still have been sent, and a second attempt would
 * post the reply twice; the transports retry transient provider errors
 * themselves.
 */
export async function deliverVerificationReply(
  params: GatewayReplyRequest,
): Promise<void> {
  try {
    const result = await ipcCallAssistant(
      DELIVER_GATEWAY_REPLY_IPC_METHOD,
      { body: params },
      { timeoutMs: DELIVERY_TIMEOUT_MS },
    );
    if (!ChannelDeliveryResultSchema.safeParse(result).data?.ok) {
      log.error(
        { chatId: params.chatId },
        "Verification reply was not acknowledged by the channel",
      );
    }
  } catch (err) {
    log.error(
      { err, chatId: params.chatId },
      "Verification reply delivery did not complete",
    );
  }
}
