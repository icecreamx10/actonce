# macOS replay target

Generate macOS replay fragments for `@byted-lynx/actonce-macos`. The runtime is a thin WebdriverIO/Appium Mac2 wrapper for developer machines. Its CLI owns Appium startup, the Mac2 session, and cleanup, and runs every supplied fragment in one session.

## Deterministic primitive lowering

Use the runtime compiler before adapting a selected segment:

```bash
actonce-macos compile-primitives segment.json --output recorded-input.js
```

It maps completed `tap`, `doubleClick`, `rightClick`, `hover`, `dragAndDrop`,
`typeText`, `keyboardPress`, `clearInput`, and `scroll` spans to versioned
`replayMacPrimitive` calls. It removes implementation primitives nested inside
a higher-level span (for example the internal tap emitted by `typeText`) and
rejects unknown, failed, or incomplete operations.

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

For a fragment that changes application state, compile the selected recording
checkpoints into a guarded segment. The deterministic action is trusted only after
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
    fallback: {
      goal: "Make main.js contain exactly the recorded probe without saving.",
      maxAttempts: 1,
      maxActions: 5,
    },
    idempotency: "safe",
  });
};
```

The presence of fallback metadata does not enable AI. Hybrid runners must inject a
fallback driver and select `policy: "recover"`. A benchmark may measure deterministic
or hybrid replay. Record which strategy ran; when fallback occurs, include its full
latency and actions inside the scored replay duration. Correct hybrid results remain
eligible for replay performance comparison.

For a hybrid CLI run, emit a separate fallback plugin module. It must create a
Midscene Agent on the recorded macOS device adapter so AI actions append to the same
ActOnce timeline, then return a `MidsceneFallbackDriver` and recorder cleanup:

```ts
import { MidsceneFallbackDriver } from "@byted-lynx/actonce-midscene-fallback";

export async function createFallback() {
  const recorded = await createRecordedComputerAgent();
  return {
    driver: new MidsceneFallbackDriver(recorded.agent),
    close: () => recorded.close(),
  };
}
```

Keep environment-specific agent construction in the plugin, not generated fragments:

```bash
actonce-macos run --fallback-module ./fallback.js 01-setup.js 02-edit.js 03-assert.js
```

Omit `--fallback-module` for deterministic validation. A hybrid benchmark supplies it
and records fallback count and duration inside the measured boundary.

Do not call `MacSession.connect`, `mac.close`, or start Appium inside a fragment. The runner guarantees cleanup and shares one session across fragments:

```bash
actonce-macos doctor
actonce-macos run 01-setup.js 02-edit.js 03-assert.js
```

## Compilation preferences

Choose locators in this order when supported by recorded AX evidence:

1. `accessibilityId`
2. `id`
3. stable `name`
4. `predicate`
5. `classChain`
6. XPath only when no stable native locator exists
7. guarded coordinates as the final deterministic fallback

Use checkpoint `settle` instead of a fixed sleep whenever the next recorded state is independently checkable. `plan-observations` supplies a recommended interval and preserves the original wait as the timeout ceiling. For screenshot evidence, use a narrowly scoped `visual` reference; the runtime takes repeated low-resolution comparisons and advances after the configured consecutive matches. If settling times out, the regular deterministic/hybrid policy applies. Use `mac.waitFor`, `waitForDisplayed`, or `waitForText` for live properties that are not segment checkpoints. Use `mac.driver` only for a Mac2 command that the thin API does not expose. Record that escape hatch and its evidence in a comment so it can later be promoted into the runtime.

Put shared fixture setup in an early fragment and outcome assertions in a final fragment. Each fragment must retain its own recording ID and sequence provenance. Run the full ordered fragment list twice; running each fragment in a separate session does not validate the intended contract.
