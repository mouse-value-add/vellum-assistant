import { describe, expect, test } from "bun:test";

import { setOverridesForTesting } from "../__tests__/feature-flag-test-helpers.js";
import type { AssistantConfig } from "../config/schema.js";
import { isVirtualDesktopEnabled } from "./virtual-desktop-feature.js";

describe("isVirtualDesktopEnabled", () => {
  const config = {} as AssistantConfig;

  test("requires the flag, a container and platform hosting", () => {
    setOverridesForTesting({ "assistant-desktop": true });
    expect(isVirtualDesktopEnabled(config, true, true)).toBe(true);
    expect(isVirtualDesktopEnabled(config, false, true)).toBe(false);
    expect(isVirtualDesktopEnabled(config, true, false)).toBe(false);

    setOverridesForTesting({ "assistant-desktop": false });
    expect(isVirtualDesktopEnabled(config, true, true)).toBe(false);
  });
});
