import {
  ArrowLeft,
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  Loader2,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Settings,
  Trash2,
  X,
} from "lucide-react";
import { useState, type ReactNode } from "react";

import { ActionMenu } from "@vellumai/design-library/components/action-menu";
import { Button } from "@vellumai/design-library/components/button";
import { Checkbox } from "@vellumai/design-library/components/checkbox";
import { Collapsible } from "@vellumai/design-library/components/collapsible";
import { ListRow } from "@vellumai/design-library/components/list-row";
import { Modal } from "@vellumai/design-library/components/modal";
import { Notice } from "@vellumai/design-library/components/notice";
import { Tag, type TagTone } from "@vellumai/design-library/components/tag";

import { IntegrationIcon } from "@/components/integrations/integration-icon";
import { useTranslation } from "@/i18n";

import {
  planConnections,
  type ConnectMethod,
  type ConnectPlan,
  type ConnectionStatus,
  type ConnectionSummary,
} from "../connect-plan";
import { getMcpFaviconUrl } from "../mcp/mcp-favicon";

export interface ConnectAttempt {
  methodId: string;
  phase:
    | "starting"
    | "authorizing"
    | "waiting"
    | "connecting"
    | "error"
    | "cancellationCleanup";
  error?: string;
  canCancel: boolean;
  isCancelling?: boolean;
}

export interface CallbackUrlState {
  status: "loading" | "ready" | "error";
  url?: string;
}

export interface IntegrationConnectModalProps {
  plan: ConnectPlan;
  attempt?: ConnectAttempt | null;
  /** Only read for `mcp-manual` methods. */
  callbackUrl?: CallbackUrlState;
  callbackCopied?: boolean;
  /** The bring-your-own OAuth form. Rendered when the user picks that path. */
  ownOAuthContent?: ReactNode;
  onConnect: (
    method: ConnectMethod,
    options?: { acknowledged?: boolean },
  ) => void;
  onLogin: () => void;
  onCancelAttempt: () => void;
  onRetryAttempt: () => void;
  onReconnect: (connection: ConnectionSummary) => void;
  onConfigure: (connection: ConnectionSummary) => void;
  onDisconnect: (connection: ConnectionSummary) => void;
  onCopyCallbackUrl: (url: string) => void;
  onOpenSetupGuide: (url: string) => void;
  onClose: () => void;
}

const STATUS_TONE: Record<ConnectionStatus, TagTone> = {
  connected: "positive",
  "needs-attention": "negative",
  connecting: "neutral",
  declared: "neutral",
  "not-started": "neutral",
};

/**
 * One modal for every way an integration can be connected.
 *
 * The plan decides what leads: the body shows a single method with its
 * requirements, guidance, and in-flight state, and the footer holds one
 * primary action. Every other method sits behind "Other ways to connect".
 * Once anything is connected, the same modal lists the connections and
 * offers to add more.
 */
export function IntegrationConnectModal({
  plan,
  attempt,
  callbackUrl,
  callbackCopied = false,
  ownOAuthContent,
  onConnect,
  onLogin,
  onCancelAttempt,
  onRetryAttempt,
  onReconnect,
  onConfigure,
  onDisconnect,
  onCopyCallbackUrl,
  onOpenSetupGuide,
  onClose,
}: IntegrationConnectModalProps) {
  const { t } = useTranslation("settings");
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const connections = planConnections(plan);
  // A path that cannot work here is not an alternative worth offering.
  const alternatives = plan.alternatives.filter(
    (candidate) => candidate.availability !== "unsupported",
  );
  const focused =
    plan.alternatives.find((method) => method.id === focusedId) ?? null;
  const method = focused ?? plan.primary;
  const showingConnections = !focused && connections.length > 0;
  const methodAttempt = attempt?.methodId === method.id ? attempt : null;
  const busy = Boolean(
    attempt && attempt.phase !== "error" && attempt.phase !== "cancellationCleanup",
  );
  const title = showingConnections
    ? plan.name
    : t("integrationConnect.title", { name: plan.name });
  const manualReady =
    method.kind !== "mcp-manual" ||
    (callbackUrl?.status === "ready" && acknowledged);

  const primaryAction = (() => {
    if (showingConnections) {
      return (
        <Button variant="outlined" className="min-h-11" onClick={onClose}>
          {t("integrationConnect.done")}
        </Button>
      );
    }
    if (method.kind === "own-oauth") {
      return null;
    }
    if (method.availability === "login-required") {
      return (
        <Button className="min-h-11" onClick={onLogin}>
          {t("integrationConnect.login")}
        </Button>
      );
    }
    return (
      <Button
        className="min-h-11"
        disabled={
          method.availability === "unsupported" || busy || !manualReady
        }
        leftIcon={
          methodAttempt && busy ? <Loader2 className="animate-spin" /> : undefined
        }
        onClick={() => onConnect(method, { acknowledged })}
      >
        {t("integrationConnect.connect")}
      </Button>
    );
  })();

  return (
    <Modal.Root
      open
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <Modal.Content
        hideCloseButton
        className="max-h-full"
        overlayClassName="pt-[max(1rem,var(--safe-area-inset-top,env(safe-area-inset-top,0px)))] pb-[max(1rem,var(--safe-area-inset-bottom,env(safe-area-inset-bottom,0px)))]"
      >
        <Modal.Header className="pr-14">
          <div className="flex min-w-0 items-center gap-3">
            <IntegrationIcon
              providerKey={plan.iconKey}
              displayName={plan.name}
              logoUrl={plan.logoUrl}
              fallbackLogoUrl={getMcpFaviconUrl(plan.endpointUrl)}
              size={40}
            />
            <div className="min-w-0">
              <Modal.Title className="[overflow-wrap:anywhere] [&>span]:whitespace-normal">
                {title}
              </Modal.Title>
              {plan.description ? (
                <Modal.Description>{plan.description}</Modal.Description>
              ) : null}
            </div>
          </div>
        </Modal.Header>
        <Modal.Close asChild>
          <Button
            variant="ghost"
            iconOnly={<X />}
            className="absolute right-2 top-2 min-h-11 min-w-11"
            aria-label={t("integrationConnect.close")}
          />
        </Modal.Close>
        <Modal.Body className="min-h-0 space-y-4">
          {focused ? (
            <Button
              variant="ghost"
              size="compact"
              leftIcon={<ArrowLeft />}
              onClick={() => setFocusedId(null)}
            >
              {t("integrationConnect.back")}
            </Button>
          ) : null}
          {showingConnections ? (
            <ConnectionsList
              plan={plan}
              connections={connections}
              busy={busy}
              onReconnect={onReconnect}
              onConfigure={onConfigure}
              onDisconnect={onDisconnect}
              onAdd={() => onConnect(plan.primary)}
            />
          ) : method.kind === "own-oauth" ? (
            ownOAuthContent
          ) : (
            <MethodBody
              plan={plan}
              method={method}
              attempt={methodAttempt}
              callbackUrl={callbackUrl}
              callbackCopied={callbackCopied}
              acknowledged={acknowledged}
              onAcknowledgedChange={setAcknowledged}
              onCancelAttempt={onCancelAttempt}
              onRetryAttempt={onRetryAttempt}
              onCopyCallbackUrl={onCopyCallbackUrl}
            />
          )}
          {!focused && alternatives.length > 0 ? (
            <Alternatives
              plan={plan}
              alternatives={alternatives}
              busy={busy}
              onSelect={(alternative) => {
                setAcknowledged(false);
                setFocusedId(alternative.id);
              }}
            />
          ) : null}
        </Modal.Body>
        <Modal.Footer className="items-center">
          {method.setupGuideUrl ? (
            <Button
              variant="ghost"
              className="mr-auto min-h-11"
              rightIcon={<ExternalLink />}
              onClick={() => onOpenSetupGuide(method.setupGuideUrl!)}
            >
              {t("integrationConnect.setupGuide")}
            </Button>
          ) : null}
          {showingConnections ? null : (
            <Button variant="ghost" className="min-h-11" onClick={onClose}>
              {t("integrationConnect.cancel")}
            </Button>
          )}
          {primaryAction}
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
}

function MethodBody({
  plan,
  method,
  attempt,
  callbackUrl,
  callbackCopied,
  acknowledged,
  onAcknowledgedChange,
  onCancelAttempt,
  onRetryAttempt,
  onCopyCallbackUrl,
}: {
  plan: ConnectPlan;
  method: ConnectMethod;
  attempt: ConnectAttempt | null;
  callbackUrl?: CallbackUrlState;
  callbackCopied: boolean;
  acknowledged: boolean;
  onAcknowledgedChange: (next: boolean) => void;
  onCancelAttempt: () => void;
  onRetryAttempt: () => void;
  onCopyCallbackUrl: (url: string) => void;
}) {
  const { t } = useTranslation("settings");
  const name = plan.name;
  return (
    <div className="space-y-4">
      {method.availability === "login-required" ? (
        <Notice tone="info">
          {t("integrationConnect.loginNotice", { name })}
        </Notice>
      ) : null}
      {method.availability === "unsupported" ? (
        <Notice tone="neutral">
          {t("integrationConnect.unsupportedNotice", { name })}
        </Notice>
      ) : null}
      {attempt ? (
        <AttemptNotice
          name={name}
          attempt={attempt}
          requirements={method.requirements}
          onCancel={onCancelAttempt}
          onRetry={onRetryAttempt}
        />
      ) : null}
      {method.kind === "mcp-manual" ? (
        <ManualSteps
          name={name}
          hint={method.hint}
          callbackUrl={callbackUrl}
          callbackCopied={callbackCopied}
          acknowledged={acknowledged}
          onAcknowledgedChange={onAcknowledgedChange}
          onCopyCallbackUrl={onCopyCallbackUrl}
        />
      ) : method.availability === "available" && !attempt ? (
        <p className="text-body-medium-lighter text-[var(--content-secondary)]">
          {method.hint ?? t("integrationConnect.signInHint", { name })}
        </p>
      ) : null}
    </div>
  );
}

/**
 * In-flight and failed states for the method on screen. Provider
 * preconditions (an admin has to enable MCP, a plan tier is required) only
 * surface here, after a failure, as the likely causes. Up front they are
 * noise for the many users they do not apply to.
 */
function AttemptNotice({
  name,
  attempt,
  requirements,
  onCancel,
  onRetry,
}: {
  name: string;
  attempt: ConnectAttempt;
  requirements: string[];
  onCancel: () => void;
  onRetry: () => void;
}) {
  const { t } = useTranslation("settings");
  const failed =
    attempt.phase === "error" || attempt.phase === "cancellationCleanup";
  const message =
    attempt.error ??
    (attempt.phase === "connecting"
      ? t("integrationConnect.connecting", { name })
      : attempt.phase === "waiting"
        ? t("integrationConnect.waitingWindowClosed", { name })
        : t("integrationConnect.waiting", { name }));
  return (
    <Notice
      tone={failed ? "error" : "info"}
      icon={failed ? undefined : <Loader2 className="size-4 animate-spin" />}
      actions={
        <div className="flex flex-wrap gap-2">
          {failed || attempt.phase === "waiting" ? (
            <Button
              variant="outlined"
              size="compact"
              onClick={onRetry}
              disabled={attempt.isCancelling}
            >
              {t("integrationConnect.retry")}
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="compact"
            onClick={onCancel}
            disabled={attempt.isCancelling}
          >
            {attempt.canCancel
              ? t("integrationConnect.cancelAttempt")
              : t("integrationConnect.stopWaiting")}
          </Button>
        </div>
      }
    >
      <div className="space-y-2">
        <p>{message}</p>
        {failed && requirements.length > 0 ? (
          <div className="space-y-1 text-body-small-default">
            <p>{t("integrationConnect.failureCauses")}</p>
            <ul className="list-disc space-y-1 pl-4">
              {requirements.map((requirement) => (
                <li key={requirement}>{requirement}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </Notice>
  );
}

function ManualSteps({
  name,
  hint,
  callbackUrl,
  callbackCopied,
  acknowledged,
  onAcknowledgedChange,
  onCopyCallbackUrl,
}: {
  name: string;
  hint?: string;
  callbackUrl?: CallbackUrlState;
  callbackCopied: boolean;
  acknowledged: boolean;
  onAcknowledgedChange: (next: boolean) => void;
  onCopyCallbackUrl: (url: string) => void;
}) {
  const { t } = useTranslation("settings");
  const ready = callbackUrl?.status === "ready" && callbackUrl.url;
  return (
    <ol className="space-y-4">
      <ManualStep index={1} title={t("integrationConnect.manualStepCopy")}>
        {ready ? (
          <div className="flex items-stretch gap-2">
            <code className="min-w-0 flex-1 select-text rounded-md bg-[var(--surface-lift)] px-3 py-2 font-mono text-body-small-default [overflow-wrap:anywhere]">
              {callbackUrl.url}
            </code>
            <Button
              variant="outlined"
              className="min-h-11 shrink-0"
              leftIcon={callbackCopied ? <Check /> : <Copy />}
              onClick={() => onCopyCallbackUrl(callbackUrl.url!)}
            >
              {t(
                callbackCopied
                  ? "integrationConnect.copied"
                  : "integrationConnect.copy",
              )}
            </Button>
          </div>
        ) : callbackUrl?.status === "error" ? (
          <p role="alert" className="text-body-small-default text-[var(--system-negative-strong)]">
            {t("integrationConnect.callbackFailed")}
          </p>
        ) : (
          <p className="flex items-center gap-2 text-body-small-default text-[var(--content-tertiary)]">
            <Loader2 className="size-3.5 animate-spin" />
            {t("integrationConnect.callbackLoading")}
          </p>
        )}
      </ManualStep>
      <ManualStep
        index={2}
        title={t("integrationConnect.manualStepAllowlist", { name })}
      >
        <p className="text-body-small-default text-[var(--content-tertiary)]">
          {hint ?? t("integrationConnect.manualStepAllowlistDetail")}
        </p>
      </ManualStep>
      <ManualStep index={3} title={t("integrationConnect.manualStepConfirm")}>
        <Checkbox
          checked={acknowledged}
          disabled={!ready}
          onCheckedChange={(checked) => onAcknowledgedChange(checked === true)}
          label={t("integrationConnect.manualAcknowledged")}
          className="min-h-11"
        />
      </ManualStep>
    </ol>
  );
}

function ManualStep({
  index,
  title,
  children,
}: {
  index: number;
  title: string;
  children: ReactNode;
}) {
  return (
    <li className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-3 gap-y-2">
      <span
        aria-hidden="true"
        className="flex size-6 items-center justify-center rounded-full bg-[var(--surface-lift)] text-label-small-default text-[var(--content-secondary)]"
      >
        {index}
      </span>
      <p className="self-center text-body-medium-default text-[var(--content-default)]">
        {title}
      </p>
      <div className="col-start-2 min-w-0">{children}</div>
    </li>
  );
}

function methodLabel(
  t: ReturnType<typeof useTranslation<"settings">>["t"],
  plan: ConnectPlan,
  method: ConnectMethod,
): { title: string; description: string } {
  switch (method.kind) {
    case "managed-oauth":
      return {
        title: t("integrationConnect.managedTitle"),
        description: t("integrationConnect.managedDescription"),
      };
    case "own-oauth":
      return {
        title: t("integrationConnect.ownOAuthTitle"),
        description: t("integrationConnect.ownOAuthDescription", {
          name: plan.name,
        }),
      };
    default:
      return {
        title: t("integrationConnect.mcpTitle", { name: plan.name }),
        description:
          method.catalogEntry?.description ??
          t("integrationConnect.mcpDescription"),
      };
  }
}

function Alternatives({
  plan,
  alternatives,
  busy,
  onSelect,
}: {
  plan: ConnectPlan;
  alternatives: ConnectMethod[];
  busy: boolean;
  onSelect: (method: ConnectMethod) => void;
}) {
  const { t } = useTranslation("settings");
  return (
    <Collapsible.Root type="single" collapsible>
      <Collapsible.Item value="alternatives">
        <Collapsible.Trigger className="group justify-between py-2 text-body-medium-default text-[var(--content-secondary)]">
          {t("integrationConnect.alternativesTitle")}
          <ChevronDown className="size-4 text-[var(--content-tertiary)] transition-transform group-data-[state=open]:rotate-180" />
        </Collapsible.Trigger>
        <Collapsible.Content>
          <div className="rounded-lg border border-[var(--border-base)]">
            {alternatives.map((alternative) => {
              const { title, description } = methodLabel(t, plan, alternative);
              return (
                <ListRow
                  key={alternative.id}
                  title={title}
                  subtitle={description}
                  trailingInteractive
                  trailing={
                    <Button
                      variant="outlined"
                      size="compact"
                      disabled={busy}
                      onClick={() => onSelect(alternative)}
                    >
                      {t(
                        alternative.kind === "mcp-manual" ||
                          alternative.kind === "own-oauth"
                          ? "integrationConnect.alternativeSetUp"
                          : "integrationConnect.alternativeConnect",
                      )}
                    </Button>
                  }
                />
              );
            })}
          </div>
        </Collapsible.Content>
      </Collapsible.Item>
    </Collapsible.Root>
  );
}

function ConnectionsList({
  plan,
  connections,
  busy,
  onReconnect,
  onConfigure,
  onDisconnect,
  onAdd,
}: {
  plan: ConnectPlan;
  connections: ConnectionSummary[];
  busy: boolean;
  onReconnect: (connection: ConnectionSummary) => void;
  onConfigure: (connection: ConnectionSummary) => void;
  onDisconnect: (connection: ConnectionSummary) => void;
  onAdd: () => void;
}) {
  const { t } = useTranslation("settings");
  const multipleMethods = plan.alternatives.length > 0;
  const statusLabel: Record<ConnectionStatus, string> = {
    connected: t("integrationConnect.statusConnected"),
    "needs-attention": t("integrationConnect.statusNeedsAttention"),
    connecting: t("integrationConnect.statusConnecting"),
    declared: t("integrationConnect.statusDeclared"),
    "not-started": t("integrationConnect.statusNotStarted"),
  };
  const methodTag: Record<ConnectMethod["kind"], string> = {
    "managed-oauth": t("integrationConnect.methodTagVellum"),
    "own-oauth": t("integrationConnect.methodTagOwn"),
    "mcp-oauth": t("integrationConnect.methodTagMcp"),
    "mcp-manual": t("integrationConnect.methodTagMcp"),
  };
  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-[var(--border-base)]">
        {connections.map((connection) => {
          const label =
            connection.label ??
            t("integrationConnect.accountFallback", { name: plan.name });
          return (
            <ListRow
              key={connection.id}
              title={label}
              subtitle={
                multipleMethods
                  ? [methodTag[connection.methodKind], connection.detail]
                      .filter(Boolean)
                      .join(" · ")
                  : connection.detail
              }
              trailingInteractive
              trailing={
                <div className="flex items-center gap-2">
                  <Tag tone={STATUS_TONE[connection.status]}>
                    {statusLabel[connection.status]}
                  </Tag>
                  {connection.canReconnect ? (
                    <Button
                      size="compact"
                      leftIcon={<RefreshCw />}
                      disabled={busy}
                      onClick={() => onReconnect(connection)}
                    >
                      {t("integrationConnect.reconnect")}
                    </Button>
                  ) : null}
                  {connection.canConfigure || connection.canDisconnect ? (
                    <ActionMenu.Root>
                      <ActionMenu.Trigger asChild>
                        <Button
                          variant="ghost"
                          iconOnly={<MoreHorizontal />}
                          className="min-w-11"
                          aria-label={t("integrationConnect.moreActions", {
                            label,
                          })}
                        />
                      </ActionMenu.Trigger>
                      <ActionMenu.Content
                        title={label}
                        showTitle
                        closeLabel={t("integrationConnect.actionsSheetClose")}
                        align="end"
                      >
                        {connection.canConfigure ? (
                          <ActionMenu.Item
                            icon={Settings}
                            label={t("integrationConnect.configure")}
                            onSelect={() => onConfigure(connection)}
                          />
                        ) : null}
                        {connection.canDisconnect ? (
                          <ActionMenu.Item
                            icon={Trash2}
                            label={t("integrationConnect.disconnect")}
                            tone="destructive"
                            onSelect={() => onDisconnect(connection)}
                          />
                        ) : null}
                      </ActionMenu.Content>
                    </ActionMenu.Root>
                  ) : null}
                </div>
              }
            />
          );
        })}
      </div>
      {plan.primary.kind === "managed-oauth" &&
      plan.primary.availability === "available" ? (
        <Button
          variant="outlined"
          size="compact"
          leftIcon={<Plus />}
          disabled={busy}
          onClick={onAdd}
        >
          {t("integrationConnect.addAccount")}
        </Button>
      ) : null}
    </div>
  );
}
