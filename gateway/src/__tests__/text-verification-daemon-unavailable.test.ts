/**
 * A verification code grants access whether or not the daemon can answer.
 *
 * The gateway owns the ACL; the assistant mirror it keeps in step carries
 * identity and display name only. A daemon that is down, restarting, or
 * migrating must therefore never cost the person their code: the intercept
 * runs before anything is forwarded, so a throw from it fails the webhook,
 * and the provider's retry then finds the code already spent.
 *
 * The gateway DB and session store are real; the assistant IPC socket is the
 * boundary, scripted as a daemon that is down or failing its mirror writes,
 * or as one whose lookup is still in flight when another guardian binds.
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

type Daemon = "up" | "down" | "mirror-failing";
let daemon: Daemon = "up";
/** Runs while the daemon is answering a mirror lookup, then clears. */
let duringLookup: (() => void) | undefined;

// Spread the actual module so untouched exports stay importable by
// later-loaded files when suites share a bun process.
const actualAssistantClient = await import("../ipc/assistant-client.js");
const { IpcHandlerError, IpcTransportError } = actualAssistantClient;
mock.module("../ipc/assistant-client.js", () => ({
  ...actualAssistantClient,
  ipcCallAssistant: async (method: string) => {
    if (method === "contact_channel_identity_lookup" && duringLookup) {
      const run = duringLookup;
      duringLookup = undefined;
      run();
    }
    if (daemon === "down") {
      throw new IpcTransportError("connect ECONNREFUSED");
    }
    if (daemon === "mirror-failing" && method.startsWith("contacts_mirror_")) {
      throw new IpcHandlerError("mirror write failed", 500, "INTERNAL");
    }
    return {};
  },
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

function seedSession(purpose: "trusted_contact" | "guardian"): void {
  createOutboundSession({
    id: "session-1",
    channel: CHANNEL,
    challengeHash: hashVerificationSecret(CODE),
    expiresAt: Date.now() + 10 * 60 * 1000,
    status: "awaiting_response",
    expectedExternalUserId: ACTOR,
    identityBindingStatus: "bound",
    destinationAddress: ACTOR,
    verificationPurpose: purpose,
  });
}

function redeem() {
  // No callback URL: the reply comes back as text, as it does for email,
  // which keeps this suite about the grant rather than about delivery.
  return tryTextVerificationIntercept({
    sourceChannel: CHANNEL,
    messageContent: CODE,
    actorExternalUserId: ACTOR,
    actorChatId: ACTOR,
    isDirectMessage: true,
  });
}

function channelOf(address: string) {
  return getGatewayDb()
    .select()
    .from(contactChannels)
    .all()
    .find((c) => c.address === address);
}

function actorChannel() {
  return channelOf(ACTOR);
}

beforeAll(async () => {
  await initGatewayDb();
});

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

beforeEach(() => {
  daemon = "up";
  duringLookup = undefined;
  getGatewayDb().delete(channelVerificationSessions).run();
  getGatewayDb().delete(contactChannels).run();
  getGatewayDb().delete(contacts).run();
});

afterAll(() => {
  resetGatewayDb();
});

describe.each(["down", "mirror-failing"] as const)(
  "a code redeemed while the daemon is %s",
  (unavailable) => {
    test("a trusted-contact code grants access", async () => {
      seedSession("trusted_contact");
      daemon = unavailable;

      const result = await redeem();

      expect(result).toMatchObject({
        intercepted: true,
        outcome: "verified",
        pendingReplyText:
          "Verification successful! You can now message the assistant.",
      });
      expect(actorChannel()?.status).toBe("active");
    });

    test("a guardian code binds the sender", async () => {
      seedSession("guardian");
      daemon = unavailable;

      const result = await redeem();

      expect(result).toMatchObject({
        intercepted: true,
        outcome: "verified",
        pendingReplyText:
          "Verification successful. You are now set as the guardian for this channel.",
      });
      expect(actorChannel()?.status).toBe("active");
    });
  },
);

describe("a code redeemed while the daemon is down, for a sender the gateway already knows", () => {
  test("activates the sender's existing channel under the contact it already has", async () => {
    // Ingress seeds an unverified contact for a first-time sender before the
    // code is ever typed.
    const now = Date.now();
    getGatewayDb()
      .insert(contacts)
      .values({
        id: "seeded",
        displayName: "Seeded",
        role: "contact",
        createdAt: now,
        updatedAt: now,
      })
      .run();
    getGatewayDb()
      .insert(contactChannels)
      .values({
        id: "seeded-channel",
        contactId: "seeded",
        type: CHANNEL,
        address: ACTOR,
        externalChatId: ACTOR,
        status: "unverified",
        policy: "allow",
        interactionCount: 0,
        createdAt: now,
      })
      .run();
    seedSession("trusted_contact");
    daemon = "down";

    await redeem();

    expect(actorChannel()).toMatchObject({
      contactId: "seeded",
      status: "active",
    });
    expect(getGatewayDb().select().from(contacts).all()).toHaveLength(1);
  });
});

describe("a guardian code whose mirror lookup is in flight when another guardian binds", () => {
  test("does not revoke the guardian that bound meanwhile", async () => {
    seedSession("guardian");
    duringLookup = () => seedGuardian("OTHER");

    await redeem();

    // The guardian bound meanwhile keeps the channel; the sender is a contact.
    expect(channelOf("OTHER")?.status).toBe("active");
    const senderContact = getGatewayDb()
      .select()
      .from(contacts)
      .all()
      .find((c) => c.id === actorChannel()?.contactId);
    expect(senderContact?.role).toBe("contact");
  });
});
