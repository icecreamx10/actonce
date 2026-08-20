# Android replay target

Generate Android replay fragments for `@byted-lynx/actonce-android`. Select and reset the ADB device outside generated fragments; let the runner own connection and cleanup.

## Lower recorded actions

Only after the agent-authored synthesis ledger passes validation, extract one ledger
action with its cited before/after evidence and lower that single-action slice:

```bash
actonce-android compile-primitives <recording-or-segment> --output recorded-input.js
```

Use the normalized logical coordinates from completed Midscene actions. Do not copy physical screenshot pixels or inline `adb shell input`. Unknown actions fail closed.
The compatibility command does not choose or merge segments. Never pass it a whole
recording, task range, or multi-action slice.

## Guarded fragments

Compose `replayAndroidPrimitive` calls with `flow.segment`. Guard state transitions with Android UI-tree expectations only when a relevant `checkpoint.captured` native UI artifact supports the fact. A screenshot-backed Midscene Assert/Boolean/Query remains visual even when an Android UI tree exists nearby.

The Android checkpoint driver reuses a matched postcondition as the immediately adjacent precondition while no primitive has run. Every primitive invalidates that observation before acting, so do not add fixed sleeps or duplicate source reads between segments.

Treat the benchmark fixture reset and public task/oracle as contracts. Generate a new
replay from the selected recording; do not copy an existing case-specific replay.
Guard cleanup/retry primitives individually and skip remaining calls once the final
recorded state matches.

## Verification

```bash
actonce-android doctor --serial emulator-5554
actonce-android run setup.js actions.js assertions.js --serial emulator-5554
```

Reset the app before every attempt. Require the recorded semantic outcome, final
screenshot/native state, and cleanup state to pass. Preserve failures and repeat
the complete fresh-state case until two consecutive runs pass or a concrete
blocker is established. Hand a checkpoint failure to `hybrid-replay` only when an
agent should recover the live device state.
