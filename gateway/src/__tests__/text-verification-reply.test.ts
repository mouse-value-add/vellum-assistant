/**
 * A verification reply reaches the person through the daemon's channel
 * transport for the chat the code came from, and says what the code
 * actually granted.
 *
 * The gateway consumes the code itself, so no turn runs and no turn reply
 * goes out: this reply is the only thing the person hears back. The session
 * store is real; the assistant IPC socket is the boundary, scripted per test
 * as a daemon that is up, down, gone before the reply, or failing its mirror
 * writes.
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

import {
  DELIVER_GATEWAY_REPLY_IPC_METHOD,
  hashVerificationSecret,
} from "@vellumai/gateway-client";

type Daemon = "up" | "down" | "gone-before-reply" | "mirror-failing";

let daemon: Daemon = "up";
let ipcCalls: { method: string; params?: Record<string, unknown> }[] = [];

// Spread the actual module so untouched exports stay importable by
// later-loaded files when suites share a bun process.
const actualAssistantClient = await import("../ipc/assistant-client.js");
const { IpcHandlerError, IpcTransportError } = actualAssistantClient;
mock.module("../ipc/assistant-client.js", () => ({
  ...actualAssistantClient,
  ipcCallAssistant: async (
    method: string,
    params?: Record<string, unknown>,
  ) => {
    const isReply = method === DELIVER_GATEWAY_REPLY_IPC_METHOD;
    if (daemon === "down" || (daemon === "gone-before-reply" && isReply)) {
      throw new IpcTransportError("connect ECONNREFUSED", {
        requestWritten: false,
      });
    }
    if (daemon === "mirror-failing" && method.startsWith("contacts_mirror_")) {
      throw new IpcHandlerError("mirror write failed", 500, "INTERNAL");
    }
    ipcCalls.push({ method, params });
    return isReply ? { ok: true, messageIds: ["1"] } : {};
  },
}));

await import("./test-preload.js");
const { getGatewayDb, initGatewayDb, resetGatewayDb } =
  await import("../db/connection.js");
const {
  channelVerificationSessions,
  contactChannels,
  contacts,
  gatewayReplyOutbox,
} = await import("../db/schema.js");
const { createOutboundSession } = await import("../db/session-store.js");
const { tryTextVerificationIntercept } =
  await import("../verification/text-verification.js");
const { sweepOwedReplies } = await import("../verification/reply-delivery.js");

const CHANNEL = "telegram";
const ACTOR = "777000";
const CODE = "123456";
// The path the gateway's Telegram webhook builds, on a reserved host so a
// regression back to fetching the URL can never reach a live service.
const REPLY_URL = "http://gateway.invalid/deliver/telegram";
const CONTACT_WELCOME =
  "Verification successful! You can now message the assistant.";
const GUARDIAN_WELCOME =
  "Verification successful. You are now set as the guardian for this channel.";

function replies(): Record<string, unknown>[] {
  return ipcCalls
    .filter((c) => c.method === DELIVER_GATEWAY_REPLY_IPC_METHOD)
    .map((c) => c.params!.body as Record<string, unknown>);
}

function replyTexts(): unknown[] {
  return replies().map((r) => r.text);
}

function channelOf(address: string) {
  return getGatewayDb()
    .select()
    .from(contactChannels)
    .all()
    .find((c) => c.address === address);
}

function sessionStatus(): string | undefined {
  return getGatewayDb().select().from(channelVerificationSessions).get()
    ?.status;
}

function interceptParams(overrides: Record<string, unknown> = {}) {
  return {
    sourceChannel: CHANNEL,
    messageContent: CODE,
    actorExternalUserId: ACTOR,
    actorChatId: ACTOR,
    isDirectMessage: true,
    replyCallbackUrl: REPLY_URL,
    assistantId: "self",
    ...overrides,
  };
}

function seedSession(purpose: "trusted_contact" | "guardian"): void {
  getGatewayDb().delete(channelVerificationSessions).run();
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

beforeAll(async () => {
  await initGatewayDb();
});

beforeEach(() => {
  daemon = "up";
  ipcCalls = [];
  getGatewayDb().delete(gatewayReplyOutbox).run();
  getGatewayDb().delete(contactChannels).run();
  getGatewayDb().delete(contacts).run();
  seedSession("trusted_contact");
});

afterAll(() => {
  resetGatewayDb();
});

describe("text verification reply", () => {
  test("a wrong code is answered in the sender's chat", async () => {
    const result = await tryTextVerificationIntercept(
      interceptParams({ messageContent: "654321" }),
    );

    expect(result.intercepted).toBe(true);
    if (result.intercepted) {
      expect(result.pendingReplyText).toBeUndefined();
    }
    expect(replies()).toEqual([
      {
        callbackUrl: REPLY_URL,
        chatId: ACTOR,
        text: "The verification code is invalid or has expired.",
        assistantId: "self",
      },
    ]);
  });

  test("a code posted in a room is answered with where to send it", async () => {
    await tryTextVerificationIntercept(
      interceptParams({ actorChatId: "-100200300", isDirectMessage: false }),
    );

    expect(replies()).toHaveLength(1);
    expect(replies()[0]).toMatchObject({
      callbackUrl: REPLY_URL,
      chatId: "-100200300",
    });
    expect(String(replies()[0]!.text)).toContain("direct message");
    expect(String(replies()[0]!.text)).not.toContain(CODE);
  });
});

describe("a code redeemed while the daemon is unavailable", () => {
  test.each(["down", "gone-before-reply"] as const)(
    "daemon %s: access is granted and the reply arrives once the daemon is back",
    async (unavailable) => {
      daemon = unavailable;

      const result = await tryTextVerificationIntercept(interceptParams());

      expect(result).toMatchObject({ intercepted: true, outcome: "verified" });
      expect(channelOf(ACTOR)?.status).toBe("active");
      expect(replies()).toHaveLength(0);

      daemon = "up";
      await sweepOwedReplies();

      expect(replies()).toEqual([
        {
          callbackUrl: REPLY_URL,
          chatId: ACTOR,
          text: CONTACT_WELCOME,
          assistantId: "self",
        },
      ]);
    },
  );

  test("a mirror write that fails after the grant does not fail the message", async () => {
    daemon = "mirror-failing";

    // A throw here would fail the webhook into a provider retry of a code
    // that is already spent.
    const result = await tryTextVerificationIntercept(interceptParams());

    expect(result).toMatchObject({ intercepted: true, outcome: "verified" });
    expect(replyTexts()).toEqual([CONTACT_WELCOME]);
    await sweepOwedReplies();
    expect(replyTexts()).toEqual([CONTACT_WELCOME]);
  });
});

describe("the reply says what the code granted", () => {
  test("a guardian code binds the sender as guardian and says so", async () => {
    seedSession("guardian");

    const result = await tryTextVerificationIntercept(interceptParams());

    expect(result).toMatchObject({
      outcome: "verified",
      trustClass: "guardian",
    });
    expect(replyTexts()).toEqual([GUARDIAN_WELCOME]);
  });

  test("a guardian code for a channel someone else guards makes the sender a contact, and says that", async () => {
    seedGuardian("OTHER");
    seedSession("guardian");

    const result = await tryTextVerificationIntercept(interceptParams());

    expect(result).toMatchObject({
      outcome: "verified",
      trustClass: "trusted_contact",
    });
    expect(channelOf(ACTOR)?.status).toBe("active");
    expect(channelOf("OTHER")?.status).toBe("active");
    expect(replyTexts()).toEqual([CONTACT_WELCOME]);
  });

  test("a re-verifying guardian keeps their binding when the grant cannot commit", async () => {
    seedGuardian(ACTOR);
    seedSession("guardian");
    // The owed reply is the transaction's last write; losing its table makes
    // the transaction throw after the revoke and the new binding.
    getGatewayDb().run("DROP TABLE gateway_reply_outbox");

    try {
      await expect(
        tryTextVerificationIntercept(interceptParams()),
      ).rejects.toThrow();

      // The revoke rolled back with the binding, and the code is still good.
      expect(channelOf(ACTOR)?.status).toBe("active");
      expect(sessionStatus()).toBe("awaiting_response");
    } finally {
      resetGatewayDb();
      await initGatewayDb();
    }
  });
});
