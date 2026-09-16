import { useEffect } from "react";
import { createRoot } from "react-dom/client";

import { CodeBlock } from "../../src/components/detail-primitives";

declare global {
  interface Window {
    touchLayoutTest: { ready: boolean };
  }
}

window.touchLayoutTest = { ready: false };

/** 90 hex characters with no break opportunity, so it fills the first line. */
const UNBREAKABLE_TOKEN = "0123456789abcdef".repeat(6).slice(0, 90);

/**
 * Detail blocks as a side panel lays them out: one-line content, and a token
 * long enough to wrap, whose first line runs to the block's content edge.
 * Each block's host carries the id the test measures by.
 */
function TouchLayoutHarness() {
  useEffect(() => {
    requestAnimationFrame(() => {
      window.touchLayoutTest.ready = true;
    });
  }, []);
  return (
    <div style={{ width: "min(400px, calc(100vw - 32px))", margin: 16 }}>
      <div id="one-line">
        <CodeBlock text="ls -la" />
      </div>
      <div id="unbreakable-token" style={{ marginTop: 16 }}>
        <CodeBlock text={UNBREAKABLE_TOKEN} />
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<TouchLayoutHarness />);
