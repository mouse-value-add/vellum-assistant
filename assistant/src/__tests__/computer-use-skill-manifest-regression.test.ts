import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, describe, expect, test } from "bun:test";

import { RiskLevel } from "../permissions/types.js";
import { allComputerUseTools } from "../tools/computer-use/definitions.js";
import {
  __resetRegistryForTesting,
  getTool,
  initializeTools,
  registerSkillTools,
  unregisterSkillTools,
} from "../tools/registry.js";
import type { Tool } from "../tools/types.js";
import {
  COMPUTER_USE_TOOL_COUNT,
  COMPUTER_USE_TOOL_NAMES,
} from "./test-support/computer-use-skill-harness.js";

afterAll(() => {
  __resetRegistryForTesting();
});

// Load the TOOLS.json manifest
const manifestPath = resolve(
  import.meta.dirname,
  "../config/bundled-skills/computer-use/TOOLS.json",
);
const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));

describe("computer-use skill manifest regression", () => {
  test("manifest tool count matches the harness", () => {
    expect(manifest.tools).toHaveLength(COMPUTER_USE_TOOL_COUNT);
  });

  test("manifest version is 1", () => {
    expect(manifest.version).toBe(1);
  });

  test("manifest tool names match harness constants", () => {
    const manifestNames = manifest.tools.map((t: { name: string }) => t.name);
    for (const name of COMPUTER_USE_TOOL_NAMES) {
      expect(manifestNames).toContain(name);
    }
    // No extra tools
    expect(manifestNames).toHaveLength(COMPUTER_USE_TOOL_COUNT);
  });

  test("all manifest tools have execution_target: host", () => {
    for (const tool of manifest.tools) {
      expect(tool.execution_target).toBe("host");
    }
  });

  test("computer_use_start is the session's one approval; every other tool is low risk", () => {
    // The consent boundary is the session, not the individual click. Flipping
    // any of these back to medium reinstates a prompt per action, which is the
    // thing this manifest exists to prevent.
    const start = manifest.tools.find(
      (t: { name: string }) => t.name === "computer_use_start",
    );
    expect(start).toBeDefined();
    expect(start.risk).toBe("medium");
    expect(start.input_schema.required).toEqual(["task"]);

    for (const tool of manifest.tools) {
      if (tool.name !== "computer_use_start") {
        expect(tool.risk).toBe("low");
      }
    }
  });

  test("manifest risk matches core definitions", async () => {
    await initializeTools();

    // These two drifted for real once: every definition said low while the
    // actuating manifest entries said medium. Assert the manifest value
    // against the definition so they cannot drift again.
    for (const cuTool of allComputerUseTools) {
      const manifestTool = manifest.tools.find(
        (t: { name: string }) => t.name === cuTool.name,
      );
      expect(manifestTool).toBeDefined();
      expect(manifestTool.risk).toBe(cuTool.defaultRiskLevel);
    }
  });

  test("all manifest tools have category: computer-use", () => {
    for (const tool of manifest.tools) {
      expect(tool.category).toBe("computer-use");
    }
  });

  test("manifest descriptions match core definitions", async () => {
    await initializeTools();

    for (const cuTool of allComputerUseTools) {
      const manifestTool = manifest.tools.find(
        (t: { name: string }) => t.name === cuTool.name,
      );
      expect(manifestTool).toBeDefined();
      expect(manifestTool.description).toBe(cuTool.description);
    }
  });

  test("manifest input_schema matches core definitions", async () => {
    await initializeTools();

    for (const cuTool of allComputerUseTools) {
      const manifestTool = manifest.tools.find(
        (t: { name: string }) => t.name === cuTool.name,
      );
      expect(manifestTool).toBeDefined();
      expect(manifestTool.input_schema).toEqual(cuTool.input_schema);
    }
  });

  test("CU action tools are not registered as core tools after initializeTools()", async () => {
    await initializeTools();

    // The 12 computer_use_* action tools must NOT be in the global registry
    // after initializeTools(). If they were, registerSkillTools() would skip
    // them as core tool collisions when the computer-use skill is activated.
    for (const name of COMPUTER_USE_TOOL_NAMES) {
      expect(getTool(name)).toBeUndefined();
    }
  });

  test("registerSkillTools succeeds for manifest tool names after initializeTools()", async () => {
    await initializeTools();

    // Simulate what projectSkillTools() does when the computer-use skill is
    // activated: create Tool objects matching the manifest names and register
    // them through `registerSkillTools(skillId, tools)`, which records
    // ownership in the registry's `ownersByName` map. This must not throw.
    const skillTools: Tool[] = manifest.tools.map(
      (entry: { name: string; description: string }) => ({
        name: entry.name,
        description: entry.description,
        input_schema: { type: "object" as const, properties: {} },
        category: "computer-use",
        defaultRiskLevel: RiskLevel.Low,
        execute: async () => ({ content: "stub", isError: false }),
      }),
    );

    // Owner flows in through `registerSkillTools(skillId, tools)` and lands
    // in the registry's `ownersByName` map — the tools themselves carry no
    // per-tool owner field.
    expect(() => registerSkillTools("computer-use", skillTools)).not.toThrow();

    // Clean up
    unregisterSkillTools("computer-use");
  });
});
