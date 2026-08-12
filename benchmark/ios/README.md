# iOS Simulator benchmark

[English](README.md) | [简体中文](README.zh-CN.md)

This is the first real-device-style ActOnce path. It uses a dedicated iOS
Simulator, Appium's WebDriverAgent (WDA), and Midscene's iOS adapter. No test APK
or third-party app download is required.

## Why iOS first

The installed Xcode runtime already provides a complete simulator image and a
real framebuffer. This avoids the Android ATD framebuffer limitation and the
large Google APIs image download that blocked the first Android visual run.

ActOnce creates or reuses a simulator named `ActOnce iPhone 17 Pro`; it does not
erase or modify an unrelated simulator. Override the selected device with
`ACTONCE_IOS_UDID` when needed.

## Start the environment

Requirements:

- Xcode with the iOS 26.5 Simulator runtime;
- Node.js 22 or newer;
- `jq` for resolving the dedicated Simulator from `simctl` output;
- the repository dependencies installed with `npm install`.

Start the dedicated simulator and WDA:

```bash
npm run ios:start
npm run ios:wda
```

`ios:wda` is a long-running foreground service and writes its log to
`.cache/ios-runtime/wda.log`. Keep that terminal open, then use a second terminal
to verify the WDA connection and screenshot path without making a model call:

```bash
npm run ios:wda:smoke
```

The smoke test writes `.cache/ios-runtime/wda-smoke.png`. It must contain a real
iOS frame, not a black image.

## Midscene smoke task

The deterministic first task uses the built-in Settings app and does not change
system state:

> Open General, open About, and verify that device information is visible.

Run it with the model configuration from the ignored local `.env` file:

```bash
npm run benchmark:ios:smoke
```

The runner stops after the first failed step so a visual or connectivity issue
cannot trigger a long chain of unnecessary model calls. JSON metrics are stored
under `artifacts/benchmarks/`, and the Midscene report is stored under
`midscene_run/report/`.

Validated locally on the dedicated iPhone 17 Pro / iOS 26.5 simulator: the task
passed in 25.9 seconds with 2 agent calls and 4 model calls. This is the first
mobile baseline to compare with a recorded replay.

The next qualitative benchmark will use the built-in Reminders app: create a
fixed reminder, set its priority, return to the list, reopen it, and verify the
result. `com.apple.reminders` is present in the pinned simulator runtime, so it
requires no external app source. Settings remains the cheaper connection gate
before that task.

Stop WDA when finished:

```bash
npm run ios:wda:stop
```

## Security note

WDA gives its client full control of the selected simulator. Keep port 8100
local, use the dedicated simulator, and do not put credentials or personal data
inside benchmark fixtures. The current Midscene/WDA dependency tree also has
upstream `npm audit` findings, so this environment is for local development only.
