/**
 * Durable record of the replies the gateway owes for messages it answered at
 * ingress. The delivery rules live in `verification/reply-delivery.ts`; this
 * module is the row lifecycle only.
 *
 * Every write is a plain statement over the gateway DB, so
 * {@link recordOwedReply} composes inside a caller's transaction: that is how
 * a reply lands in the same commit as the grant it announces.
 */

import { randomUUID } from "node:crypto";

import type { GatewayReplyRequest } from "@vellumai/gateway-client";
import { and, asc, eq, gt, lt, lte } from "drizzle-orm";

import { getGatewayDb } from "./connection.js";
import { gatewayReplyOutbox } from "./schema.js";

export type OwedReplyRow = typeof gatewayReplyOutbox.$inferSelect;

/**
 * How long an owed reply stays sendable.
 *
 * Ten minutes, the budget the daemon gives a channel turn's own reply before
 * its retry sweep gives up (`RETRY_MAX_ATTEMPTS` in the assistant's
 * `persistence/job-utils.ts`, about ten minutes; see "Channel inbound honors
 * queue if busy" in `assistant/src/runtime/AGENTS.md`). The person waiting is
 * the same either way, so a reply the gateway composed arrives no later than
 * one the assistant composed would. A daemon restart, including a migration
 * run, fits inside it; a reply held past it would answer a message the person
 * has had every reason to consider lost.
 */
export const OWED_REPLY_TTL_MS = 10 * 60 * 1_000;

/** A fresh id for a reply, minted before the write that records it. */
export function newOwedReplyId(): string {
  return randomUUID();
}

/**
 * Record a reply as owed under `id`. Plain insert, so a caller inside a
 * gateway transaction commits the reply with whatever else it writes, and
 * names it by the id it minted beforehand.
 */
export function recordOwedReply(
  id: string,
  reply: GatewayReplyRequest,
  now: number = Date.now(),
): void {
  getGatewayDb()
    .insert(gatewayReplyOutbox)
    .values({
      id,
      callbackUrl: reply.callbackUrl,
      chatId: reply.chatId,
      text: reply.text,
      assistantId: reply.assistantId ?? null,
      state: "pending",
      createdAt: now,
      expiresAt: now + OWED_REPLY_TTL_MS,
    })
    .run();
}

/**
 * Take a pending, unexpired reply for one delivery attempt. Returns null when
 * the row is gone, expired, or another attempt holds it, so two callers can
 * never send the same reply.
 */
export function claimOwedReply(
  id: string,
  now: number = Date.now(),
): OwedReplyRow | null {
  const [row] = getGatewayDb()
    .update(gatewayReplyOutbox)
    .set({ state: "sending", attemptStartedAt: now })
    .where(
      and(
        eq(gatewayReplyOutbox.id, id),
        eq(gatewayReplyOutbox.state, "pending"),
        gt(gatewayReplyOutbox.expiresAt, now),
      ),
    )
    .returning()
    .all();
  return row ?? null;
}

/** Return a claimed reply to `pending`: the attempt provably sent nothing. */
export function releaseOwedReply(id: string): void {
  getGatewayDb()
    .update(gatewayReplyOutbox)
    .set({ state: "pending", attemptStartedAt: null })
    .where(
      and(
        eq(gatewayReplyOutbox.id, id),
        eq(gatewayReplyOutbox.state, "sending"),
      ),
    )
    .run();
}

/** Remove a reply whose delivery has settled, whatever the outcome. */
export function settleOwedReply(id: string): void {
  getGatewayDb()
    .delete(gatewayReplyOutbox)
    .where(eq(gatewayReplyOutbox.id, id))
    .run();
}

/** Remove and return the pending replies that expired unsent. */
export function dropExpiredOwedReplies(
  now: number = Date.now(),
): OwedReplyRow[] {
  return getGatewayDb()
    .delete(gatewayReplyOutbox)
    .where(
      and(
        eq(gatewayReplyOutbox.state, "pending"),
        lte(gatewayReplyOutbox.expiresAt, now),
      ),
    )
    .returning()
    .all();
}

/**
 * Remove and return the replies whose attempt started before `startedBefore`
 * and never settled: the process running it stopped mid-send.
 */
export function dropAbandonedOwedReplies(
  startedBefore: number,
): OwedReplyRow[] {
  return getGatewayDb()
    .delete(gatewayReplyOutbox)
    .where(
      and(
        eq(gatewayReplyOutbox.state, "sending"),
        lt(gatewayReplyOutbox.attemptStartedAt, startedBefore),
      ),
    )
    .returning()
    .all();
}

/** Whether any reply is owed at all, the common answer being no. */
export function hasOwedReplies(): boolean {
  return (
    getGatewayDb()
      .select({ id: gatewayReplyOutbox.id })
      .from(gatewayReplyOutbox)
      .limit(1)
      .get() !== undefined
  );
}

/** Ids of the pending, unexpired replies, oldest first. */
export function listDueOwedReplyIds(
  limit: number,
  now: number = Date.now(),
): string[] {
  return getGatewayDb()
    .select({ id: gatewayReplyOutbox.id })
    .from(gatewayReplyOutbox)
    .where(
      and(
        eq(gatewayReplyOutbox.state, "pending"),
        gt(gatewayReplyOutbox.expiresAt, now),
      ),
    )
    .orderBy(asc(gatewayReplyOutbox.createdAt))
    .limit(limit)
    .all()
    .map((row) => row.id);
}
