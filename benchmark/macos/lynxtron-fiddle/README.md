# Lynxtron Fiddle macOS benchmark

This benchmark packages the application fixture, the natural-language test case,
and the Midscene + ActOnce runner needed to reproduce one real desktop task:

> In Lynxtron Fiddle, introduce a JavaScript syntax error in the top-left editor,
> verify that a red wavy underline appears, hover that underline, and verify that
> its diagnostic tooltip says `Expression expected.`. Restore the editor afterwards
> without saving.

The machine-readable source of this task is [`testcase.json`](testcase.json). The
runner does not embed a second copy of the prompts; setup, actions, observations,
expected values, and cleanup all come from that file.

## Reproduce

Requirements:

- Apple Silicon Mac (`darwin/arm64`), Node.js 22 or newer;
- Accessibility and Screen Recording permission for the terminal or host app;
- Accessibility permission for `/usr/bin/osascript`, which activates the exact
  Lynxtron PID through System Events;
- a working Midscene model configuration in the repository `.env`;
- one active display. Midscene 1.10.10 does not reliably target this fixture with
  multiple displays attached;
- no concurrent mouse, keyboard, window, or clipboard use during the run.
- run from the regular desktop, not another application's full-screen Space.

Install the benchmark-local, pinned Lynxtron runtime and execute the case:

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

Set `ACTONCE_DISPLAY_ID` to select the Midscene display (default `0`), or
`ACTONCE_BENCHMARK_OUTPUT_DIR` to use an explicit output directory.

The runner launches its own Lynxtron process group, activates its exact PID, executes
the natural-language case, performs two Undo operations, closes the recorder, and
terminates only the process group it launched. It never saves the edited fixture.
The activation/readiness setup is performed before formal recording; the test action,
observations, and cleanup are recorded.

## Outputs

Each run writes a self-contained directory under
`artifacts/benchmarks/lynxtron-fiddle/<run-id>/`:

```text
result.json                 normalized pass/fail result and provenance
lynxtron.log                captured fixture host output
midscene-report.html        Midscene's generated report
recording/actonce/
  manifest.json             recording metadata and selected display
  events.ndjson             ordered Midscene, input, AX, and checkpoint events
  artifacts/                screenshots, AX snapshots, and source artifacts
```

Generated dependencies, extracted fixtures, and run outputs are ignored by Git.

## Pinned fixture

[`fixture/lynxtron-fiddle-desktop-arm64.tgz`](fixture/lynxtron-fiddle-desktop-arm64.tgz)
is the verified built desktop bundle from the exact upstream commit recorded in
[`fixture/provenance.json`](fixture/provenance.json). Its SHA-256 is checked before
every run. The official Lynxtron host download is also pinned by version, URL, and
SHA-256. Because its upstream npm postinstall can hang while extracting macOS
frameworks, `prepare.ts` installs the exact npm graph without lifecycle scripts,
then downloads, verifies, and extracts the official host itself. Together, the
archive, provenance record, lockfile, testcase, and runner define the reproducible
input.

To update the fixture intentionally, build the upstream `lynxtron-go/dist/desktop`
bundle, create a new archive, and update the commit and checksum in
`fixture/provenance.json`. Run the repository tests before accepting it; the
fixture contract test rejects an archive whose checksum or structure has drifted.

[中文说明](README.zh-CN.md)
