import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { Button } from "@vellumai/design-library/components/button";
import { Input } from "@vellumai/design-library/components/input";

import {
  buildConnectPlan,
  type ConnectPlanContext,
  type ConnectableIntegrationItem,
} from "../connect-plan";
import { buildIntegrationItems } from "../integration-items";
import {
  mcpCatalogEntry,
  mcpServer,
  oauthConnection,
  oauthProvider,
} from "../integration-test-fixtures";
import {
  IntegrationConnectModal,
  type IntegrationConnectModalProps,
} from "./integration-connect-modal";

/*
 * Every story derives its plan through `buildConnectPlan()` from the same
 * fixtures the page uses, so what renders here is what the real list would
 * hand the modal for that integration. Change the derivation and the stories
 * follow.
 */

const PLATFORM_HOSTED: ConnectPlanContext = {
  platformGate: "full",
  ownOAuthAvailable: false,
  catalogSupportsConnect: true,
};

const SELF_HOSTED: ConnectPlanContext = {
  platformGate: "full",
  ownOAuthAvailable: true,
  catalogSupportsConnect: true,
};

const providers = [
  oauthProvider({
    provider_key: "github",
    display_name: "GitHub",
    description: "Repositories and issues",
  }),
  oauthProvider({
    provider_key: "twitter",
    display_name: "Twitter",
    description: "Posts and direct messages",
    managed_service_is_paid: true,
  }),
  oauthProvider({
    provider_key: "google",
    display_name: "Google",
    description: "Gmail, Calendar, Drive, Docs, Sheets, Slides, and Contacts",
  }),
  oauthProvider({
    provider_key: "calendly",
    display_name: "Calendly",
    description: "Scheduling links and meetings",
  }),
];

const catalog = [
  mcpCatalogEntry({
    id: "fathom",
    serverKey: "fathom",
    displayName: "Fathom",
    icon: "fathom",
    description: "Search meeting transcripts and summaries.",
    documentationUrl: "https://developers.fathom.ai/mcp-docs",
    setup: {
      mode: "oauth",
      instructions:
        "Sign in with the Fathom account whose meetings you want to use.",
    },
  }),
  mcpCatalogEntry({
    id: "ashby",
    serverKey: "ashby",
    displayName: "Ashby",
    icon: "ashby",
    description:
      "Search candidates, prepare interviews, and manage recruiting pipelines.",
    documentationUrl: "https://docs.ashbyhq.com/ashby-mcp-server-beta",
    setup: {
      mode: "oauth",
      instructions:
        "An organization admin must enable MCP. Analytics-only organizations are not supported.",
    },
  }),
  mcpCatalogEntry({
    id: "stripe",
    serverKey: "stripe",
    displayName: "Stripe",
    icon: "stripe",
    description: "Look up customers, payments, and subscriptions.",
    documentationUrl: "https://docs.stripe.com/mcp",
    setup: {
      mode: "oauth",
      instructions:
        "Authorize the intended Stripe account and environment; your administrator may need to enable MCP access.",
    },
  }),
  mcpCatalogEntry({
    id: "ramp",
    serverKey: "ramp",
    displayName: "Ramp",
    icon: "ramp",
    description: "Explore expenses, bills, and company spending.",
    documentationUrl: "https://docs.ramp.com/developer-api/v1/guides/mcp",
    setup: {
      mode: "manual",
      instructions:
        "Ask Ramp to allowlist this client or gateway's exact OAuth redirect URI before connecting.",
    },
  }),
  mcpCatalogEntry({
    id: "calendly",
    serverKey: "calendly",
    displayName: "Calendly",
    icon: "calendly",
    oauthProvider: "calendly",
    description: "Review availability, scheduling links, and planned events.",
    documentationUrl: "https://developer.calendly.com/mcp",
    setup: {
      mode: "oauth",
      instructions:
        "Sign in to Calendly. Available actions depend on your plan and account permissions.",
    },
  }),
];

function item(
  id: string,
  options: {
    connections?: ReturnType<typeof oauthConnection>[];
    servers?: ReturnType<typeof mcpServer>[];
  } = {},
): ConnectableIntegrationItem {
  const items = buildIntegrationItems(
    providers,
    options.connections ?? [],
    options.servers ?? [],
    catalog,
  );
  const found = items.find((candidate) => candidate.id === id);
  if (!found || found.kind === "mcp") {
    throw new Error(`No connectable fixture item ${id}`);
  }
  return found;
}

function OwnOAuthForm() {
  return (
    <div className="space-y-3">
      <p className="text-body-small-lighter text-[var(--content-tertiary)]">
        Credentials are stored encrypted on the assistant and are never sent to
        Vellum.
      </p>
      <Input label="Redirect URL" readOnly value="https://gateway.example.test/oauth/callback" fullWidth />
      <Input label="Client ID" placeholder="Enter your client ID" fullWidth />
      <Input label="Client Secret" placeholder="Enter your client secret" type="password" fullWidth />
      <Button>Add app</Button>
    </div>
  );
}

function Harness(props: Partial<IntegrationConnectModalProps> & Pick<IntegrationConnectModalProps, "plan">) {
  const [copied, setCopied] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const record = (entry: string) => setLog((prev) => [entry, ...prev].slice(0, 6));
  return (
    <>
      <ul className="space-y-1 text-body-small-default text-[var(--content-tertiary)]">
        {log.map((entry, index) => (
          <li key={`${entry}-${index}`}>{entry}</li>
        ))}
      </ul>
      <IntegrationConnectModal
        ownOAuthContent={<OwnOAuthForm />}
        onConnect={(method, options) =>
          record(`connect ${method.kind} ${JSON.stringify(options ?? {})}`)
        }
        onLogin={() => record("login")}
        onCancelAttempt={() => record("cancel attempt")}
        onRetryAttempt={() => record("retry attempt")}
        onReconnect={(connection) => record(`reconnect ${connection.id}`)}
        onConfigure={(connection) => record(`configure ${connection.id}`)}
        onDisconnect={(connection) => record(`disconnect ${connection.id}`)}
        onCopyCallbackUrl={() => setCopied(true)}
        callbackCopied={copied}
        onOpenSetupGuide={(url) => record(`open ${url}`)}
        onClose={() => record("close")}
        {...props}
      />
    </>
  );
}

const meta: Meta<typeof Harness> = {
  title: "Settings/IntegrationConnectModal",
  component: Harness,
  parameters: { layout: "fullscreen" },
};
export default meta;
type Story = StoryObj<typeof Harness>;

/** The P99 case: a Vellum-managed OAuth provider, signed in, nothing connected yet. */
export const OAuthManaged: Story = {
  args: { plan: buildConnectPlan(item("oauth:github"), PLATFORM_HOSTED) },
};

/** Replaces the Managed / Your Own tab dialog with a dead "Log In" link. */
export const OAuthLoginRequired: Story = {
  args: {
    plan: buildConnectPlan(item("oauth:twitter"), {
      ...PLATFORM_HOSTED,
      platformGate: "disabled",
    }),
  },
};

/** Self-hosted: bring-your-own OAuth app exists but stays behind the disclosure. */
export const OAuthSelfHosted: Story = {
  args: { plan: buildConnectPlan(item("oauth:google"), SELF_HOSTED) },
};

/** Platform disabled and self-hosted: bring-your-own is the only path, so it leads. */
export const OAuthOwnAppOnly: Story = {
  args: {
    plan: buildConnectPlan(item("oauth:google"), {
      ...SELF_HOSTED,
      platformGate: "gated",
    }),
  },
};

/** MCP catalog entry whose instructions are pure sign-in guidance. */
export const McpOAuthHint: Story = {
  args: { plan: buildConnectPlan(item("catalog:[\"fathom\",\"fathom\"]"), PLATFORM_HOSTED) },
};

/** MCP catalog entry with admin preconditions, surfaced as a warning. */
export const McpOAuthRequirements: Story = {
  args: { plan: buildConnectPlan(item("catalog:[\"ashby\",\"ashby\"]"), PLATFORM_HOSTED) },
};

/** Instructions that mix guidance and a requirement split into both. */
export const McpOAuthMixed: Story = {
  args: { plan: buildConnectPlan(item("catalog:[\"stripe\",\"stripe\"]"), PLATFORM_HOSTED) },
};

/** Redirect-URI allowlisting: the callback URL loads on open, steps gate Connect. */
export const McpManualSetup: Story = {
  args: {
    plan: buildConnectPlan(item("catalog:[\"ramp\",\"ramp\"]"), PLATFORM_HOSTED),
    callbackUrl: {
      status: "ready",
      url: "https://gateway.vellum.ai/a/3f9c/webhooks/oauth/callback",
    },
  },
};

export const McpManualSetupLoading: Story = {
  args: {
    plan: buildConnectPlan(item("catalog:[\"ramp\",\"ramp\"]"), PLATFORM_HOSTED),
    callbackUrl: { status: "loading" },
  },
};

/** Both a Vellum connection and an MCP server exist. Vellum leads, MCP is one click away. */
export const BothMethods: Story = {
  args: { plan: buildConnectPlan(item("oauth:calendly"), PLATFORM_HOSTED) },
};

/** Same integration on a self-hosted assistant: three paths, still one obvious action. */
export const BothMethodsSelfHosted: Story = {
  args: { plan: buildConnectPlan(item("oauth:calendly"), SELF_HOSTED) },
};

export const WaitingForBrowser: Story = {
  args: {
    plan: buildConnectPlan(item("catalog:[\"fathom\",\"fathom\"]"), PLATFORM_HOSTED),
    attempt: {
      methodId: "mcp:fathom:fathom",
      phase: "authorizing",
      canCancel: true,
    },
  },
};

export const SignInWindowClosed: Story = {
  args: {
    plan: buildConnectPlan(item("catalog:[\"fathom\",\"fathom\"]"), PLATFORM_HOSTED),
    attempt: {
      methodId: "mcp:fathom:fathom",
      phase: "waiting",
      canCancel: true,
    },
  },
};

export const ConnectFailed: Story = {
  args: {
    plan: buildConnectPlan(item("catalog:[\"ashby\",\"ashby\"]"), PLATFORM_HOSTED),
    attempt: {
      methodId: "mcp:ashby:ashby",
      phase: "error",
      error: "Your browser blocked the sign-in window. Allow pop-ups and try again.",
      canCancel: false,
    },
  },
};

/** Daemon predates catalog connect: explain instead of a silently disabled button. */
export const McpUnsupported: Story = {
  args: {
    plan: buildConnectPlan(item("catalog:[\"ashby\",\"ashby\"]"), {
      ...PLATFORM_HOSTED,
      catalogSupportsConnect: false,
    }),
  },
};

/** After connecting: the same modal lists every connection, whatever method made it. */
export const Connected: Story = {
  args: {
    plan: buildConnectPlan(
      item("oauth:calendly", {
        connections: [
          oauthConnection({
            id: "cal-1",
            provider: "calendly",
            account_label: "sam@example.com",
          }),
          oauthConnection({
            id: "cal-2",
            provider: "calendly",
            connected: false,
            account_label: "ops@example.com",
          }),
        ],
        servers: [
          mcpServer({
            id: "calendly",
            lifecycleState: "needs-auth",
            hasOAuth: true,
            transport: {
              type: "streamable-http",
              url: "https://mcp.calendly.com/mcp",
            },
            catalog: {
              id: "calendly",
              serverKey: "calendly",
              definitionDigest: "digest",
            },
          }),
        ],
      }),
      PLATFORM_HOSTED,
    ),
  },
};

export const ConnectedSingleAccount: Story = {
  args: {
    plan: buildConnectPlan(
      item("oauth:github", {
        connections: [
          oauthConnection({
            id: "gh-1",
            provider: "github",
            account_label: "example-user",
          }),
        ],
      }),
      PLATFORM_HOSTED,
    ),
  },
};

export const Mobile: Story = {
  args: BothMethodsSelfHosted.args,
  globals: { viewport: { value: "sbNarrowPhone", isRotated: false } },
};
