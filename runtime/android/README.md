# `@byted-lynx/actonce-android`

Deterministic Android replay runtime for ActOnce-generated scripts.

It connects to one explicit ADB device, mechanically lowers recorded Android actions to fixed primitives, and gates replay segments with Android accessibility-tree and screenshot checkpoints. The runtime starts one persistent Appium UIAutomator2 server per replay session and reads `/source` from that process; it does not invoke a cold `uiautomator dump` for every checkpoint and does not depend on Midscene. A successful postcondition is reused as the next adjacent precondition until a primitive invalidates the observation.

```bash
actonce-android doctor --serial emulator-5554
actonce-android compile-primitives recordings/<id> --output replay.ts
actonce-android run replay.ts --serial emulator-5554
```

Generated code must use `replayAndroidPrimitive`; do not inline ADB commands. Coordinates are normalized logical points and the native backend converts them to physical ADB coordinates using the device density.
