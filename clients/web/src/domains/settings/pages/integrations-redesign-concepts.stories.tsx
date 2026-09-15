import type { Meta, StoryObj } from "@storybook/react-vite";

import {
  ConceptCategoryRail,
  ConceptDirectoryGrid,
  ConceptNarrowColumn,
  ConceptOverviewColumns,
} from "./integrations-redesign-concepts";

/**
 * Redesign concepts for Settings > Integrations. Each story is a self-contained
 * layout exploration rendered at the full settings content width so the
 * treatment of wide viewports can be compared directly against the current
 * single-column card list.
 */
const meta: Meta = {
  title: "Settings/IntegrationsPage/Redesign concepts",
  parameters: {
    layout: "fullscreen",
    controls: { disable: true },
    viewport: { defaultViewport: "sbDesktop" },
  },
  decorators: [
    (Story) => (
      <div className="min-h-screen bg-[var(--background)] p-6">
        <Story />
      </div>
    ),
  ],
};
export default meta;
type Story = StoryObj;

/** A. App-directory grid: wide rows for connected, card grid for the catalog. */
export const DirectoryGrid: Story = { render: () => <ConceptDirectoryGrid /> };

/** B. Category rail on the left, width-capped divided list on the right. */
export const CategoryRail: Story = { render: () => <ConceptCategoryRail /> };

/** C. Counts and connection chips up top, catalog flows into 2 to 3 columns. */
export const OverviewColumns: Story = {
  render: () => <ConceptOverviewColumns />,
};

/** D. Minimal change: cap the width, add a heading, divided list instead of cards. */
export const NarrowColumn: Story = { render: () => <ConceptNarrowColumn /> };
