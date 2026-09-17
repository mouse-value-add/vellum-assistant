import { afterEach, describe, expect, test } from "bun:test";

import { buildMcpStdioEnv } from "../stdio-env.js";

describe("buildMcpStdioEnv", () => {
  const previousSecret = process.env.CES_SERVICE_TOKEN;
  const previousPath = process.env.PATH;

  afterEach(() => {
    if (previousSecret === undefined) {
      delete process.env.CES_SERVICE_TOKEN;
    } else {
      process.env.CES_SERVICE_TOKEN = previousSecret;
    }
    if (previousPath === undefined) {
      delete process.env.PATH;
    } else {
      process.env.PATH = previousPath;
    }
  });

  test("does not inherit daemon secrets from process.env", () => {
    process.env.CES_SERVICE_TOKEN = "ces-secret-token";
    const env = buildMcpStdioEnv();
    expect(env.CES_SERVICE_TOKEN).toBeUndefined();
    expect(env).not.toHaveProperty("CES_SERVICE_TOKEN");
  });

  test("keeps PATH from the host environment", () => {
    process.env.PATH = "/usr/bin:/bin";
    const env = buildMcpStdioEnv();
    expect(env.PATH).toBe("/usr/bin:/bin");
  });

  test("overlays only the mcp.json env entries", () => {
    process.env.CES_SERVICE_TOKEN = "ces-secret-token";
    const env = buildMcpStdioEnv({ CUSTOM_FLAG: "1" });
    expect(env.CUSTOM_FLAG).toBe("1");
    expect(env.CES_SERVICE_TOKEN).toBeUndefined();
  });
});
