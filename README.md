# ActOnce

[English](README.md) · [简体中文](README.zh-CN.md)

**Let AI explore a UI once. Replay the successful path as a fast, deterministic program.**

Computer-use agents are good at discovering unfamiliar interfaces, but repeatedly rediscovering a stable workflow is slow and expensive. ActOnce records one successful AI run, preserves its actions and evidence, and lets an agent synthesize reusable spans into checkpoint-gated replay code.

When the live UI matches the recording, replay stays deterministic. On divergence, it fails closed or invokes an explicitly bounded AI fallback for only the affected span.

> The recording is evidence. The agent-authored, state-aware replay is the executable artifact.

**Platform status:** macOS, iOS, and Android have native deterministic runtimes and benchmark-validated original-to-replay paths. Windows is planned.

## Results

Correctness is a hard gate: ActOnce reports speed only when the replay passes the same task oracle as the original.

| Benchmark | AI original | Deterministic replay | Speedup | Correctness |
| --- | ---: | ---: | ---: | --- |
| macOS · 3-case Lynxtron suite | 185.49 s | 19.18 s | 9.67× | 3/3, fallback 0 |
| iOS · checkout | 220.246 s | 10.499 s | 20.98× | 2/2, fallback 0 |
| Android · checkout | 140.446 s | 17.412 s | 8.07× | 2/2, fallback 0 |
| AndroidWorld · verified 5-case slice | 972.837 s | 95.938 s | 10.14× | 5/5, fallback 0 |

The AndroidWorld target is all 113 tasks that passed at least one of Midscene's three published rounds. Its latest verified slice includes `ExpenseAddMultiple`: official reward `1.0` for both original and replay, `293.799 s → 56.803 s` (`5.17×`). Full-suite scoring is still in progress.

Protocols and evidence:

- [macOS Lynxtron Fiddle](benchmark/macos/lynxtron-fiddle/README.md)
- [iOS simulator benchmark](benchmark/ios/README.md)
- [Android checkout benchmark](benchmark/android/README.md)
- [AndroidWorld harness](benchmark/android/android-world/README.md)

## How it works

```text
AI demonstration
      ↓
append-only recording
  actions · timing · screenshots · AX/WDA/UIA2 · semantic observations
      ↓
agent replay synthesis
  inspect evidence · author transitions · validate · lower one action at a time
      ↓
checkpoint-gated replay
  observe → act → settle → verify → continue
                         ↘ bounded AI fallback when allowed
```

Four layers stay deliberately separate:

- **Interceptors** merge raw events from independent sources into one ordered session.
- **Published Skills** guide supported recording and agent-authored replay synthesis.
- **Native runtimes** expose fixed, testable action and checkpoint APIs.
- **Benchmarks** validate correctness first and compare end-to-end execution time second.

Midscene is isolated behind `@byted-lynx/actonce-midscene-adapter`. AI demonstrations may use it; deterministic runtimes may not. iOS talks directly to WDA, Android uses ADB plus persistent UIAutomator2, and macOS uses native input, accessibility, and window-region capture.

## Repository map

| Path | Purpose |
| --- | --- |
| [`skills/record-device-use`](skills/record-device-use/SKILL.md) | Published recording Skill |
| [`skills/synthesize-device-replay`](skills/synthesize-device-replay/SKILL.md) | Published agent-authored evidence-to-replay Skill |
| [`skills/hybrid-replay`](skills/hybrid-replay/SKILL.md) | Optional agent recovery for a preserved failed checkpoint |
| [`interceptor/`](interceptor/README.md) | Ordered recorder and platform/Midscene sources |
| [`packages/midscene-adapter/`](packages/midscene-adapter/README.md) | Sole Midscene dependency boundary |
| [`runtime/common/`](runtime/common/README.md) | Shared checkpoint-gated replay flow |
| [`runtime/macos/`](runtime/macos/README.md) | Native macOS runtime and CLI |
| [`runtime/ios/`](runtime/ios/README.md) | Direct WDA runtime and checkpoints |
| [`runtime/android/`](runtime/android/README.md) | ADB/UIAutomator2 runtime and checkpoints |
| [`benchmark/`](benchmark/) | Reproducible fixtures, runners, and evaluators |

## Quick start

Requirements: Node.js 22 or newer, plus the permissions and device tooling required by the selected platform.

Install the synchronized distribution and Skills from BNPM:

```bash
npm install @byted-lynx/actonce --registry=http://bnpm.byted.org
npx actonce skill install record-device-use
npx actonce skill install synthesize-device-replay
npx actonce skill install hybrid-replay
```

Use platform subpath exports:

```ts
import { ReplayFlow } from "@byted-lynx/actonce/replay";
import { replayMacPrimitive } from "@byted-lynx/actonce/macos";
import { replayIOSPrimitive } from "@byted-lynx/actonce/ios";
import { replayAndroidPrimitive } from "@byted-lynx/actonce/android";
```

For repository development:

```bash
npm install
npm test
npm run typecheck
```

Midscene originals require a compatible multimodal model. Keep credentials local:

```bash
cp .env.example .env
# Edit .env, then verify the configured provider.
npm run model:verify
```

Never commit API keys or record sensitive UI. `.env`, recordings, generated fixtures, and benchmark artifacts are ignored by Git.

## Record and synthesize replay

Supported source combinations are fixed CLI profiles rather than Skill-time wiring. Every enabled interceptor writes to the same session log.

```bash
npm run interceptor:profiles

npm run interceptor:start -- record midscene-macos \
  --entry /absolute/path/to/task.ts \
  --display-id 0

npm run interceptor:start -- record midscene-android \
  --entry /absolute/path/to/task.ts \
  --serial emulator-5554
```

Each recording contains a manifest, ordered `events.ndjson`, and content-addressed screenshots, native UI trees, WDA payloads, and source artifacts. Midscene Assert, Boolean, and Query results are first-class semantic observations with evidence provenance.

The synthesis Skill requires the agent to author an evidence ledger and one checkpoint-gated segment per state-changing action before deterministic tools may lower that action through the native runtime. The generated plan is then executed until it is stable or a concrete blocker is proven.

## Evaluation contract

1. **Correctness:** runtime checkpoints pass, then the independent task oracle passes.
2. **Conditional performance:** only correct replays are compared with the original AI duration.

Checkpoint capture, settling, fallback, recovery, and cleanup stay inside replay time. Fallback count and capture/settle durations are reported as diagnostics. A fast incorrect replay is never comparable.

ActOnce remains an active prototype. The current focus is broader AndroidWorld coverage, lower checkpoint capture cost, general replay synthesis beyond fixed benchmarks, and independent Windows support.
