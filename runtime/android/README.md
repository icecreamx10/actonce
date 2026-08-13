# `@byted-lynx/actonce-android`

Deterministic Android replay runtime for ActOnce-generated scripts.

It connects to one explicit ADB device, mechanically lowers completed Midscene Android actions to fixed primitives, and gates replay segments with Android UI-tree and screenshot checkpoints. A successful postcondition is reused as the next adjacent precondition until a primitive invalidates the observation, avoiding duplicate `uiautomator dump` calls without weakening the state boundary.

```bash
actonce-android doctor --serial emulator-5554
actonce-android compile-primitives recordings/<id> --output replay.ts
actonce-android run replay.ts --serial emulator-5554
```

Generated code must use `replayAndroidPrimitive`; do not inline ADB commands. Coordinates are the normalized logical coordinates recorded by Midscene and are converted to physical display coordinates by `AndroidDevice`.
