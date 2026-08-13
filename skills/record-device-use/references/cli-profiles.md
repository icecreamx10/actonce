# ActOnce CLI recording profiles

Always discover profiles from the installed CLI:

```bash
actonce-record profiles --json
```

Inside an ActOnce checkout, `npm run interceptor:start -- profiles --json` is equivalent.

The current public contracts are:

| Profile | Task input | CLI-owned capture |
|---|---|---|
| `midscene-macos` | task module | Midscene semantics, macOS input primitives, checkpoints |
| `midscene-ios` | task module | Midscene semantics, correlated WDA traffic, screenshot and native UI checkpoints |
| `midscene-android` | task module | Midscene semantics, normalized Android actions, screenshot and UI-tree checkpoints |
| `ios-wda` | external WDA client | transparent WDA request/response traffic |

The table is explanatory. Treat CLI output as authoritative when versions differ.

## Task-module contract

Task modules export a default function or named `run` function. They receive an already connected, already recorded agent and device:

```ts
export default async function run({ agent, device, recordingDir, args }) {
  await agent.aiAssert("The target application is ready");
  // Perform the intended task through agent or device.
}
```

Do not construct a second Midscene agent or device. Do not import recorder internals. Do not call `process.exit`, because the CLI must close the recording.

## Midscene macOS

```bash
actonce-record record midscene-macos \
  --entry /absolute/path/to/task.ts \
  --display-id 0 \
  --recording-id task-name-001
```

## Midscene iOS

Start WebDriverAgent on its upstream port, then run:

```bash
actonce-record record midscene-ios \
  --entry /absolute/path/to/task.ts \
  --upstream-host 127.0.0.1 \
  --upstream-port 8100 \
  --listen-port 8200 \
  --recording-id task-name-001
```

The profile constructs Midscene against the proxy. The task module must not override the WDA address.

## Generic iOS WDA

```bash
actonce-record record ios-wda \
  --upstream-port 8100 \
  --listen-port 8200 \
  --recording-id task-name-001
```

Point the external WDA client at the printed proxy address. Send SIGINT after the client finishes so the manifest is finalized.

## Midscene Android

Start or select one ADB device outside the recording, then run:

```bash
actonce-record record midscene-android \
  --entry /absolute/path/to/task.ts \
  --serial emulator-5554 \
  --recording-id task-name-001
```

Use `--adb-path <path>` only when `adb` is not available from `$ANDROID_HOME` or `PATH`. The profile owns the connected `AndroidDevice`, logical-action hooks, and concurrent screenshot/UI-tree checkpoints. The task module must not create a second device or run an independent recorder.

Use `--recordings-dir <path>` to override the output root. Arguments after `--` are passed to task modules as `context.args`.
