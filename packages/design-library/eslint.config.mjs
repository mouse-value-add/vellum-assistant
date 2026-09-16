import { defineConfig, globalIgnores } from "eslint/config";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

// Transitional: this library reaches into an app folder for a rule both
// packages share. The rule belongs in a shared workspace package; do not add
// further imports from `clients/web` here.
import { noEmDash } from "../../clients/web/eslint-rules/no-em-dash.mjs";

/**
 * Files exempt from `local/no-em-dash`. See root `AGENTS.md`, "Em Dashes".
 *
 * The rule covers the whole package by default, so a new file is checked
 * from its first commit. These files carry pre-existing em dashes, which
 * `AGENTS.md` says are not swept retroactively. To remove an entry, fix the
 * file's em dashes and delete its line. Never add a file to this list.
 */
const emDashExemptPaths = [
  ".storybook/manager.tsx",
  "src/components/button.test.tsx",
  "src/components/button.tsx",
  "src/components/card.stories.tsx",
  "src/components/checkbox.stories.tsx",
  "src/components/collapsible.stories.tsx",
  "src/components/collapsible.tsx",
  "src/components/context-menu.tsx",
  "src/components/input.stories.tsx",
  "src/components/list-row.stories.tsx",
  "src/components/markdown-message.stories.tsx",
  "src/components/markdown-message.test.tsx",
  "src/components/markdown-message.tsx",
  "src/components/menu.tsx",
  "src/components/modal.stories.tsx",
  "src/components/notice.stories.tsx",
  "src/components/notice.test.tsx",
  "src/components/panel-item/marquee-text.tsx",
  "src/components/panel-item/panel-item.test.tsx",
  "src/components/panel-item/panel-item.tsx",
  "src/components/scroll-shadow.stories.tsx",
  "src/components/scroll-shadow.tsx",
  "src/components/segment-control.test.tsx",
  "src/components/segment-control.tsx",
  "src/components/side-menu/side-menu.test.tsx",
  "src/components/side-menu/side-menu.tsx",
  "src/components/slider.stories.tsx",
  "src/components/stat-square.stories.tsx",
  "src/components/stepper.stories.tsx",
  "src/components/stepper.tsx",
  "src/components/tag.tsx",
  "src/components/toast.stories.tsx",
  "src/components/toast.test.tsx",
  "src/components/toast.tsx",
  "src/components/toggle.stories.tsx",
  "src/components/tooltip.stories.tsx",
  "src/components/virtual-list/go-to-newest.stories.tsx",
  "src/components/virtual-list/go-to-newest.tsx",
  "src/components/virtual-list/virtual-grouped-list.stories.tsx",
  "src/components/virtual-list/virtual-grouped-list.test.tsx",
  "src/components/virtual-list/virtual-grouped-list.tsx",
  "src/components/virtual-list/virtual-list.stories.tsx",
  "src/components/virtual-list/virtual-list.test.tsx",
  "src/components/virtual-list/virtual-list.tsx",
  "src/utils/cn.test.ts",
  "src/utils/cn.ts",
  "src/utils/input-modality.ts",
  "src/utils/portal-container.tsx",
];

const forwardRefMessage =
  "forwardRef is deprecated in React 19. Destructure ref from props instead (see packages/design-library/AGENTS.md).";

export default defineConfig([
  ...tseslint.configs.recommended,
  reactHooks.configs.flat.recommended,
  globalIgnores(["storybook-static/**"]),
  {
    plugins: {
      local: {
        rules: {
          "no-em-dash": noEmDash,
        },
      },
    },
    rules: {
      // Require braces on every control-statement body. See root
      // `AGENTS.md`, "Control-Flow Braces".
      curly: ["error", "all"],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "react-hooks/exhaustive-deps": "error",
      "local/no-em-dash": "error",
      // `AGENTS.md` component rule 1: ref is a regular prop in React 19.
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "ImportDeclaration[source.value='react'] > ImportSpecifier[imported.name='forwardRef']",
          message: forwardRefMessage,
        },
        {
          selector: "MemberExpression[property.name='forwardRef']",
          message: forwardRefMessage,
        },
      ],
    },
  },
  // `AGENTS.md` component rule 5: named exports only. Stories and tool
  // configs are exempt because Storybook CSF and the tools reading them
  // require a default export.
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/**/*.stories.tsx"],
    rules: {
      "no-restricted-exports": [
        "error",
        {
          restrictDefaultExports: {
            direct: true,
            named: true,
            defaultFrom: true,
            namedFrom: true,
            namespaceFrom: true,
          },
        },
      ],
    },
  },
  {
    files: emDashExemptPaths,
    rules: {
      "local/no-em-dash": "off",
    },
  },
  // Pre-existing hook patterns that need a judgement call rather than a
  // mechanical fix: render-time writes to "latest value" refs, and a
  // synchronous setState inside an effect. Scoped to the files that carry
  // them so the rules hold everywhere else. Never add a file to this list.
  {
    files: ["src/hooks/use-resizable-pane.ts"],
    rules: {
      "react-hooks/refs": "off",
    },
  },
  {
    files: ["src/components/combobox.tsx", "src/hooks/use-resizable-pane.ts"],
    rules: {
      "react-hooks/set-state-in-effect": "off",
    },
  },
]);
