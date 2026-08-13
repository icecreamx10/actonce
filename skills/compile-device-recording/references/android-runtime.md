# Android replay target

Generate Android replay fragments for `@byted-lynx/actonce-android`. Select and reset the ADB device outside generated fragments; let the runner own connection and cleanup.

## Lower recorded actions

```bash
actonce-android compile-primitives <recording-or-segment> --output recorded-input.js
```

Use the normalized logical coordinates from completed Midscene actions. Do not copy physical screenshot pixels or inline `adb shell input`. Unknown actions fail closed.

## Guarded fragments

Compose `replayAndroidPrimitive` calls with `flow.segment`. Guard state transitions with Android UI-tree expectations only when a relevant `checkpoint.captured` native UI artifact supports the fact. A screenshot-backed Midscene Assert/Boolean/Query remains visual even when an Android UI tree exists nearby.

The Android checkpoint driver reuses a matched postcondition as the immediately adjacent precondition while no primitive has run. Every primitive invalidates that observation before acting, so do not add fixed sleeps or duplicate source reads between segments.

## Verification

```bash
actonce-android doctor --serial emulator-5554
actonce-android run setup.js actions.js assertions.js --serial emulator-5554
```

Reset the app before every attempt. Require the recorded semantic outcome, final screenshot/native state, fallback count, and cleanup state to pass. Preserve failures and repeat the complete fresh-state case until two consecutive runs pass or a concrete blocker is established.
