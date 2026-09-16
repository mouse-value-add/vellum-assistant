import { afterAll, afterEach, describe, expect, spyOn, test } from "bun:test";

import * as guardianToken from "../lib/guardian-token.js";
import {
  GuardianAccessTokenError,
  resolveGuardianAccessToken,
  resolveGuardianAccessTokenOrExit,
} from "../lib/guardian-access-token.js";

const GATEWAY = "http://127.0.0.1:7830";
const ASSISTANT = "assistant-1";

function storedToken(
  overrides: Partial<guardianToken.GuardianTokenData> = {},
): guardianToken.GuardianTokenData {
  return {
    guardianPrincipalId: "principal",
    accessToken: "cached-token",
    accessTokenExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    refreshToken: "refresh-token",
    refreshTokenExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    refreshAfter: new Date(Date.now() + 30_000).toISOString(),
    isNew: false,
    deviceId: "device",
    leasedAt: new Date().toISOString(),
    ...overrides,
  } as guardianToken.GuardianTokenData;
}

// Saved so afterAll can restore them; a leaked spy on loadGuardianToken
// breaks guardian-token.test.ts when it runs later in the same process.
const loadSpy = spyOn(guardianToken, "loadGuardianToken");
const leaseSpy = spyOn(guardianToken, "leaseGuardianToken");
const refreshSpy = spyOn(guardianToken, "refreshGuardianTokenResult");

afterEach(() => {
  loadSpy.mockReset();
  leaseSpy.mockReset();
  refreshSpy.mockReset();
});

afterAll(() => {
  loadSpy.mockRestore();
  leaseSpy.mockRestore();
  refreshSpy.mockRestore();
});

describe("resolveGuardianAccessToken", () => {
  test("returns the cached access token while it is unexpired", async () => {
    loadSpy.mockReturnValue(storedToken());

    const token = await resolveGuardianAccessToken(GATEWAY, ASSISTANT, {
      bootstrapSecret: "secret",
    });

    expect(token).toBe("cached-token");
    expect(refreshSpy).not.toHaveBeenCalled();
    expect(leaseSpy).not.toHaveBeenCalled();
  });

  test("rotates an expired access token through guardian/refresh, never init", async () => {
    loadSpy.mockReturnValue(
      storedToken({
        accessTokenExpiresAt: new Date(Date.now() - 1_000).toISOString(),
      }),
    );
    refreshSpy.mockResolvedValue({
      ok: true,
      token: storedToken({ accessToken: "rotated-token" }),
    });

    const token = await resolveGuardianAccessToken(GATEWAY, ASSISTANT, {
      bootstrapSecret: "secret",
    });

    expect(token).toBe("rotated-token");
    expect(refreshSpy).toHaveBeenCalledWith(GATEWAY, ASSISTANT);
    expect(leaseSpy).not.toHaveBeenCalled();
  });

  test("forceRefresh skips an unexpired cached token", async () => {
    loadSpy.mockReturnValue(storedToken());
    refreshSpy.mockResolvedValue({
      ok: true,
      token: storedToken({ accessToken: "rotated-token" }),
    });

    const token = await resolveGuardianAccessToken(GATEWAY, ASSISTANT, {
      forceRefresh: true,
    });

    expect(token).toBe("rotated-token");
    expect(refreshSpy).toHaveBeenCalledTimes(1);
  });

  test("leases via guardian/init only when nothing is stored", async () => {
    loadSpy.mockReturnValue(null);
    leaseSpy.mockResolvedValue(storedToken({ accessToken: "leased-token" }));

    const token = await resolveGuardianAccessToken(GATEWAY, ASSISTANT, {
      bootstrapSecret: "secret",
    });

    expect(token).toBe("leased-token");
    expect(leaseSpy).toHaveBeenCalledWith(GATEWAY, ASSISTANT, "secret");
    expect(refreshSpy).not.toHaveBeenCalled();
  });

  test("leases secretless when nothing is stored and the lockfile has no secret", async () => {
    // Bare-metal gateways accept a secretless guardian/init from loopback.
    loadSpy.mockReturnValue(null);
    leaseSpy.mockResolvedValue(storedToken({ accessToken: "leased-token" }));

    const token = await resolveGuardianAccessToken(GATEWAY, ASSISTANT);

    expect(token).toBe("leased-token");
    expect(leaseSpy).toHaveBeenCalledWith(GATEWAY, ASSISTANT, undefined);
    expect(refreshSpy).not.toHaveBeenCalled();
  });

  test("a spent pairing names the repair command instead of re-leasing", async () => {
    loadSpy.mockReturnValue(
      storedToken({
        accessTokenExpiresAt: new Date(Date.now() - 1_000).toISOString(),
      }),
    );
    refreshSpy.mockResolvedValue({
      ok: false,
      status: 401,
      error: "Failed to refresh guardian token",
    });

    const err = await resolveGuardianAccessToken(GATEWAY, ASSISTANT, {
      bootstrapSecret: "secret",
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(GuardianAccessTokenError);
    expect((err as GuardianAccessTokenError).status).toBe(401);
    expect((err as GuardianAccessTokenError).gatewayUnreachable).toBe(false);
    expect((err as GuardianAccessTokenError).message).toContain(
      `vellum wake ${ASSISTANT} --repair-guardian`,
    );
    expect(leaseSpy).not.toHaveBeenCalled();
  });

  test("an unreachable gateway is reported as such, not as a spent pairing", async () => {
    loadSpy.mockReturnValue(
      storedToken({
        accessTokenExpiresAt: new Date(Date.now() - 1_000).toISOString(),
      }),
    );
    refreshSpy.mockResolvedValue({
      ok: false,
      status: 503,
      error: "Assistant gateway is unreachable",
    });

    const err = await resolveGuardianAccessToken(GATEWAY, ASSISTANT).catch(
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(GuardianAccessTokenError);
    expect((err as GuardianAccessTokenError).gatewayUnreachable).toBe(true);
    expect((err as GuardianAccessTokenError).message).not.toContain(
      "--repair-guardian",
    );
  });
});

describe("resolveGuardianAccessTokenOrExit", () => {
  test("prints the wake hint and exits 1 when the gateway is unreachable", async () => {
    loadSpy.mockReturnValue(
      storedToken({
        accessTokenExpiresAt: new Date(Date.now() - 1_000).toISOString(),
      }),
    );
    refreshSpy.mockResolvedValue({
      ok: false,
      status: 503,
      error: "Assistant gateway is unreachable",
    });
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = spyOn(process, "exit").mockImplementation(((
      code?: number,
    ) => {
      throw new Error(`process.exit:${code}`);
    }) as never);

    try {
      await expect(
        resolveGuardianAccessTokenOrExit(GATEWAY, ASSISTANT, "my-assistant"),
      ).rejects.toThrow("process.exit:1");
      expect(errorSpy).toHaveBeenCalledWith(
        "Error: Could not connect to assistant 'my-assistant'. Is it running?",
      );
      expect(errorSpy).toHaveBeenCalledWith("Try: vellum wake my-assistant");
    } finally {
      errorSpy.mockRestore();
      exitSpy.mockRestore();
    }
  });

  test("surfaces a spent pairing with its repair command and exits 1", async () => {
    loadSpy.mockReturnValue(
      storedToken({
        accessTokenExpiresAt: new Date(Date.now() - 1_000).toISOString(),
      }),
    );
    refreshSpy.mockResolvedValue({
      ok: false,
      status: 401,
      error: "Failed to refresh guardian token",
    });
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = spyOn(process, "exit").mockImplementation(((
      code?: number,
    ) => {
      throw new Error(`process.exit:${code}`);
    }) as never);

    try {
      await expect(
        resolveGuardianAccessTokenOrExit(GATEWAY, ASSISTANT, "my-assistant"),
      ).rejects.toThrow("process.exit:1");
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining(`vellum wake ${ASSISTANT} --repair-guardian`),
      );
    } finally {
      errorSpy.mockRestore();
      exitSpy.mockRestore();
    }
  });
});
