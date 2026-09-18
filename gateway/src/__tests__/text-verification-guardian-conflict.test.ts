/**
 * A guardian code tells the sender the role they were actually granted.
 *
 * When another sender already guards the channel, a valid guardian code
 * makes this sender a trusted contact and leaves the guardian in place, so
 * the reply must say they can message the assistant, not that they are now
 * the guardian. The gateway DB and session store are real; the assistant
 * mirror IPC is acknowledged and otherwise inert.
 */

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";

import { hashVerificationSecret } from "@vellumai/gateway-client";

// Spread the actual module so untouched exports stay importable by
// later-loaded files when suites share a bun process.
const actualAssistantClient = await import("../ipc/assistant-client.js");
mock.module("../ipc/assistant-client.js", () => ({
  ...actualAssistantClient,
  ipcCallAssistant: async () => ({}),
}));

await import("./test-preload.js");
const { getGatewayDb, initGatewayDb, resetGatewayDb } =
  await import("../db/connection.js");
const { channelVerificationSessions, contactChannels, contacts } =
  await import("../db/schema.js");
const { createOutboundSession } = await import("../db/session-store.js");
const { tryTextVerificationIntercept } =
  await import("../verification/text-verification.js");

const CHANNEL = "telegram";
const ACTOR = "777000";
const CODE = "123456";

function seedGuardianSession(): void {
  createOutboundSession({
    id: "session-1",
    channel: CHANNEL,
    challengeHash: hashVerificationSecret(CODE),
    expiresAt: Date.now() + 10 * 60 * 1000,
    status: "awaiting_response",
    expectedExternalUserId: ACTOR,
    identityBindingStatus: "bound",
    destinationAddress: ACTOR,
    verificationPurpose: "guardian",
  });
}

/** Seed an active guardian bound to `address` on this channel. */
function seedGuardian(address: string): void {
  const now = Date.now();
  getGatewayDb()
    .insert(contacts)
    .values({
      id: `guardian-${address}`,
      displayName: "Guardian",
      role: "guardian",
      principalId: `principal-${address}`,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  getGatewayDb()
    .insert(contactChannels)
    .values({
      id: `channel-${address}`,
      contactId: `guardian-${address}`,
      type: CHANNEL,
      address,
      externalChatId: address,
      status: "active",
      policy: "allow",
      interactionCount: 0,
      createdAt: now,
    })
    .run();
}

function channelOf(address: string) {
  return getGatewayDb()
    .select()
    .from(contactChannels)
    .all()
    .find((c) => c.address === address);
}

function redeem() {
  // No callback URL: the reply comes back as text, as it does for email.
  return tryTextVerificationIntercept({
    sourceChannel: CHANNEL,
    messageContent: CODE,
    actorExternalUserId: ACTOR,
    actorChatId: ACTOR,
    isDirectMessage: true,
  });
}

beforeAll(async () => {
  await initGatewayDb();
});

beforeEach(() => {
  getGatewayDb().delete(channelVerificationSessions).run();
  getGatewayDb().delete(contactChannels).run();
  getGatewayDb().delete(contacts).run();
  seedGuardianSession();
});

afterAll(() => {
  resetGatewayDb();
});

describe("guardian code reply", () => {
  test("on an unguarded channel, the sender becomes guardian and is told so", async () => {
    const result = await redeem();

    expect(result).toMatchObject({
      outcome: "verified",
      trustClass: "guardian",
      pendingReplyText:
        "Verification successful. You are now set as the guardian for this channel.",
    });
  });

  test("on a channel someone else guards, the sender becomes a contact and is told that", async () => {
    seedGuardian("OTHER");

    const result = await redeem();

    expect(result).toMatchObject({
      outcome: "verified",
      trustClass: "trusted_contact",
      pendingReplyText:
        "Verification successful! You can now message the assistant.",
    });
    expect(channelOf(ACTOR)?.status).toBe("active");
    expect(channelOf("OTHER")?.status).toBe("active");
  });
});
