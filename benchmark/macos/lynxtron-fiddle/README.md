# Lynxtron Fiddle macOS benchmark

This benchmark packages the application fixture, five natural-language test cases,
and Midscene + ActOnce runners for progressively deeper desktop interaction chains.
The machine-readable suite order is [`suite.json`](suite.json); individual prompts,
steps, checkpoints, expectations, and cleanup live under [`cases/`](cases/). The
runner does not embed a second copy of them.

| Case | Complexity | Interaction chain |
| --- | --- | --- |
| `diagnostic-hover` | basic | edit → language-service diagnostic → hover tooltip → undo |
| `palette-find-navigation` | intermediate | command palette → editor switch → Find → selection → return |
| `dual-editor-diagnostic-recovery` | advanced | break two editors → verify independently → recover both |
| `console-gallery-roundtrip` | advanced | toggle console → Gallery navigation → inspect cards → restore view |
| `edit-run-preview-stop-restore` | deep | edit main/package config → run native preview → verify console → stop → restore |

## Reproduce

Requirements:

- Apple Silicon Mac (`darwin/arm64`), Node.js 22 or newer;
- Accessibility and Screen Recording permission for the terminal or host app;
- Accessibility permission for `/usr/bin/osascript`, which activates the exact
  Lynxtron PID through System Events;
- a working Midscene model configuration in the repository `.env`;
- the selected display has enough usable space for a `1372x880` window plus a
  40-point margin on every edge;
- no concurrent mouse, keyboard, window, or clipboard use during the run.
- run from the regular desktop, not another application's full-screen Space.

Install the benchmark-local, pinned Lynxtron runtime and execute the default case:

```bash
npm run benchmark:macos:lynxtron:reproduce
```

Preparation can be run separately and is safe while using the computer:

```bash
npm run benchmark:macos:lynxtron:prepare
```

The interactive command is:

```bash
npm run benchmark:macos:lynxtron
```

Run a specific case:

```bash
npm run benchmark:macos:lynxtron -- --case dual-editor-diagnostic-recovery
```

Run the complete suite, or a selected subset in the given order:

```bash
npm run benchmark:macos:lynxtron:reproduce-suite
npm run benchmark:macos:lynxtron:suite -- \
  --case palette-find-navigation \
  --case edit-run-preview-stop-restore
```

The full suite may control the desktop for several minutes. `suite-runner.ts` runs
cases serially so their windows, keyboard focus, recordings, and cleanup cannot
overlap. A failed case does not prevent later cases from producing evidence.

Set `ACTONCE_DISPLAY_ID` to select the Midscene display (default `0`), or
`ACTONCE_BENCHMARK_OUTPUT_DIR` to use an explicit output directory.

For every case, the runner launches its own Lynxtron process group, normalizes its
exact PID onto the selected display, executes the declared steps, runs the case-specific recovery policy,
closes the recorder, and terminates only the process group it launched. No case may
save. Before formal recording and timing, the runner gives each run a fresh isolated
Fiddle configuration and temporary directory, restores the entire desktop fixture
from its pinned archive, suppresses the first-launch tour, waits for the IDE listener
readiness marker, and uses the shared macOS replay setup to center the window, keep
it fully visible with a 40-point edge margin, raise it, and verify its final frame.
This setup does not use an AI visual assertion. Within the measured task, the case precondition still
verifies unobstructed default editors and no modal dialog, and cases verify visible state after critical
inputs and navigation instead of treating successful event dispatch as proof that the
application consumed an action. Activation/readiness setup happens before formal recording; the precondition,
actions, observations, waits, and cleanup share one ordered recording timeline.

## Replay evaluation

The repository-internal Skill at
`.agents/skills/benchmark-lynxtron-fiddle/SKILL.md` fixes the evaluation procedure
for `diagnostic-hover`. Correctness is a hard gate for performance: the CLI first
checks structured assertions and selects screenshot evidence, then an AI reviews only
that evidence bundle. A speedup is calculated only when both checks pass. Replay may
use bounded fallback; fallback does not disqualify a correct run.

Replay visual assertions crop window-relative regions from the selected display
screenshot. The app's desktop position and unrelated windows are therefore absent
from the correctness oracle; the setup frame is used only to translate recorded
window-relative regions and action points into the live display.

```bash
npm run benchmark:macos:lynxtron:cli -- evidence \
  --original <original-result.json> \
  --replay <replay-result.json> \
  --output <review-directory>
```

The scored interval is `executionDurationMs`; evidence selection and final AI review
are outside it. Fallback model latency, recovery actions, checkpoint revalidation,
and cleanup remain inside it. Fallback diagnostics are reported but are not a separate
score. Compare one correct original run with the median of five independently reset,
correct replay runs.

## Outputs

Each run writes a self-contained directory under
`artifacts/benchmarks/lynxtron-fiddle/<run-id>/`:

```text
result.json                 normalized pass/fail result and provenance
lynxtron.log                captured fixture host output
fixture-config.json         fresh run-local Fiddle preferences and session store
fixture-tmp/                isolated materialized sources and diagnostic files
midscene-report.html        Midscene's generated report
recording/actonce/
  manifest.json             recording metadata and selected display
  events.ndjson             ordered case-step, Midscene, input, AX, and checkpoint events
  artifacts/                screenshots, AX snapshots, and source artifacts
```

A suite run writes `suite-result.json` plus one complete case directory under
`artifacts/benchmarks/lynxtron-fiddle-suites/<suite-run-id>/cases/<case-id>/`.
Each case result includes per-step status, duration, expected value, observed value,
and failure evidence, as well as overall and model-execution duration.
The recorder also emits `benchmark.case.*` and `benchmark.step.*` events, so case
boundaries, waits, raw device actions, observations, and evidence retain one exact
cross-source order instead of requiring later timestamp reconstruction.

Generated dependencies, extracted fixtures, and run outputs are ignored by Git.

## Pinned fixture

[`fixture/lynxtron-fiddle-desktop-arm64.tgz`](fixture/lynxtron-fiddle-desktop-arm64.tgz)
is the verified built desktop bundle from the exact upstream commit recorded in
[`fixture/provenance.json`](fixture/provenance.json). Its SHA-256 is checked before
every run. The official Lynxtron host download is also pinned by version, URL, and
SHA-256. Because its upstream npm postinstall can hang while extracting macOS
frameworks, `prepare.ts` installs the exact npm graph without lifecycle scripts,
then downloads, verifies, and extracts the official host itself. Together, the
archive, provenance record, lockfile, case files, and runners define the reproducible
input.

The built fixture archive intentionally omits the large TypeScript package. After
extraction, the runner links the exact lockfile version into the fixture's own
`desktop/node_modules`; this is required because Node resolves ancestor
`node_modules` before `NODE_PATH`, and the repository compiler may be incompatible
with the bundled extension host. Before opening any UI, every run sends the fixed
syntax probe through the real extension-host IPC and requires the diagnostic
`Expression expected.`. A broken language-service environment therefore fails at
preflight instead of looking like a Midscene visual failure.

To update the fixture intentionally, build the upstream `lynxtron-go/dist/desktop`
bundle, create a new archive, and update the commit and checksum in
`fixture/provenance.json`. Run the repository tests before accepting it; the
fixture contract test rejects an archive whose checksum or structure has drifted.

[中文说明](README.zh-CN.md)
