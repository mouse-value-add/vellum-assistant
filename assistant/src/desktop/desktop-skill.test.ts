import { afterEach, expect, test } from "bun:test";

import { setOverridesForTesting } from "../__tests__/feature-flag-test-helpers.js";
import { skillLoadTool } from "../tools/skills/load.js";

const context = {
  conversationId: "conv-123",
  sourceActorPrincipalId: "user-123",
  trustClass: "guardian" as const,
  workingDir: process.env.VELLUM_WORKSPACE_DIR!,
};
afterEach(() => setOverridesForTesting({}));

test("desktop browser instructions are unavailable with the feature off", async () => {
  setOverridesForTesting({ "assistant-desktop": false });
  const result = await skillLoadTool.execute(
    { skill: "assistant-desktop" },
    context,
  );
  expect(result.isError).toBe(true);
  expect(result.content).toContain("disabled by feature flag");
});

test("desktop browser instructions load without a connected host client", async () => {
  setOverridesForTesting({ "assistant-desktop": true });
  const result = await skillLoadTool.execute(
    { skill: "assistant-desktop" },
    context,
  );
  expect(result.isError).toBe(false);
  expect(result.content).toContain("assistant browser --desktop");
});
