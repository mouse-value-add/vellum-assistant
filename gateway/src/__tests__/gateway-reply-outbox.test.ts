/**
 * The reply the gateway owes someone who redeemed an invite survives the
 * daemon being unable to take it, and is never sent twice or stale.
 *
 * The gateway DB and the redemption engine are real; the assistant IPC
 * socket is the boundary, scripted per test as a daemon that is down,
 * migrating, up, silent, or refusing.
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  setSystemTime,
  test,
} from "bun:test";

import {
  DELIVER_GATEWAY_REPLY_IPC_METHOD,
  type TrustVerdict,
} from "@vellumai/gateway-client";
import { DB_MIGRATIONS_UNAVAILABLE_ERROR_CODE } from "@vellumai/ipc-server-utils";

type Daemon = "down" | "migrating" | "up" | "silent" | "refusing";

let daemon: Daemon = "up";
/** Replies the daemon received, whatever it did with them next. */
let received: Record<string, unknown>[] = [];
/** When set, the daemon holds a reply until the test releases it. */
let holdReply: Promise<void> | undefined;

const actualAssistantClient = await import("../ipc/assistant-client.js");
const { IpcHandlerError, IpcTransportError } = actualAssistantClient;
mock.module("../ipc/assistant-client.js", () => ({
  ...actualAssistantClient,
  ipcCallAssistant: async (
    method: string,
    params?: Record<string, unknown>,
  ) => {
    if (daemon === "down") {
      throw new IpcTransportError("connect ENOENT", {
        requestWritten: false,
      });
    }
    if (daemon === "migrating") {
      throw new IpcHandlerError(
        "Database migrations running",
        503,
        DB_MIGRATIONS_UNAVAILABLE_ERROR_CODE,
      );
    }
    if (method !== DELIVER_GATEWAY_REPLY_IPC_METHOD) {
      return {};
    }
    received.push(params!.body as Record<string, unknown>);
    if (holdReply) {
      await holdReply;
    }
    if (daemon === "silent") {
      throw new IpcTransportError("Call timed out after 10000ms");
    }
    if (daemon === "refusing") {
      throw new IpcHandlerError(
        "No channel transport owns this callback URL",
        400,
        "BAD_REQUEST",
      );
    }
    return { ok: true, messageIds: ["1"] };
  },
}));

await import("./test-preload.js");
const { getGatewayDb, initGatewayDb, resetGatewayDb } =
  await import("../db/connection.js");
const { contactChannels, contacts, gatewayReplyOutbox, ingressInvites } =
  await import("../db/schema.js");
const { OWED_REPLY_TTL_MS } =
  await import("../db/gateway-reply-outbox-store.js");
const { seedContact, seedInvite } =
  await import("./helpers/contact-fixtures.js");
const { tryInviteRedemptionIntercept } =
  await import("../verification/invite-redemption.js");
const { sweepOwedReplies } = await import("../verification/reply-delivery.js");

// The path the gateway's Telegram webhook builds, on a reserved host so a
// regression back to fetching the URL can never reach a live service.
const REPLY_URL = "http://gateway.invalid/deliver/telegram";
const WELCOME = "Welcome! You've been granted access.";
const STRANGER: TrustVerdict = {
  trustClass: "unknown",
  canonicalSenderId: "U_SENDER",
};

function redeem() {
  return tryInviteRedemptionIntercept({
    sourceChannel: "telegram",
    messageContent: "123456",
    actorExternalUserId: "U_SENDER",
    actorChatId: "chat-sender",
    replyCallbackUrl: REPLY_URL,
    assistantId: "asst-1",
    trustVerdict: STRANGER,
  });
}

function owedReplies() {
  return getGatewayDb().select().from(gatewayReplyOutbox).all();
}

function senderChannelStatus(): string | undefined {
  return getGatewayDb()
    .select()
    .from(contactChannels)
    .all()
    .find((c) => c.address === "U_SENDER")?.status;
}

beforeEach(async () => {
  resetGatewayDb();
  await initGatewayDb();
  getGatewayDb().delete(gatewayReplyOutbox).run();
  getGatewayDb().delete(ingressInvites).run();
  getGatewayDb().delete(contactChannels).run();
  getGatewayDb().delete(contacts).run();
  seedContact({ id: "c1" });
  seedInvite();
  daemon = "up";
  received = [];
  holdReply = undefined;
});

afterEach(() => {
  setSystemTime();
  resetGatewayDb();
});

describe("gateway reply outbox", () => {
  test("a redemption answered while the daemon is up is sent once, at once", async () => {
    await redeem();

    expect(received).toEqual([
      {
        callbackUrl: REPLY_URL,
        chatId: "chat-sender",
        text: WELCOME,
        assistantId: "asst-1",
      },
    ]);
    expect(owedReplies()).toHaveLength(0);

    await sweepOwedReplies();
    expect(received).toHaveLength(1);
  });

  test.each(["down", "migrating"] as const)(
    "a reply owed while the daemon is %s reaches the person once it is back",
    async (unavailable) => {
      daemon = unavailable;

      const result = await redeem();

      // Access is granted and the reply is owed, not lost.
      expect(result).toMatchObject({ intercepted: true, outcome: "redeemed" });
      expect(senderChannelStatus()).toBe("active");
      expect(received).toHaveLength(0);
      expect(owedReplies()).toHaveLength(1);

      // Still unavailable: the sweep keeps it.
      await sweepOwedReplies();
      expect(received).toHaveLength(0);
      expect(owedReplies()).toHaveLength(1);

      daemon = "up";
      await sweepOwedReplies();
      expect(received).toEqual([
        expect.objectContaining({ chatId: "chat-sender", text: WELCOME }),
      ]);
      expect(owedReplies()).toHaveLength(0);

      await sweepOwedReplies();
      expect(received).toHaveLength(1);
    },
  );

  test("a reply the daemon took but never answered for is not sent again", async () => {
    daemon = "silent";

    await redeem();

    expect(received).toHaveLength(1);
    expect(owedReplies()).toHaveLength(0);

    daemon = "up";
    await sweepOwedReplies();
    expect(received).toHaveLength(1);
  });

  test("a reply the daemon refused is not sent again", async () => {
    daemon = "refusing";

    await redeem();

    expect(received).toHaveLength(1);
    expect(owedReplies()).toHaveLength(0);

    daemon = "up";
    await sweepOwedReplies();
    expect(received).toHaveLength(1);
  });

  test("an owed reply past its window is dropped, not sent", async () => {
    daemon = "down";
    await redeem();
    expect(owedReplies()).toHaveLength(1);

    setSystemTime(new Date(Date.now() + OWED_REPLY_TTL_MS + 1));
    daemon = "up";
    await sweepOwedReplies();

    expect(received).toHaveLength(0);
    expect(owedReplies()).toHaveLength(0);
  });

  test("a reply whose attempt was cut off mid-send is not sent again", async () => {
    // The gateway stopped while the daemon held the reply: the row is left
    // claimed, and the daemon may already have posted it.
    let release!: () => void;
    holdReply = new Promise((resolve) => {
      release = resolve;
    });
    void redeem();
    await Bun.sleep(20);
    expect(received).toHaveLength(1);
    expect(owedReplies()).toEqual([
      expect.objectContaining({ state: "sending" }),
    ]);
    holdReply = undefined;

    // A pass while the attempt is still live leaves it alone.
    await sweepOwedReplies();
    expect(received).toHaveLength(1);

    // A pass long after the attempt's bound drops it unsent.
    setSystemTime(new Date(Date.now() + 60_000));
    await sweepOwedReplies();
    expect(received).toHaveLength(1);
    expect(owedReplies()).toHaveLength(0);

    release();
  });

  test("access is never granted without the reply that announces it", async () => {
    // A reply that cannot be recorded rolls the grant back with it.
    getGatewayDb().run("DROP TABLE gateway_reply_outbox");

    const result = await redeem();

    expect(result).toMatchObject({ intercepted: true, outcome: "failed" });
    expect(senderChannelStatus()).not.toBe("active");
  });
});
