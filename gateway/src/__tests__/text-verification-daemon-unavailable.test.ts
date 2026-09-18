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
 * boundary, scripted as a daemon that is down or failing its mirror writes.
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

// Spread the actual module so untouched exports stay importable by
// later-loaded files when suites share a bun process.
const actualAssistantClient = await import("../ipc/assistant-client.js");
const { IpcHandlerError, IpcTransportError } = actualAssistantClient;
mock.module("../ipc/assistant-client.js", () => ({
  ...actualAssistantClient,
  ipcCallAssistant: async (method: string) => {
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

function actorChannel() {
  return getGatewayDb()
    .select()
    .from(contactChannels)
    .all()
    .find((c) => c.address === ACTOR);
}

beforeAll(async () => {
  await initGatewayDb();
});

beforeEach(() => {
  daemon = "up";
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
