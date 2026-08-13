# @actonce/macos

Deterministic macOS replay runtime for scripts compiled from ActOnce recordings.
It is a thin TypeScript API over WebdriverIO and Appium Mac2, with one shared
session for one or more generated script fragments.

## Setup

Requirements are macOS 11.3+, Xcode 13+, Node.js 20.19+/22.12+/24+, and
Accessibility permission for Xcode Helper.

```bash
npm install @actonce/macos
npx actonce-macos doctor
```

For local repository development, run `npm install && npm run build` inside this directory.

Window normalization is implemented by the runtime SDK. `setupMacWindow()`
centers the window on the selected display, keeps it fully visible and clear of
display edges, raises it, and verifies the final geometry. Its result contains
the final frame for window-relative actions and visual checkpoints:

```ts
import { setupMacWindow } from "@actonce/macos";

const windowSetup = await setupMacWindow({
  processName: "lynxtron",
  displayId: 0,
  width: 1372,
  height: 880,
  margin: 40,
});
```

This belongs to the runtime SDK, not to a generated skill or benchmark case.
Window setup requires Accessibility permission for `/usr/bin/osascript` and
fails immediately with that exact diagnosis when permission is missing.

## Generated script contract

```ts
import type { MacReplayScript } from "@actonce/macos";

export const config = {
  bundleId: "com.example.app",
  noReset: true,
};

const replay: MacReplayScript = async ({ mac }) => {
  const save = await mac.find({ accessibilityId: "Save" });
  await save.click();
};

export default replay;
```

Run fragments in one session:

```bash
actonce-macos run 01-setup.js 02-action.js 03-assert.js
```

To make setup atomic with app launch and replay, let `run` normalize the new
process after it creates the Mac2 session. Every fragment then receives the
verified result as `windowSetup`:

```bash
actonce-macos run \
  --app-path /Applications/Example.app \
  --setup-window-process-name Example \
  --setup-display-id 0 \
  --setup-window-width 1200 \
  --setup-window-height 800 \
  --setup-window-margin 40 \
  replay.js
```

The CLI also accepts `--bundle-id`, `--app-path`, `--host`, `--port`,
`--external-server`, `--no-reset`, and `--skip-app-kill`. Use
`actonce-macos source --bundle-id <id>` to inspect the live AX tree.

Native locator preference is accessibility ID, ID, name, predicate, class
chain, and finally XPath. The runtime also exposes guarded coordinate
`click`, `doubleClick`, `rightClick`, `hover`, drag, scroll, keyboard input,
page source, screenshots,
bounded waits, and application activation/termination.

## Fixed primitive lowering

Do not let generated code invent WebDriver implementations for recorded input.
Compile completed macOS input spans to the versioned `replayMacPrimitive` API:

```bash
actonce-macos compile-primitives ./recording/actonce --output replay-input.js
```

The compiler currently maps `tap`, `doubleClick`, `rightClick`, `hover`,
`dragAndDrop`, `typeText`, `keyboardPress`, `clearInput`, and `scroll`. It drops
implementation primitives nested inside a higher-level recorded primitive, and
fails closed for unknown, failed, or incomplete operations. `typeText` uses one
clipboard transaction (with restoration) so `replace: true` is always focus,
select-all, and paste; it never degrades into repeated Backspace or IME typing.

Use `mac.driver` only when Mac2 exposes an operation that the thin runtime has
not wrapped yet.

## Observation planning

Actions and observations compile separately. Before writing assertions, make the
CLI derive the allowed evaluator modality from the selected recording range:

```bash
actonce-macos plan-observations ./recording/actonce \
  --from 5 --to 92 --output observation-plan.json
```

The plan correlates each first-class `observation.completed` event with its
Midscene dump, nearest screenshot evidence, DOM declaration, and available native
UI evidence. It does not guess whether an arbitrary prompt is suitable for OCR.
Choose a registered evaluator in an assertion decision record, then validate it:

```bash
actonce-macos validate-observations ./recording/actonce \
  --decisions assertion-decision.json
```

This validation fails closed when evidence is missing, an assertion does not cite
its recorded artifact, or a screenshot-only observation selects AX/DOM. Built-in
registered evaluators are `apple-vision-ocr`, `bounded-red-pixel-classifier`,
`recorded-screenshot-region-comparison`, `visual-ai`, `macos-ax`, and `dom`. Add a runtime implementation and registry entry
before introducing another evaluator name.

For screenshot-backed checkpoints, compare live screenshots with the recorded
postcondition artifact and poll within the recorded wait budget:

```ts
postcondition: {
  id: "diagnostic-ready",
  expected: {
    visual: {
      referencePath: "/absolute/recording/artifacts/ab/checkpoint.png",
      region: { left: 760, top: 250, width: 480, height: 310 },
      maxDifferenceRatio: 0.03,
    },
  },
  settle: { timeoutMs: 2_500, intervalMs: 125, consecutiveMatches: 2 },
}
```

The visual driver crops the optional region, downsamples it, and compares pixel
differences above a noise threshold. Restrict the region to state necessary for the
next step; do not require the entire desktop to be identical. `plan-observations`
emits `recommendedSettle` when an observation follows a recorded fixed wait, using
that wait as the maximum timeout instead of an unconditional delay.

## Checkpoint-gated replay

Every fragment also receives a shared `flow`. Checkpoint expectations use live Mac2
AX source, element properties, application state, and optional screenshots. Fallback
is disabled by default and must be injected by the runner:

```ts
const replay: MacReplayScript = async ({ mac, flow }) => {
  await flow.segment({
    id: "save-document",
    precondition: {
      id: "save-ready",
      expected: {
        elements: [{
          id: "save",
          locator: { accessibilityId: "Save" },
          displayed: true,
          enabled: true,
        }],
      },
    },
    deterministic: async () => (await mac.find({ accessibilityId: "Save" })).click(),
    postcondition: {
      id: "saved",
      expected: { source: { includes: ["Saved"] } },
    },
    fallback: {
      goal: "Save the current document once, without changing its contents.",
      maxAttempts: 1,
      maxActions: 3,
    },
    idempotency: "observe-before-retry",
  });
};
```

Use `runScripts(paths, { replay: { policy: "recover", fallback } })` to enable a
fallback driver programmatically. The CLI accepts a module that owns the AI agent
and its recorded device lifecycle:

```js
export async function createFallback() {
  const recorded = await createRecordedMidsceneAgent();
  return {
    driver: new MidsceneFallbackDriver(recorded.agent),
    close: () => recorded.close(),
  };
}
```

```bash
actonce-macos run --fallback-module ./fallback.js replay.js
```

Without `--fallback-module`, fallback is explicitly disabled. Hybrid benchmark runners
may provide it, but must count its model latency, actions, and recovery verification in
the measured replay duration and record fallback diagnostics.
