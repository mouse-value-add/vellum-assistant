import { describe, expect, test } from "bun:test";

import {
  buildConnectPlan,
  classifySetupInstructions,
  type ConnectPlanContext,
} from "./connect-plan";
import { buildIntegrationItems } from "./integration-items";
import {
  mcpCatalogEntry,
  mcpServer,
  oauthConnection,
  oauthProvider,
} from "./integration-test-fixtures";

const hosted: ConnectPlanContext = {
  platformGate: "full",
  ownOAuthAvailable: false,
  catalogSupportsConnect: true,
};

function connectable(
  items: ReturnType<typeof buildIntegrationItems>,
  id: string,
) {
  const item = items.find((candidate) => candidate.id === id);
  if (!item || item.kind === "mcp") {
    throw new Error(`missing ${id}`);
  }
  return item;
}

describe("classifySetupInstructions", () => {
  test("splits guidance from preconditions per sentence", () => {
    expect(
      classifySetupInstructions(
        "Sign in to Calendly. Available actions depend on your plan and account permissions.",
      ),
    ).toEqual({
      requirements: [
        "Available actions depend on your plan and account permissions.",
      ],
      hint: "Sign in to Calendly.",
    });
  });

  test("treats a semicolon clause as its own sentence", () => {
    expect(
      classifySetupInstructions(
        "Authorize the intended Stripe account and environment; your administrator may need to enable MCP access.",
      ),
    ).toEqual({
      requirements: ["Your administrator may need to enable MCP access."],
      hint: "Authorize the intended Stripe account and environment.",
    });
  });

  test("keeps pure guidance as a hint with no requirements", () => {
    expect(
      classifySetupInstructions(
        "Sign in with the Fathom account whose meetings you want to use.",
      ),
    ).toEqual({
      requirements: [],
      hint: "Sign in with the Fathom account whose meetings you want to use.",
    });
  });
});

describe("buildConnectPlan", () => {
  const providers = [
    oauthProvider({ provider_key: "calendly", display_name: "Calendly" }),
  ];
  const catalog = [
    mcpCatalogEntry({
      id: "calendly",
      serverKey: "calendly",
      displayName: "Calendly",
      oauthProvider: "calendly",
      setup: { mode: "oauth", instructions: "Sign in to Calendly." },
    }),
    mcpCatalogEntry({
      id: "ramp",
      serverKey: "ramp",
      displayName: "Ramp",
      setup: { mode: "manual", instructions: "Ask Ramp to allowlist it." },
    }),
  ];

  test("managed OAuth leads and MCP waits behind it", () => {
    const items = buildIntegrationItems(providers, [], [], catalog);
    const plan = buildConnectPlan(connectable(items, "oauth:calendly"), hosted);
    expect(plan.primary.kind).toBe("managed-oauth");
    expect(plan.alternatives.map((method) => method.kind)).toEqual([
      "mcp-oauth",
    ]);
  });

  test("a missing platform session keeps managed OAuth in front", () => {
    const items = buildIntegrationItems(providers, [], [], catalog);
    const plan = buildConnectPlan(connectable(items, "oauth:calendly"), {
      ...hosted,
      platformGate: "disabled",
    });
    expect(plan.primary.kind).toBe("managed-oauth");
    expect(plan.primary.availability).toBe("login-required");
  });

  test("a gated platform hands the lead to the next workable path", () => {
    const items = buildIntegrationItems(providers, [], [], catalog);
    const plan = buildConnectPlan(connectable(items, "oauth:calendly"), {
      ...hosted,
      platformGate: "gated",
      ownOAuthAvailable: true,
    });
    expect(plan.primary.kind).toBe("mcp-oauth");
    expect(plan.alternatives.map((method) => method.kind)).toEqual([
      "managed-oauth",
      "own-oauth",
    ]);
  });

  test("manual catalog setup keeps its instructions as guidance", () => {
    const items = buildIntegrationItems([], [], [], catalog);
    const plan = buildConnectPlan(
      connectable(items, 'catalog:["ramp","ramp"]'),
      hosted,
    );
    expect(plan.primary.kind).toBe("mcp-manual");
    expect(plan.primary.requirements).toEqual([]);
    expect(plan.primary.hint).toBe("Ask Ramp to allowlist it.");
  });

  test("connections from every method carry their repair actions", () => {
    const items = buildIntegrationItems(
      providers,
      [
        oauthConnection({ id: "a", provider: "calendly" }),
        oauthConnection({ id: "b", provider: "calendly", connected: false }),
      ],
      [
        mcpServer({
          id: "calendly",
          lifecycleState: "needs-auth",
          hasOAuth: true,
          catalog: {
            id: "calendly",
            serverKey: "calendly",
            definitionDigest: "d",
          },
        }),
      ],
      catalog,
    );
    const plan = buildConnectPlan(connectable(items, "oauth:calendly"), hosted);
    expect(
      [plan.primary, ...plan.alternatives]
        .flatMap((method) => method.connections)
        .map((connection) => [
          connection.id,
          connection.status,
          connection.canReconnect,
        ]),
    ).toEqual([
      ["oauth:a", "connected", false],
      ["oauth:b", "needs-attention", true],
      ["mcp:calendly", "needs-attention", true],
    ]);
  });
});
