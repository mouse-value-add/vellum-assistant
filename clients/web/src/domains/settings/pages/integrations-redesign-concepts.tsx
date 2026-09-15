/* eslint-disable local/no-untranslated-strings -- throwaway redesign concepts; a production version reads copy through t() */
import { Button } from "@vellumai/design-library/components/button";
import { Card } from "@vellumai/design-library/components/card";
import { Input } from "@vellumai/design-library/components/input";
import { ListRow } from "@vellumai/design-library/components/list-row";
import { SegmentControl } from "@vellumai/design-library/components/segment-control";
import { StatSquare } from "@vellumai/design-library/components/stat-square";
import { Tag } from "@vellumai/design-library/components/tag";
import {
  AlertTriangle,
  CheckCircle2,
  LayoutGrid,
  MoreHorizontal,
  Plus,
  Puzzle,
  RefreshCw,
  Search,
} from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";

import { IntegrationIcon } from "@/components/integrations/integration-icon";

/**
 * Throwaway redesign concepts for the Integrations settings page. Presentational
 * only: fixture data, no queries, no i18n. Each concept answers the same brief
 * ("the current single-column card list leaves most of a wide viewport empty")
 * with a different layout strategy so they can be compared side by side in
 * Storybook.
 */

export type ConceptStatus = "connected" | "attention" | "available";

export type ConceptCategory =
  | "Sales & CRM"
  | "Meetings"
  | "Finance"
  | "Engineering"
  | "Productivity"
  | "Knowledge"
  | "Marketing"
  | "Communication";

export interface ConceptIntegration {
  key: string;
  name: string;
  description: string;
  category: ConceptCategory;
  status: ConceptStatus;
  /** Account or workspace label shown for configured integrations. */
  account?: string;
  /** User-added MCP server rather than a catalog entry. */
  custom?: boolean;
}

export const CONCEPT_CATEGORIES: ConceptCategory[] = [
  "Sales & CRM",
  "Meetings",
  "Finance",
  "Engineering",
  "Productivity",
  "Knowledge",
  "Marketing",
  "Communication",
];

const AVAILABLE = "available" as const;

export const CONCEPT_INTEGRATIONS: ConceptIntegration[] = [
  {
    key: "notion",
    name: "Notion",
    description: "Search pages and databases.",
    category: "Knowledge",
    status: "connected",
    account: "Example workspace",
  },
  {
    key: "github",
    name: "GitHub",
    description: "Repositories, issues, and pull requests.",
    category: "Engineering",
    status: "connected",
    account: "example-org",
  },
  {
    key: "slack",
    name: "Slack",
    description: "Channels, messages, and people.",
    category: "Communication",
    status: "connected",
    account: "Example HQ",
  },
  {
    key: "linear",
    name: "Linear",
    description: "Find issues, projects, and team updates.",
    category: "Engineering",
    status: "connected",
    account: "Example workspace",
  },
  {
    key: "fathom",
    name: "Fathom",
    description: "Search meeting notes and summaries.",
    category: "Meetings",
    status: "attention",
    account: "user@example.com",
  },
  {
    key: "internal-docs",
    name: "internal-docs",
    description: "docs.example.com",
    category: "Knowledge",
    status: "connected",
    account: "Custom MCP server",
    custom: true,
  },
  {
    key: "amplemarket",
    name: "Amplemarket",
    description: "Find and enrich prospects, then manage outreach sequences.",
    category: "Sales & CRM",
    status: AVAILABLE,
  },
  {
    key: "asana",
    name: "Asana",
    description: "Tasks and projects.",
    category: "Productivity",
    status: AVAILABLE,
  },
  {
    key: "ashby",
    name: "Ashby",
    description:
      "Search candidates, prepare interviews, and manage recruiting pipelines.",
    category: "Productivity",
    status: AVAILABLE,
  },
  {
    key: "atlassian",
    name: "Atlassian",
    description: "Search Jira, Confluence, and connected Atlassian products.",
    category: "Engineering",
    status: AVAILABLE,
  },
  {
    key: "attio",
    name: "Attio",
    description: "Search and update CRM records, lists, notes, and tasks.",
    category: "Sales & CRM",
    status: AVAILABLE,
  },
  {
    key: "brex",
    name: "Brex",
    description: "Review expenses, cards, and company spending.",
    category: "Finance",
    status: AVAILABLE,
  },
  {
    key: "calendly",
    name: "Calendly",
    description: "Scheduling links and meetings.",
    category: "Meetings",
    status: AVAILABLE,
  },
  {
    key: "circleback",
    name: "Circleback",
    description: "Search meeting notes, transcripts, and action items.",
    category: "Meetings",
    status: AVAILABLE,
  },
  {
    key: "clay",
    name: "Clay",
    description: "Research, enrich, and update people and company records.",
    category: "Sales & CRM",
    status: AVAILABLE,
  },
  {
    key: "craft",
    name: "Craft",
    description: "Search and work with documents in your Craft workspace.",
    category: "Knowledge",
    status: AVAILABLE,
  },
  {
    key: "customer-io",
    name: "Customer.io",
    description:
      "Explore campaigns, broadcasts, segments, and customer activity.",
    category: "Marketing",
    status: AVAILABLE,
  },
  {
    key: "eventbrite",
    name: "Eventbrite",
    description: "Events, orders, and attendees.",
    category: "Marketing",
    status: AVAILABLE,
  },
  {
    key: "figma",
    name: "Figma",
    description: "Files, comments, and design components.",
    category: "Engineering",
    status: AVAILABLE,
  },
  {
    key: "fireflies",
    name: "Fireflies",
    description: "Meeting transcripts and action items.",
    category: "Meetings",
    status: AVAILABLE,
  },
  {
    key: "hubspot",
    name: "HubSpot",
    description: "Contacts, deals, and companies.",
    category: "Sales & CRM",
    status: AVAILABLE,
  },
  {
    key: "intercom",
    name: "Intercom",
    description: "Conversations, contacts, and help articles.",
    category: "Communication",
    status: AVAILABLE,
  },
  {
    key: "mercury",
    name: "Mercury",
    description: "Accounts, transactions, and payments.",
    category: "Finance",
    status: AVAILABLE,
  },
  {
    key: "ramp",
    name: "Ramp",
    description: "Explore expenses, bills, and company spending.",
    category: "Finance",
    status: AVAILABLE,
  },
  {
    key: "salesforce",
    name: "Salesforce",
    description: "Accounts, opportunities, and reports.",
    category: "Sales & CRM",
    status: AVAILABLE,
  },
  {
    key: "sentry",
    name: "Sentry",
    description: "Errors, issues, and releases.",
    category: "Engineering",
    status: AVAILABLE,
  },
  {
    key: "stripe",
    name: "Stripe",
    description: "Customers, payments, and subscriptions.",
    category: "Finance",
    status: AVAILABLE,
  },
  {
    key: "todoist",
    name: "Todoist",
    description: "Tasks and projects.",
    category: "Productivity",
    status: AVAILABLE,
  },
  {
    key: "typeform",
    name: "Typeform",
    description: "Forms and responses.",
    category: "Marketing",
    status: AVAILABLE,
  },
  {
    key: "otter",
    name: "Otter",
    description: "Meeting recordings and transcripts.",
    category: "Meetings",
    status: AVAILABLE,
  },
  {
    key: "monday",
    name: "monday.com",
    description: "Boards, items, and updates.",
    category: "Productivity",
    status: AVAILABLE,
  },
  {
    key: "guru",
    name: "Guru",
    description: "Cards, collections, and verified answers.",
    category: "Knowledge",
    status: AVAILABLE,
  },
];

type ConceptFilter = "all" | "connected" | "available";

const FILTER_ITEMS: { value: ConceptFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "connected", label: "Connected" },
  { value: "available", label: "Available" },
];

function useConceptFilter(items: ConceptIntegration[]) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ConceptFilter>("all");
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return items.filter((item) => {
      const configured = item.status !== "available";
      if (filter === "connected" && !configured) {
        return false;
      }
      if (filter === "available" && configured) {
        return false;
      }
      return (
        !needle ||
        item.name.toLocaleLowerCase().includes(needle) ||
        item.description.toLocaleLowerCase().includes(needle)
      );
    });
  }, [items, query, filter]);
  return { query, setQuery, filter, setFilter, filtered };
}

function Logo({ item, size = 32 }: { item: ConceptIntegration; size?: number }) {
  if (item.custom) {
    return (
      <span
        aria-hidden="true"
        style={{ width: size, height: size }}
        className="flex shrink-0 items-center justify-center rounded-md bg-[var(--surface-base)] text-[var(--content-secondary)]"
      >
        <Puzzle size={size * 0.6} />
      </span>
    );
  }
  return (
    <IntegrationIcon
      providerKey={item.key}
      displayName={item.name}
      logoUrl={null}
      size={size}
    />
  );
}

function StatusTag({ status }: { status: ConceptStatus }) {
  if (status === "connected") {
    return (
      <Tag tone="positive" leftIcon={<CheckCircle2 />}>
        Connected
      </Tag>
    );
  }
  if (status === "attention") {
    return (
      <Tag tone="negative" leftIcon={<AlertTriangle />}>
        Needs attention
      </Tag>
    );
  }
  return null;
}

function StatusDot({ status }: { status: ConceptStatus }) {
  const color =
    status === "connected"
      ? "bg-[var(--system-positive-strong)]"
      : status === "attention"
        ? "bg-[var(--system-negative-strong)]"
        : "bg-[var(--border-element)]";
  return (
    <span
      aria-hidden="true"
      className={`inline-block size-2 shrink-0 rounded-full ${color}`}
    />
  );
}

function PrimaryAction({
  item,
  size = "regular",
}: {
  item: ConceptIntegration;
  size?: "regular" | "compact";
}) {
  if (item.status === "attention") {
    return (
      <Button variant="primary" size={size}>
        Reconnect
      </Button>
    );
  }
  if (item.status === "connected") {
    return (
      <Button variant="outlined" size={size}>
        Manage
      </Button>
    );
  }
  return (
    <Button variant="outlined" size={size}>
      Connect
    </Button>
  );
}

interface ToolbarProps {
  query: string;
  onQuery: (value: string) => void;
  filter?: ConceptFilter;
  onFilter?: (value: ConceptFilter) => void;
  compact?: boolean;
  className?: string;
}

function Toolbar({
  query,
  onQuery,
  filter,
  onFilter,
  compact,
  className,
}: ToolbarProps) {
  return (
    <div className={`flex flex-wrap items-center gap-2 ${className ?? ""}`}>
      <Input
        value={query}
        onChange={(event) => onQuery(event.target.value)}
        placeholder="Search integrations"
        aria-label="Search integrations"
        leftIcon={<Search aria-hidden className="size-4" />}
        wrapperClassName="min-w-[16rem] max-w-xl flex-1"
        fullWidth
      />
      {filter && onFilter ? (
        <SegmentControl
          items={FILTER_ITEMS}
          value={filter}
          onChange={onFilter}
          ariaLabel="Filter integrations"
          className="w-auto shrink-0"
        />
      ) : null}
      {compact ? null : (
        <>
          <Button variant="outlined" leftIcon={<Plus />}>
            Add custom
          </Button>
          <Button
            variant="ghost"
            iconOnly={<RefreshCw />}
            aria-label="Reload integrations"
          />
        </>
      )}
    </div>
  );
}

function SectionHeading({
  title,
  count,
  trailing,
}: {
  title: string;
  count?: number;
  trailing?: ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <h2 className="flex items-baseline gap-2 text-title-small text-[var(--content-default)]">
        {title}
        {count !== undefined ? (
          <span className="text-body-small-lighter text-[var(--content-tertiary)]">
            {count}
          </span>
        ) : null}
      </h2>
      {trailing}
    </div>
  );
}

function EmptyState({ query }: { query: string }) {
  return (
    <p className="py-10 text-center text-body-medium-default text-[var(--content-tertiary)]">
      {query.trim()
        ? `No integrations matched "${query.trim()}"`
        : "No integrations match this filter."}
    </p>
  );
}

/* ------------------------------------------------------------------ */
/* Concept A: directory grid                                            */
/* ------------------------------------------------------------------ */

/**
 * App-directory layout. Configured integrations stay as wide rows at the top
 * so status and account are readable at a glance; the catalog becomes a
 * responsive card grid that fills the viewport width.
 */
export function ConceptDirectoryGrid() {
  const { query, setQuery, filter, setFilter, filtered } =
    useConceptFilter(CONCEPT_INTEGRATIONS);
  const configured = filtered.filter((item) => item.status !== "available");
  const available = filtered.filter((item) => item.status === "available");
  return (
    <div className="space-y-8">
      <Toolbar
        query={query}
        onQuery={setQuery}
        filter={filter}
        onFilter={setFilter}
      />
      {configured.length > 0 ? (
        <section className="space-y-3">
          <SectionHeading title="Connected" count={configured.length} />
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(20rem,1fr))]">
            {configured.map((item) => (
              <Card.Root
                key={item.key}
                bordered
                className="flex items-center gap-3 transition-colors hover:border-[var(--border-hover)]"
              >
                <Logo item={item} size={36} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-title-small text-[var(--content-default)]">
                    {item.name}
                  </p>
                  <p className="truncate text-body-small-lighter text-[var(--content-tertiary)]">
                    {item.account}
                  </p>
                </div>
                <StatusTag status={item.status} />
                <Button
                  variant="ghost"
                  size="compact"
                  iconOnly={<MoreHorizontal />}
                  aria-label={`${item.name} actions`}
                />
              </Card.Root>
            ))}
          </div>
        </section>
      ) : null}
      {available.length > 0 ? (
        <section className="space-y-3">
          <SectionHeading title="Available" count={available.length} />
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(15rem,1fr))]">
            {available.map((item) => (
              <Card.Root
                key={item.key}
                bordered
                className="group flex flex-col gap-3 transition-colors hover:border-[var(--border-hover)]"
              >
                <div className="flex items-start justify-between gap-2">
                  <Logo item={item} size={40} />
                  <Button
                    variant="outlined"
                    size="compact"
                    className="opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
                  >
                    Connect
                  </Button>
                </div>
                <div className="min-w-0 space-y-1">
                  <p className="truncate text-title-small text-[var(--content-default)]">
                    {item.name}
                  </p>
                  <p className="line-clamp-2 text-body-small-lighter text-[var(--content-tertiary)]">
                    {item.description}
                  </p>
                </div>
              </Card.Root>
            ))}
          </div>
        </section>
      ) : null}
      {filtered.length === 0 ? <EmptyState query={query} /> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Concept B: category rail                                             */
/* ------------------------------------------------------------------ */

type RailSelection = "all" | "connected" | ConceptCategory;

function RailItem({
  label,
  count,
  active,
  onSelect,
  leading,
}: {
  label: string;
  count: number;
  active: boolean;
  onSelect: () => void;
  leading?: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-body-medium-default transition-colors ${
        active
          ? "bg-[var(--surface-active)] text-[var(--content-default)]"
          : "text-[var(--content-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--content-default)]"
      }`}
    >
      {leading}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="text-body-small-lighter tabular-nums text-[var(--content-tertiary)]">
        {count}
      </span>
    </button>
  );
}

/**
 * Left category rail plus a width-capped, divided list. Empty space becomes
 * navigation instead of margin, and rows drop the card chrome so the list
 * reads as one directory rather than a stack of boxes.
 */
export function ConceptCategoryRail() {
  const { query, setQuery, filtered } = useConceptFilter(CONCEPT_INTEGRATIONS);
  const [selection, setSelection] = useState<RailSelection>("all");
  const configuredCount = CONCEPT_INTEGRATIONS.filter(
    (item) => item.status !== "available",
  ).length;
  const visible = filtered.filter((item) =>
    selection === "all"
      ? true
      : selection === "connected"
        ? item.status !== "available"
        : item.category === selection,
  );
  const groups =
    selection === "all"
      ? [
          {
            title: "Connected",
            items: visible.filter((item) => item.status !== "available"),
          },
          ...CONCEPT_CATEGORIES.map((category) => ({
            title: category,
            items: visible.filter(
              (item) =>
                item.category === category && item.status === "available",
            ),
          })),
        ].filter((group) => group.items.length > 0)
      : [{ title: selection === "connected" ? "Connected" : selection, items: visible }];

  return (
    <div className="grid gap-8 lg:grid-cols-[13rem_minmax(0,1fr)]">
      <nav
        aria-label="Integration categories"
        className="space-y-1 self-start lg:sticky lg:top-6"
      >
        <RailItem
          label="All integrations"
          count={CONCEPT_INTEGRATIONS.length}
          active={selection === "all"}
          onSelect={() => setSelection("all")}
          leading={<LayoutGrid className="size-4 text-[var(--content-tertiary)]" />}
        />
        <RailItem
          label="Connected"
          count={configuredCount}
          active={selection === "connected"}
          onSelect={() => setSelection("connected")}
          leading={<StatusDot status="connected" />}
        />
        <div className="my-2 border-t border-[var(--border-base)]" />
        {CONCEPT_CATEGORIES.map((category) => (
          <RailItem
            key={category}
            label={category}
            count={
              CONCEPT_INTEGRATIONS.filter((item) => item.category === category)
                .length
            }
            active={selection === category}
            onSelect={() => setSelection(category)}
          />
        ))}
        <div className="my-2 border-t border-[var(--border-base)]" />
        <Button variant="ghost" leftIcon={<Plus />} fullWidth className="justify-start">
          Add custom
        </Button>
      </nav>
      <div className="max-w-5xl space-y-8">
        <Toolbar query={query} onQuery={setQuery} compact />
        {groups.map((group) => (
          <section key={group.title} className="space-y-2">
            <SectionHeading title={group.title} count={group.items.length} />
            <Card.Root bordered noPadding clipContents className="px-2 py-1">
              {group.items.map((item) => (
                <ListRow
                  key={item.key}
                  leading={<Logo item={item} size={28} />}
                  title={
                    <span className="flex items-baseline gap-2">
                      <span>{item.name}</span>
                      <span className="truncate text-body-small-lighter text-[var(--content-tertiary)]">
                        {item.account ?? item.description}
                      </span>
                    </span>
                  }
                  trailing={
                    <>
                      <StatusTag status={item.status} />
                      <PrimaryAction item={item} size="compact" />
                    </>
                  }
                  trailingInteractive
                  className="py-2"
                />
              ))}
            </Card.Root>
          </section>
        ))}
        {visible.length === 0 ? <EmptyState query={query} /> : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Concept C: overview + multi-column list                              */
/* ------------------------------------------------------------------ */

/**
 * Dashboard-style header (counts, your connections as chips) followed by a
 * dense catalog that flows into two or three columns on wide viewports.
 */
export function ConceptOverviewColumns() {
  const { query, setQuery, filter, setFilter, filtered } =
    useConceptFilter(CONCEPT_INTEGRATIONS);
  const configured = CONCEPT_INTEGRATIONS.filter(
    (item) => item.status !== "available",
  );
  const connectedCount = configured.filter(
    (item) => item.status === "connected",
  ).length;
  const attentionCount = configured.length - connectedCount;
  const availableCount = CONCEPT_INTEGRATIONS.length - configured.length;
  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-title-large text-[var(--content-default)]">
            Integrations
          </h1>
          <p className="max-w-xl text-body-medium-lighter text-[var(--content-tertiary)]">
            Connect the tools you use so your assistant can search, read, and
            act across them.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="primary" leftIcon={<Plus />}>
            Add custom
          </Button>
          <Button
            variant="ghost"
            iconOnly={<RefreshCw />}
            aria-label="Reload integrations"
          />
        </div>
      </header>
      <div className="grid gap-3 sm:grid-cols-3">
        <StatSquare
          icon={<CheckCircle2 className="size-5" />}
          value={connectedCount}
          label="Connected"
        />
        <StatSquare
          icon={<AlertTriangle className="size-5" />}
          value={attentionCount}
          label="Need attention"
          tone={attentionCount > 0 ? "negative" : "muted"}
        />
        <StatSquare
          icon={<LayoutGrid className="size-5" />}
          value={availableCount}
          label="Available to connect"
          tone="muted"
        />
      </div>
      <section className="space-y-3">
        <SectionHeading title="Your connections" />
        <div className="flex flex-wrap gap-2">
          {configured.map((item) => (
            <button
              key={item.key}
              type="button"
              className="flex items-center gap-2 rounded-full border border-[var(--border-subtle)] bg-[var(--surface-lift)] py-1.5 pl-1.5 pr-3 text-left transition-colors hover:border-[var(--border-hover)] hover:bg-[var(--surface-hover)]"
            >
              <Logo item={item} size={24} />
              <span className="text-body-medium-default text-[var(--content-default)]">
                {item.name}
              </span>
              <span className="text-body-small-lighter text-[var(--content-tertiary)]">
                {item.account}
              </span>
              <StatusDot status={item.status} />
            </button>
          ))}
        </div>
      </section>
      <section className="space-y-3">
        <div className="sticky top-0 z-10 -mx-2 bg-[var(--background)] px-2 py-2">
          <Toolbar
            query={query}
            onQuery={setQuery}
            filter={filter}
            onFilter={setFilter}
            compact
          />
        </div>
        <div className="grid gap-x-8 md:grid-cols-2 2xl:grid-cols-3">
          {filtered.map((item) => (
            <div
              key={item.key}
              className="flex items-center gap-3 border-b border-[var(--border-base)] py-2.5"
            >
              <Logo item={item} size={28} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-body-medium-default text-[var(--content-default)]">
                  {item.name}
                </p>
                <p className="truncate text-body-small-lighter text-[var(--content-tertiary)]">
                  {item.account ?? item.description}
                </p>
              </div>
              {item.status === "available" ? (
                <PrimaryAction item={item} size="compact" />
              ) : (
                <StatusTag status={item.status} />
              )}
            </div>
          ))}
        </div>
        {filtered.length === 0 ? <EmptyState query={query} /> : null}
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Concept D: narrow column                                             */
/* ------------------------------------------------------------------ */

/**
 * Smallest change: cap the width like the other settings pages, add a page
 * heading, and swap card-per-row for a divided list grouped by state.
 */
export function ConceptNarrowColumn() {
  const { query, setQuery, filter, setFilter, filtered } =
    useConceptFilter(CONCEPT_INTEGRATIONS);
  const configured = filtered.filter((item) => item.status !== "available");
  const available = filtered.filter((item) => item.status === "available");
  return (
    <div className="mx-auto w-full max-w-2xl space-y-6">
      <header className="space-y-1">
        <h1 className="text-title-large text-[var(--content-default)]">
          Integrations
        </h1>
        <p className="text-body-medium-lighter text-[var(--content-tertiary)]">
          Connect the tools you use so your assistant can search, read, and act
          across them.
        </p>
      </header>
      <Toolbar
        query={query}
        onQuery={setQuery}
        filter={filter}
        onFilter={setFilter}
      />
      {configured.length > 0 ? (
        <section className="space-y-2">
          <SectionHeading title="Connected" count={configured.length} />
          <Card.Root bordered noPadding clipContents className="px-2 py-1">
            {configured.map((item) => (
              <ListRow
                key={item.key}
                leading={<Logo item={item} />}
                title={item.name}
                subtitle={item.account}
                trailing={
                  <>
                    <StatusTag status={item.status} />
                    <PrimaryAction item={item} />
                  </>
                }
                trailingInteractive
              />
            ))}
          </Card.Root>
        </section>
      ) : null}
      {available.length > 0 ? (
        <section className="space-y-2">
          <SectionHeading title="Available" count={available.length} />
          <Card.Root bordered noPadding clipContents className="px-2 py-1">
            {available.map((item) => (
              <ListRow
                key={item.key}
                leading={<Logo item={item} />}
                title={item.name}
                subtitle={item.description}
                trailing={<PrimaryAction item={item} />}
                trailingInteractive
              />
            ))}
          </Card.Root>
        </section>
      ) : null}
      {filtered.length === 0 ? <EmptyState query={query} /> : null}
    </div>
  );
}
