# ActOnce

[English](README.md) | [简体中文](README.zh-CN.md)

Record an AI-driven UI task once, then replay it deterministically.

## Motivation

Vision-driven agents such as Midscene can operate interfaces that are difficult to automate with selectors alone. They are especially useful when a task is being explored for the first time, but asking a model to rediscover the same stable workflow on every run adds latency, cost, and nondeterminism.

ActOnce treats a successful AI run as a demonstration that can be compiled. During the demonstration it records the executed device actions, their intended targets, and the UI state before and after each step. Later runs use a deterministic replay engine and ask an AI for help only when the recorded flow no longer matches the current UI.

The core hypothesis is:

> Stable qualitative UI tasks can retain the reach of an AI operator while making repeated runs approach the speed, cost, and reproducibility of conventional automation.

## Basic method

An ActOnce flow has three phases:

1. **Demonstrate** — an AI agent completes the task through an instrumented device adapter.
2. **Compile** — ActOnce stores actions, multiple target locators, preconditions, postconditions, and redacted data bindings as a readable flow.
3. **Replay** — the runtime resolves targets deterministically, performs each action, and verifies the resulting state. A bounded AI fallback can repair a failed step and propose a versioned locator patch.

The intended target-resolution order is:

1. stable structural identifiers, such as resource ID or accessibility label;
2. text and local UI structure;
3. position relative to a stable container;
4. local visual matching;
5. normalized coordinates;
6. AI relocation as a bounded fallback.

ActOnce records videos and screenshots for diagnosis, but they are evidence rather than the executable representation. The executable artifact is a state-aware flow: wait for a precondition, resolve a target, perform an action, wait for the UI to settle, and verify a postcondition.

## Initial goal

The first milestone is deliberately narrow: prove the hypothesis on one deterministic browser task with Midscene as the AI baseline.

The milestone is successful when:

- Midscene can complete the local benchmark task and produce a result report;
- one successful run can be represented as an ActOnce flow;
- the flow can pass 20 consecutive clean replays without a model call;
- median replay time is at least 5x faster than the Midscene baseline;
- replay detects an intentionally changed postcondition instead of silently passing;
- a small locator change can be recovered by one bounded AI fallback and saved as a reviewable patch.

This milestone does **not** attempt cross-app mobile navigation, arbitrary workflow discovery, CAPTCHA handling, or unattended execution of destructive actions.

## Benchmark 001: create a test ticket

The repository contains a deterministic local fixture. The task is:

> Create a high-priority ticket titled “Payment button fails on checkout”, include diagnostics, submit it, and verify that ticket `T-1001` was created.

The task covers text entry, option selection, a checkbox, submission, asynchronous UI state, and semantic result verification. Keeping the application local removes network and third-party UI variance from the first comparison.

Each runner writes JSON results under `artifacts/benchmarks/`. We will compare:

| Metric | Meaning |
| --- | --- |
| task success | The required postcondition was observed |
| wall time | End-to-end duration of the task |
| agent calls | Calls made to the agent API; exact provider usage will be added at the model-client boundary |
| AI fallbacks | Model-assisted repairs during replay |
| verification failures | Actions that ran but did not reach the expected state |

## Development setup

Requirements:

- Node.js 22 or newer
- a Chromium browser installed through Playwright
- a Midscene-compatible multimodal model for the AI baseline

Install dependencies and Chromium:

```bash
npm install
npx playwright install chromium
```

For the first baseline, use the Gemini free tier. Create an API key in
[Google AI Studio](https://aistudio.google.com/apikey), then create the local
configuration from the tracked template:

```bash
cp .env.example .env
# Edit .env and replace MIDSCENE_MODEL_API_KEY.
npm run model:verify
```

The template uses `gemini-3.5-flash`, which Midscene recommends for Gemini UI
localization. Free-tier limits can change, and Google may use free-tier inputs
to improve its products, so benchmark screenshots must not contain sensitive
data. The real `.env` file is ignored by Git.

Start only the deterministic fixture:

```bash
npm run benchmark:fixture
```

Then open <http://127.0.0.1:4173>.

Run the Midscene baseline:

```bash
npm run benchmark:midscene
```

For the Android emulator, Midscene connection smoke test, and pinned Markor APK benchmark setup, see [the Android benchmark guide](benchmark/android/README.md).

For the dedicated iOS Simulator, WebDriverAgent, and Midscene iOS smoke task, see [the iOS benchmark guide](benchmark/ios/README.md).

For the reproducible macOS Lynxtron Fiddle diagnostic-hover case—including the pinned app fixture, natural-language testcase, runner, and output contract—see [the Lynxtron Fiddle benchmark guide](benchmark/macos/lynxtron-fiddle/README.md).

The passive, append-only WDA capture boundary is specified in [the interceptor design](interceptor/README.md).

Run repository checks:

```bash
npm test
npm run typecheck
```

## Near-term roadmap

1. Stabilize the benchmark contract and collect Midscene baseline results.
2. Define the versioned ActOnce flow schema.
3. Instrument the action adapter and compile the first successful trace.
4. Implement deterministic web replay and postcondition checks.
5. Add bounded AI relocation and reviewable repair patches.
6. Reuse the protocol behind an Android ADB/UIAutomator adapter.

## Status

ActOnce is an early experiment. The current repository establishes the motivation, benchmark contract, and Midscene baseline; the recorder and replay engine are the next implementation milestone.

The current Midscene dependency tree contains upstream `npm audit` findings. The benchmark is local-only and must not be exposed to untrusted input while those transitive dependencies remain unresolved.
