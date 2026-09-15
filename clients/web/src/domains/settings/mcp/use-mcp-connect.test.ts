import { expect, test } from "bun:test";

import {
  mcpRuntimeIsReady,
  settledMcpPollError,
} from "./use-mcp-connect";

test("waits through legacy error snapshots after auth until runtime is connected", () => {
  const snapshots = [
    [{ id: "example-server", status: "error" }],
    [{ id: "example-server", status: "error" }],
    [{ id: "example-server", status: "connected" }],
  ];

  expect(
    snapshots.map((servers) => mcpRuntimeIsReady(servers, "example-server")),
  ).toEqual([false, false, true]);
});

test("ignores a cached poll error while the retry request is in flight", () => {
  const cachedError = new Error("previous attempt failed");

  expect(settledMcpPollError(cachedError, true)).toBeNull();
  expect(settledMcpPollError(cachedError, false)).toBe(cachedError);
});
