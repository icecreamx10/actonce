# macOS replay target

Generate macOS replay fragments for `@byted-lynx/actonce-macos`. The runtime is a thin WebdriverIO/Appium Mac2 wrapper for developer machines. Its CLI owns Appium startup, the Mac2 session, and cleanup, and runs every supplied fragment in one session.

## Single-action primitive lowering

Only after the agent-authored synthesis ledger passes validation, extract one ledger
action with its cited before/after evidence and lower that single-action slice:

```bash
actonce-macos compile-primitives segment.json --output recorded-input.js
```

The compatibility command maps completed `tap`, `doubleClick`, `rightClick`, `hover`, `dragAndDrop`,
`typeText`, `keyboardPress`, `clearInput`, and `scroll` spans to versioned
`replayMacPrimitive` calls. It removes implementation primitives nested inside
a higher-level span (for example the internal tap emitted by `typeText`) and
rejects unknown, failed, or incomplete operations. It does not author replay structure.
Never pass a whole recording, selected task range, or multi-action slice to it.

Keep these calls opaque while composing checkpoints. In particular, do not
replace `typeText({ replace: true })` with `element.setValue`, per-character
typing, or a Backspace loop. The runtime owns focus, select-all, one clipboard
paste, and clipboard restoration so recorded semantics remain stable across
generated scripts.

## Fragment contract

Emit JavaScript after TypeScript compilation, or author `.mjs` directly:

```ts
import type { MacReplayScript } from "@byted-lynx/actonce-macos";

export const config = {
  bundleId: "com.example.app",
  noReset: true,
};

/**
 * Generated from ActOnce recording: <recording-id>
 * Source sequence range: <from>..<to>
 */
const replay: MacReplayScript = async ({ mac }) => {
  const save = await mac.find({ accessibilityId: "Save" });
  await save.click();
  await save.waitForText("Saved", { timeoutMs: 5_000 });
};

export default replay;
```

For a fragment that changes application state, use the ledger's agent-authored
checkpoint pair as a guarded segment. The deterministic action is trusted only after
the live post-checkpoint matches:

```ts
import { replayMacPrimitive } from "@byted-lynx/actonce-macos";

const replay: MacReplayScript = async ({ mac, flow }) => {
  await flow.segment({
    id: "edit-main",
    precondition: {
      id: "main-ready",
      expected: {
        source: {
          includes: ["main.js"],
          excludes: ["Welcome to Lynxtron Fiddle"],
        },
      },
    },
    deterministic: async () => {
      await replayMacPrimitive(mac, {
        operation: "typeText",
        arguments: [
          "const actOnceSyntaxProbe = (",
          { target: { center: [1003, 417] }, replace: true },
        ],
      });
    },
    postcondition: {
      id: "probe-inserted",
      expected: {
        visual: {
          referencePath: "/absolute/recording/artifacts/<hash>",
          region: { left: 764, top: 255, width: 469, height: 302 },
          maxDifferenceRatio: 0.03,
        },
      },
      settle: { timeoutMs: 2_500, intervalMs: 125, consecutiveMatches: 2 },
    },
    idempotency: "safe",
  });
};
```

Author deterministic fail-closed segments. When a checkpoint fails, preserve the
failure for the separate `hybrid-replay` agent workflow; do not embed AI fallback in
the generated replay.

Use the same concrete `flow.segment` command for assertions. An assertion is an
observation-only segment: its precondition waits for the recorded evidence checkpoint,
its deterministic phase sends no device input, and its postcondition accepts the
assertion only while the independently evidenced outcome still matches:

```ts
const tooltipExpectation = {
  visual: {
    referencePath: "/absolute/recording/artifacts/tooltip.png",
    region: { left: 760, top: 250, width: 480, height: 120 },
    maxDifferenceRatio: 0.03,
  },
};

await flow.segment({
  id: "assert-diagnostic-tooltip",
  precondition: {
    id: "tooltip-ready",
    expected: tooltipExpectation,
    settle: { timeoutMs: 1_200, intervalMs: 60, consecutiveMatches: 2 },
  },
  deterministic: async () => {
    // The checkpoint driver is the registered recorded-modality evaluator.
    // Do not send device input or substitute an AX/DOM lookup here.
  },
  postcondition: {
    id: "tooltip-expression-expected-verified",
    expected: tooltipExpectation,
  },
  idempotency: "safe",
});
```

Apply this shape to Assert, Boolean, Query, and final oracle checks. A precondition
settle timeout is a checkpoint failure; it is not an observed `false` result. A
postcondition mismatch means the assertion was not accepted even if a separate
read-only evaluator call returned successfully.

Do not call `MacSession.connect`, `mac.close`, or start Appium inside a fragment. The runner guarantees cleanup and shares one session across fragments:

```bash
actonce-macos doctor
actonce-macos run 01-setup.js 02-edit.js 03-assert.js
```

## Authorship preferences

Choose locators in this order when supported by recorded AX evidence:

1. `accessibilityId`
2. `id`
3. stable `name`
4. `predicate`
5. `classChain`
6. XPath only when no stable native locator exists
7. guarded coordinates as the final deterministic fallback

Use checkpoint `settle` instead of a fixed sleep whenever the next recorded state is independently checkable. `plan-observations` supplies a recommended interval and preserves the original wait as the timeout ceiling. For screenshot evidence, use a narrowly scoped `visual` reference; the runtime takes repeated low-resolution comparisons and advances after the configured consecutive matches. If settling times out, fail closed and return the checkpoint failure. Use `mac.waitFor`, `waitForDisplayed`, or `waitForText` for live properties that are not segment checkpoints. Use `mac.driver` only for a Mac2 command that the thin API does not expose. Record that escape hatch and its evidence in a comment so it can later be promoted into the runtime.

Put shared fixture setup in an early fragment and outcome assertions in a final fragment. Each fragment must retain its own recording ID and sequence provenance. Run the full ordered fragment list twice; running each fragment in a separate session does not validate the intended contract.
