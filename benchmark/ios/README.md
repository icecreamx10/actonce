# iOS Simulator benchmark

[English](README.md) | [简体中文](README.zh-CN.md)

This is the first real-device-style ActOnce path. It uses a dedicated iOS
Simulator, Appium's WebDriverAgent (WDA), and Midscene's iOS adapter. The cheap
Settings gate needs no external app; the qualitative checkout case uses a pinned
public Simulator fixture.

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

## Recorded deterministic replay smoke

The Settings path now also validates the ActOnce loop itself. Keep WDA running,
record one Midscene demonstration, mechanically lower its completed logical
actions, and run the fixed replay:

```bash
npm run benchmark:ios:record-settings
npm run ios:compile-primitives -- <recording-dir> --output /tmp/settings-actions.js
npm run benchmark:ios:replay-settings
```

The validated recording contains one ordered session with Midscene semantics,
four screenshot/native-source checkpoints, and all intercepted WDA exchanges.
The compiler lowers the two completed taps from normalized logical device points;
the replay guards Settings, General, About, device-information, and cleanup states
with live WDA source checks. Two development smoke executions passed with no
checkpoint timeout or AI fallback. This is not yet the formal two-original versus
two-replay performance score used by the macOS suite.

## Complex checkout fixture

The first qualitative iOS case uses Sauce Labs My Demo App `2.2.2`, a public app
built for UI automation. ActOnce does not redistribute the third-party binary.
The fixture CLI downloads the official Simulator release into `.cache/`, verifies
its pinned SHA-256, validates its bundle id/version, and installs it only on the
dedicated ActOnce Simulator. The upstream public repository does not declare an
OSI license, so this is an external test fixture rather than a vendored
open-source dependency.

Prepare or reset it, then run the no-model environment gate:

```bash
npm run ios:prepare:demo-app
npm run benchmark:ios:demo-app:smoke
```

The smoke follows Catalog → product details → quantity 3 → Cart → Checkout →
built-in demo login → prefilled shipping address. Seven WDA source checkpoints
advance as soon as the expected state appears; the case stops before payment.
The validated local run passed in 11.7 seconds and wrote its final screenshot and
structured oracle to `.cache/ios-runtime/my-demo-app-smoke/`.

Record the same qualitative goal with Midscene:

```bash
npm run benchmark:ios:record-demo-app
```

That command always performs the fixture reset first.

The first two-original/two-replay benchmark passed its correctness gate. Both
replays reached the expected prefilled shipping address, retained a cart badge of
3, and stopped before payment, with zero fallback and zero checkpoint timeout.

| Measurement | Result |
| --- | ---: |
| Midscene original durations | 271.392 s, 169.100 s |
| Deterministic replay durations | 9.983 s, 11.015 s |
| Original median | 220.246 s |
| Replay median | 10.499 s |
| Speedup | 20.98× |
| Time reduction | 95.23% |

The compiler mechanically lowered 11 taps and omitted one recorded `Sleep`;
live checkpoint settling replaces that fixed wait. Failed development attempts
caused by ambiguous fixture styling or model timeout were preserved but excluded
before the formal pair was selected.

Stop WDA when finished:

```bash
npm run ios:wda:stop
```

## Security note

WDA gives its client full control of the selected simulator. Keep port 8100
local, use the dedicated simulator, and do not put credentials or personal data
inside benchmark fixtures. The current Midscene/WDA dependency tree also has
upstream `npm audit` findings, so this environment is for local development only.
