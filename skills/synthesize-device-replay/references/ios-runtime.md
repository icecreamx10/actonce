# iOS replay target

Generate iOS replay fragments for `@byted-lynx/actonce-ios`. The runtime connects to the
explicit Simulator/WebDriverAgent selected by the repository environment; it does
not boot, erase, or choose a device inside generated code.

## Lower recorded actions

Only after the agent-authored synthesis ledger passes validation, lower one ledger
action and its cited before/after evidence at a time:

```bash
actonce-ios compile-primitives <recording-or-segment> --output recorded-input.js
```

This compatibility command lowers a completed Midscene logical action from its normalized iOS device
coordinates. Do not copy raw screenshot-pixel coordinates: Midscene screenshots
may be DPR-scaled while WDA input uses logical device points. Unknown or incomplete
actions fail closed. It does not choose or merge segments. Never pass it a whole
recording, task range, or multi-action slice.

## Guarded fragments

Compose fixed calls with the shared replay flow:

```ts
import { replayIOSPrimitive } from "@byted-lynx/actonce-ios";

export default async function replay({ ios, flow }) {
  await flow.segment({
    id: "open-general",
    precondition: {
      id: "settings-root",
      expected: { source: { includes: ["com.apple.settings.general"] } },
    },
    deterministic: () => replayIOSPrimitive(ios, {
      operation: "tap",
      arguments: [{ x: 218, y: 328 }],
    }),
    postcondition: {
      id: "general-visible",
      expected: { source: { includes: ["About", "关于本机"] } },
      settle: { timeoutMs: 2_500, intervalMs: 100 },
    },
  });
}
```

Use WDA source assertions only for facts backed by a relevant recorded WDA/native
artifact. A Midscene Assert/Boolean/Query with screenshot context remains visual:
cite its recorded screenshot and use a visual evaluator for that semantic result,
even when a WDA checkpoint is also available nearby. WDA checkpoints may still
guard action boundaries independently.

Treat the benchmark fixture reset and public task/oracle as contracts. Generate a new
replay from the selected recording; do not copy an existing case-specific replay.
Guard cleanup/retry primitives individually and skip remaining calls once the final
recorded state matches.

## Verification

Start the dedicated environment outside the scored replay interval:

```bash
npm run ios:start
npm run ios:wda
actonce-ios doctor
actonce-ios run setup.js actions.js assertions.js
```

Reset the target app before every attempt, run all fragments in one WDA session,
verify the final state through the recorded modality, and restore any changed state.
Preserve failed artifacts and repeat the full fresh-state case until two consecutive
runs pass or a concrete external blocker is established.
