import type { OAuthConnection } from "@/generated/api/types.gen";
import type { PlatformGateState } from "@/hooks/use-platform-gate";

import {
  mcpLifecycleState,
  supportsMcpAction,
  type CatalogMethod,
  type IntegrationItem,
} from "./integration-items";
import type { McpCatalogEntry } from "./mcp/mcp-catalog-api";
import type { McpServerEntry } from "./mcp/mcp-api";

/**
 * Every way a user can connect an integration, collapsed to the four shapes
 * the UI has to explain differently:
 *
 * - `managed-oauth`: sign in through Vellum's hosted OAuth app. Needs a
 *   platform session. This is the path nearly every user takes.
 * - `own-oauth`: register an OAuth app at the provider and paste its client
 *   credentials. Self-hosted assistants only.
 * - `mcp-oauth`: a remote MCP server that runs its own sign-in.
 * - `mcp-manual`: a remote MCP server whose provider must allowlist our
 *   callback URL before sign-in can work.
 */
export type ConnectMethodKind =
  | "managed-oauth"
  | "own-oauth"
  | "mcp-oauth"
  | "mcp-manual";

export type ConnectAvailability =
  | "available"
  | "login-required"
  | "unsupported";

export type ConnectionStatus =
  | "connected"
  | "needs-attention"
  | "connecting"
  | "declared"
  | "not-started";

export interface ConnectionSummary {
  id: string;
  methodId: string;
  methodKind: ConnectMethodKind;
  /** Account email, workspace name, or server instance id. Null falls back to "{name} account". */
  label: string | null;
  /** Secondary line: endpoint hostname for MCP instances. */
  detail?: string;
  status: ConnectionStatus;
  canReconnect: boolean;
  canConfigure: boolean;
  canDisconnect: boolean;
}

export interface ConnectMethod {
  id: string;
  kind: ConnectMethodKind;
  availability: ConnectAvailability;
  /** Conditions the user must satisfy outside Vellum before this method works. */
  requirements: string[];
  /** One sentence of guidance shown beside the connect action. */
  hint?: string;
  setupGuideUrl?: string;
  connections: ConnectionSummary[];
  catalogEntry?: McpCatalogEntry;
}

export interface ConnectPlan {
  name: string;
  description: string | null;
  iconKey: string;
  logoUrl: string | null;
  endpointUrl?: string;
  /** The recommended path. Rendered as the one obvious action. */
  primary: ConnectMethod;
  /** Every other path, behind a disclosure. */
  alternatives: ConnectMethod[];
}

export interface ConnectPlanContext {
  platformGate: PlatformGateState;
  /** Bring-your-own OAuth apps only exist on self-hosted assistants. */
  ownOAuthAvailable: boolean;
  /** False when the daemon predates catalog connect. */
  catalogSupportsConnect: boolean;
}

export type ConnectableIntegrationItem = Exclude<
  IntegrationItem,
  { kind: "mcp" }
>;

/**
 * Sentences that describe a precondition rather than sign-in guidance.
 *
 * The catalog has one free-text `setup.instructions` slot that mixes
 * "sign in with the account you want" with "an admin must enable MCP".
 * Until the catalog schema splits those, classify per sentence so the
 * modal can show requirements as a warning and guidance as a hint.
 */
const REQUIREMENT_PATTERN =
  /\b(must|requires?|required|not supported|unavailable|may need|plan\b|subscription|role in|consume|count against|allowlist|regional endpoint|serves|depend on|experimental|units)\b/i;

export function classifySetupInstructions(instructions?: string): {
  requirements: string[];
  hint?: string;
} {
  if (!instructions) {
    return { requirements: [] };
  }
  const sentences = instructions
    .split(/(?<=[.;!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    .map((sentence) =>
      sentence.endsWith(";")
        ? `${sentence.slice(0, -1)}.`
        : /[.!?]$/.test(sentence)
          ? sentence
          : `${sentence}.`,
    )
    .map((sentence) => sentence.charAt(0).toUpperCase() + sentence.slice(1));
  const requirements = sentences.filter((sentence) =>
    REQUIREMENT_PATTERN.test(sentence),
  );
  const hints = sentences.filter(
    (sentence) => !REQUIREMENT_PATTERN.test(sentence),
  );
  return {
    requirements,
    hint: hints.length > 0 ? hints.join(" ") : undefined,
  };
}

function mcpConnectionStatus(server: McpServerEntry): ConnectionStatus {
  const state = mcpLifecycleState(server);
  switch (state) {
    case "connected":
    case "connecting":
    case "declared":
    case "not-started":
      return state;
    default:
      return "needs-attention";
  }
}

function endpointHostname(url?: string): string | undefined {
  if (!url) {
    return undefined;
  }
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

function mcpConnections(
  method: CatalogMethod,
  methodId: string,
  kind: ConnectMethodKind,
): ConnectionSummary[] {
  return method.servers.map((server) => {
    const status = mcpConnectionStatus(server);
    const oauthRepairable =
      (status === "needs-attention" || status === "not-started") &&
      server.transport.type !== "stdio" &&
      !server.hasStaticAuth &&
      supportsMcpAction(server, "authenticate");
    return {
      id: `mcp:${server.id}`,
      methodId,
      methodKind: kind,
      label: server.id,
      detail: endpointHostname(server.transport.url),
      status,
      canReconnect: oauthRepairable,
      canConfigure: supportsMcpAction(server, "configure"),
      canDisconnect: supportsMcpAction(server, "remove"),
    };
  });
}

function oauthConnections(
  connections: OAuthConnection[],
  methodId: string,
): ConnectionSummary[] {
  return connections.map((connection) => ({
    id: `oauth:${connection.id}`,
    methodId,
    methodKind: "managed-oauth",
    label: connection.account_label ?? null,
    status: connection.connected ? "connected" : "needs-attention",
    canReconnect: !connection.connected,
    canConfigure: false,
    canDisconnect: true,
  }));
}

function catalogMethod(
  method: CatalogMethod,
  context: ConnectPlanContext,
): ConnectMethod {
  const { definition } = method;
  const kind: ConnectMethodKind =
    definition.setup.mode === "manual" ? "mcp-manual" : "mcp-oauth";
  const id = `mcp:${definition.id}:${definition.serverKey}`;
  // Manual setup renders its instructions as the allowlisting step, so they
  // are guidance there rather than a warning above it.
  const { requirements, hint } =
    kind === "mcp-manual"
      ? { requirements: [], hint: definition.setup.instructions }
      : classifySetupInstructions(definition.setup.instructions);
  return {
    id,
    kind,
    availability: context.catalogSupportsConnect ? "available" : "unsupported",
    requirements,
    hint,
    setupGuideUrl: definition.documentationUrl,
    connections: mcpConnections(method, id, kind),
    catalogEntry: definition,
  };
}

function managedAvailability(gate: PlatformGateState): ConnectAvailability {
  switch (gate) {
    case "full":
      return "available";
    case "disabled":
      return "login-required";
    default:
      return "unsupported";
  }
}

/**
 * Decide which path to put in front of the user and which to tuck away.
 *
 * Order of preference: Vellum's managed OAuth (works everywhere, no setup),
 * then MCP catalog methods, then bring-your-own OAuth. A method that cannot
 * work here at all (`unsupported`) never leads; one that only needs a login
 * still leads, because logging in is the fix.
 */
export function buildConnectPlan(
  item: ConnectableIntegrationItem,
  context: ConnectPlanContext,
): ConnectPlan {
  const methods: ConnectMethod[] = [];
  let iconKey: string;
  let logoUrl: string | null = null;
  let description: string | null;
  let endpointUrl: string | undefined;

  if (item.kind === "oauth") {
    const managedId = `managed:${item.provider.provider_key}`;
    iconKey = item.provider.provider_key;
    logoUrl = item.provider.logo_url;
    description = item.provider.description;
    methods.push({
      id: managedId,
      kind: "managed-oauth",
      availability: managedAvailability(context.platformGate),
      requirements: [],
      connections: oauthConnections(item.connections, managedId),
    });
    for (const method of item.methods) {
      methods.push(catalogMethod(method, context));
    }
    if (context.ownOAuthAvailable) {
      methods.push({
        id: `own:${item.provider.provider_key}`,
        kind: "own-oauth",
        availability: "available",
        requirements: [],
        setupGuideUrl: item.provider.dashboard_url ?? undefined,
        connections: [],
      });
    }
  } else {
    const { definition } = item.method;
    iconKey = definition.icon ?? definition.id;
    description = definition.description;
    endpointUrl =
      definition.documents.mcp?.mcpServers?.[definition.serverKey]?.url;
    methods.push(catalogMethod(item.method, context));
  }

  const primary =
    methods.find((method) => method.availability !== "unsupported") ??
    methods[0]!;
  return {
    name: item.name,
    description,
    iconKey,
    logoUrl,
    endpointUrl,
    primary,
    alternatives: methods.filter((method) => method !== primary),
  };
}

export function planConnections(plan: ConnectPlan): ConnectionSummary[] {
  return [plan.primary, ...plan.alternatives].flatMap(
    (method) => method.connections,
  );
}
