# ActOnce

[English](README.md) · [简体中文](README.zh-CN.md)

**Let AI explore a UI once. Replay the successful path as a fast, deterministic program.**

Computer-use agents are excellent at discovering how to complete unfamiliar UI tasks. They are much less efficient when asked to rediscover the same stable workflow on every run. ActOnce records one successful AI-driven execution, preserves its actions and evidence, and compiles repeatable segments into checkpoint-gated replay code.

When the live UI still matches the recording, replay stays deterministic. When it diverges, the runtime can stop safely or invoke a bounded AI fallback for only the affected segment.

> The recording is evidence. The compiled, state-aware replay is the executable artifact.

> **Platform status:** macOS is the only platform with a formal original-versus-replay correctness and speed benchmark. iOS now has the recorded Settings replay loop plus a pinned complex checkout fixture validated through seven live WDA checkpoints, but it does not yet have the full scored benchmark suite. Android remains foundational, and Windows support is planned.

## Current result

The default macOS benchmark suite runs three real Lynxtron Fiddle workflows. The latest one-pass development snapshot uses native window-region capture and completed every replay correctly with no AI fallback:

| Workflow | Midscene original median | Latest replay | Speedup |
| --- | ---: | ---: | ---: |
| Syntax diagnostic + hover tooltip | 52.90 s | 5.53 s | 9.56× |
| Editor edit → undo → redo → restore | 57.30 s | 5.03 s | 11.39× |
| Console → Gallery → editors roundtrip | 75.30 s | 8.62 s | 8.73× |
| **Suite total** | **185.49 s** | **19.18 s** | **9.67×** |

All live screenshot checkpoints passed, the fixtures were restored without saving, and fallback count was zero. These replay values are a one-run optimization snapshot; formal scoring uses two independently reset originals and two independently reset replays, with correctness as a hard gate. See the [Lynxtron benchmark guide](benchmark/macos/lynxtron-fiddle/README.md) for the fixed protocol.

## How it works

```text
AI demonstration
      ↓
append-only recording
  actions · timing · screenshots · AX/WDA · semantic observations
      ↓
evidence-aware compilation
  select stable spans · preserve observation modality · lower primitives
      ↓
checkpoint-gated replay
  observe → act → settle → verify → continue
                         ↘ bounded AI fallback when allowed
```

ActOnce deliberately separates four concerns:

- **Interceptors** capture raw events from independent sources into one ordered session log.
- **Published Skills** tell an agent how to record a supported computer-use run and compile useful spans.
- **Platform runtimes** expose fixed, testable action and checkpoint APIs to generated scripts.
- **Benchmarks** compare correctness first, then execution time against the original AI run.

## Repository map

| Path | Purpose |
| --- | --- |
| [`skills/record-device-use`](skills/record-device-use/SKILL.md) | Published recording Skill; its macOS path is validated, while iOS support remains foundational |
| [`skills/compile-device-recording`](skills/compile-device-recording/SKILL.md) | Published Skill for selecting evidence-backed spans and producing replay scripts |
| [`interceptor/`](interceptor/README.md) | Shared append-only log service plus Midscene, macOS input/AX, and WDA sources |
| [`runtime/macos/`](runtime/macos/README.md) | `@byted-lynx/actonce-macos`, the deterministic macOS replay SDK and CLI |
| [`runtime/ios/`](runtime/ios/README.md) | `@byted-lynx/actonce-ios`, fixed WDA primitives, source/visual checkpoints, and replay runner |
| [`runtime/common/`](runtime/common/README.md) | Shared checkpoint-gated replay flow |
| [`runtime/midscene-fallback/`](runtime/midscene-fallback/README.md) | Optional bounded Midscene recovery adapter |
| [`benchmark/macos/lynxtron-fiddle/`](benchmark/macos/lynxtron-fiddle/README.md) | Pinned desktop fixture, natural-language cases, runners, evidence, and evaluator |
| [`benchmark/android/`](benchmark/android/README.md) | Android emulator and Markor benchmark setup |
| [`benchmark/ios/`](benchmark/ios/README.md) | iOS Simulator, WDA, and Midscene smoke setup |
| [`.agents/skills/benchmark-lynxtron-fiddle`](.agents/skills/benchmark-lynxtron-fiddle/SKILL.md) | Repository-internal benchmark procedure; not a published Skill |

## Quick start

Requirements: Node.js 22 or newer and macOS permissions appropriate to the platform workflow you run.

Install the complete synchronized distribution from BNPM:

```bash
npm install @byted-lynx/actonce --registry=http://bnpm.byted.org
npx actonce skill install record-device-use
npx actonce skill install compile-device-recording
```

The installer copies each complete Skill directory into `${CODEX_HOME}/skills` when `CODEX_HOME` is set, otherwise `~/.codex/skills`. Use `--target <directory>` for another agent. APIs are exposed through platform subpaths:

```ts
import { ReplayFlow } from "@byted-lynx/actonce/replay";
import { replayMacPrimitive } from "@byted-lynx/actonce/macos";
import { replayIOSPrimitive } from "@byted-lynx/actonce/ios";
```

Every `@byted-lynx/actonce-*` component belongs to one Changesets fixed group, so the umbrella package, recorder, runtimes, and Skills always publish with the same version. Individual component packages remain installable for narrower environments.

For repository development:

```bash
npm install
npm test
npm run typecheck
```

Prepare the pinned Lynxtron fixture and run its default original suite:

```bash
npm run benchmark:macos:lynxtron:prepare
npm run benchmark:macos:lynxtron:suite
```

Desktop benchmark commands control the mouse, keyboard, clipboard, applications, windows, and displays. Do not use the machine concurrently while they run.

Midscene originals require a compatible multimodal model. Copy the tracked template and keep the real key local:

```bash
cp .env.example .env
# Edit .env, then verify the configured provider.
npm run model:verify
```

Never commit API keys or record sensitive UI content. `.env`, recordings, generated fixtures, and benchmark artifacts are ignored by Git.

## Recording and compilation

Stable platform combinations are encoded in the CLI rather than improvised inside a Skill. The recording Skill selects a supported profile; every enabled interceptor contributes events to the same ordered session.

```bash
npm run interceptor:profiles
npm run interceptor:start -- record midscene-macos \
  --entry /absolute/path/to/task.ts \
  --display-id 0
```

The resulting recording uses a primary manifest and `events.ndjson`, with content-addressed screenshots, AX trees, WDA payloads, and source artifacts beside it. Semantic Midscene Assert, Boolean, and Query outcomes are first-class observation events with their evidence provenance.

The compilation Skill then selects useful spans, lowers recorded input through fixed runtime primitives, plans observations from evidence actually present in the range, and validates every assertion decision before replay.

## macOS replay runtime

[`@byted-lynx/actonce-macos`](runtime/macos/README.md) is the first complete platform runtime. It wraps Appium Mac2/WebDriverIO for application control and fixed input primitives, normalizes the target window onto a selected display, and provides native window-region screenshots for fast visual checkpoints.

```ts
import {
  captureMacRegionScreenshot,
  replayMacPrimitive,
  setupMacWindow,
} from "@byted-lynx/actonce-macos";

const setup = await setupMacWindow({
  processName: "Example",
  displayId: 0,
  width: 1200,
  height: 800,
  margin: 40,
});

await captureMacRegionScreenshot("checkpoint.png", setup.frame, {
  timeoutMs: 2_000,
});
```

Window-relative screenshots avoid routing full-display Retina PNGs through WDA. Generated actions and visual regions share the verified window frame, so unrelated displays, applications, and desktop position are not part of the oracle.

## Evaluation contract

ActOnce reports two benchmark dimensions:

1. **Correctness** — structured assertions and selected screenshot evidence pass, followed by AI review of the evidence bundle.
2. **Conditional performance** — only after correctness passes, compare the median original duration with the median replay duration.

Fallback latency, checkpoint polling, recovery, and cleanup remain inside replay time. Fallback count and end-to-end controller startup are diagnostics, not extra scores. A fast but incorrect replay is never comparable.

## Status

ActOnce is an active prototype focused on developer-machine workflows. **macOS is currently the only platform with a formal benchmark-validated original-to-replay comparison.** iOS has a working recorded Settings loop and a pinned complex demo-app flow covering product selection, cart state, demo login, and checkout address verification; formal iOS scoring is still pending. Android remains at the capture/environment foundation stage.

The next engineering focus is reducing screenshot capture overhead further, generalizing compilation beyond the current benchmark cases, and implementing platform-native runtimes independently for iOS, Android, and Windows rather than forcing a premature cross-platform action API.
