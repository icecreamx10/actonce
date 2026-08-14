---
name: benchmark-android-world
description: Run repository-internal AndroidWorld original-versus-ActOnce replay benchmarks with official task initialization and validation. Use for a single case or the complete catalog of cases marked PASS by Midscene's published AndroidWorld report. Formal measurements must be delegated to a completely context-free agent.
---

# Benchmark AndroidWorld

Treat the official AndroidWorld reward as the correctness gate. Never report a
speedup for a replay whose reward is not exactly `1.0`.

## Context isolation

Execute every measured benchmark in a completely fresh agent context. The agent
that authored, compiled, debugged, or repaired the runner must not execute or
judge the measured run.

1. The coordinating agent must start a new benchmark agent with no forked
   conversation turns or inherited summary (for example, `fork_turns: "none"`).
2. Give it only the repository path, this Skill path, and the request to run the
   named case. Do not include expected actions, coordinates, timings, prior
   results, failure diagnoses, or intended fixes.
3. Let the fresh agent reconstruct the procedure from committed repository
   files and raw artifacts. Environment secrets may remain available through
   ignored local configuration, but never include their values in the prompt.
4. If no facility exists to start an isolated agent, stop and report that the
   benchmark is not independently validated. Do not substitute the current
   context and label it fresh.

Development runs used to repair a failure are not measured results. After any
repair, create another fresh zero-context agent and restart the measured case
from initialization.

The fresh benchmark agent must label its result `formal` only when it received
no inherited context and used a clean output directory. Record this isolation
fact in the result summary. If it needs to change benchmark code, its run becomes
development-only: return the diagnosis to the coordinator, commit the repair,
then delegate the formal rerun to a different fresh agent.

## Suite scope

Use `npm run android-world:catalog` as the pinned offline catalog. The default
complete target is `pass@3`: all 113 tasks that passed in at least one of
Midscene's three published rounds. Preserve `pass@1` as the 108-task first-run
view; never describe the two sets as equivalent.

For each catalog case:

1. Generate and persist one official AndroidWorld parameter set per sample.
2. Run the official initializer, record the Midscene original, and require the
   official reward to be exactly `1.0`.
3. Compile replay only from that complete recording and its evidence.
4. Execute replay through ActOnce's native Android runtime and require official
   reward `1.0` before comparing time.
5. Preserve failures under a stable case/sample directory and resume without
   discarding or renumbering them.

Run two independently initialized originals and two replays per case. Aggregate
case medians only after both samples pass. Report suite coverage separately as
catalog, original-pass, compiled, replay-correct, and performance-comparable
counts. A missing, unsupported, setup-failed, or incorrect case remains visible
in the denominator; never silently skip it.

The current `SystemBrightnessMax` workflow below is the suite canary. It proves
the harness, not full AndroidWorld coverage.

Use the resumable suite phases from one stable output root:

```bash
npm run benchmark:android:android-world-suite -- --phase plan --selection pass@3 --output <suite-root>
npm run benchmark:android:android-world-suite -- --phase original --selection pass@3 --output <suite-root>
npm run benchmark:android:android-world-suite -- --phase compile --selection pass@3 --output <suite-root>
npm run benchmark:android:android-world-suite -- --phase replay --selection pass@3 --output <suite-root>
npm run benchmark:android:android-world-suite -- --phase evaluate --selection pass@3 --output <suite-root>
```

The compile phase mechanically lowers every complete successful recording,
derives screenshot and native-node checkpoints from its immutable evidence,
and writes `compiled/replay.ts`, `recorded-input.ts`,
`assertion-decision.json`, and `compile-result.json`. Inspect failures and use
the repository's recording compilation skill when a task requires a narrower
repair; never handwave a missing generated script. A sample-local generated
`compiled/replay.ts` is an expected benchmark artifact, not a benchmark-runner
code change. Editing the catalog,
runner, runtime, initializer bridge, validator bridge, or setup patches still
invalidates the measurement and requires a different fresh agent.

The generated Android replay checks screenshots first. When raster state is
not discriminative, it may use only native node facts present in the same
recorded checkpoint, including structured focus state. Recorded tap coordinates
are replaced by live native bounds when the recording identifies the target
node. A matched postcondition is reused as the immediately adjacent next
precondition. These are deterministic compilation rules, not AI fallback.

Before delegating formal suite work, the coordinator must run the resumable
measurement-external setup and require `24 ready / 0 failed / 0 pending`:

```bash
npm run android-world:prepare-suite -- --output .cache/android-world/setup
```

## SystemBrightnessMax workflow

1. Read `benchmark/android/android-world/README.md` and the checked-in runner.
   Do not edit the task goal, parameters, initialization, official validator,
   or timing boundary during a measured run.
2. Run ADB, emulator, UIAutomator2, AndroidWorld gRPC, and local model-proxy
   commands with host/local-loopback permission. In a restricted sandbox,
   request escalation before the first such command. Do not start a second ADB
   daemon or silently wait for an inaccessible localhost service.
3. Verify the coordinator-prepared pinned environment using the read-only,
   offline check:

   ```bash
   npm run android-world:check
   ```

   Never install or update dependencies inside the fresh measured agent. If the
   check fails, stop and return setup to the coordinator. The coordinator runs
   `npm run android-world:bootstrap`, then delegates to a different fresh agent.

4. Start the pinned Pixel 6/API 33 AVD with emulator gRPC. In process-isolated
   environments use the foreground command in an independent terminal:

   ```bash
   npm run android-world:start:foreground
   ```

5. Create the official Settings snapshot once, outside measurement:

   ```bash
   npm run android-world:prepare
   ```

6. Load the ignored `.env` without printing it and verify the Midscene model.
7. Run one independently initialized original and one independently initialized
   replay for a development benchmark:

   ```bash
   npm run benchmark:android:android-world -- --output <output-directory>
   ```

   The CLI invokes AndroidWorld's `SystemBrightnessMax.initialize_task()` before
   each mode and `SystemBrightnessMax.is_successful()` afterward. Setup and
   validation are outside `executionDurationMs`, matching AndroidWorld's agent
   evaluation boundary.
8. Inspect `evaluation.json`, both result files, the original recording, replay
   diagnostics, and final screenshots. Require:
   - original and replay process success;
   - official reward `1.0` for each;
   - a complete original recording;
   - replay checkpoint evidence and fallback diagnostics;
   - separate screenshot capture, native source capture, and settle-delay time;
   - positive durations measured at the same task-execution boundary.
9. Report correctness first. Only when both official rewards pass, report
   original duration, replay duration, speedup, reduction percent, checkpoint
   capture time, settle delay, and fallback count.

For a formal score, run two originals and two replays in independent output
directories and compare medians. Do not discard failures or mix results from a
runner revision made between samples.

## Integrity rules

- Use the pinned upstream commit and API 33 AVD. API 35 fixture results are not
  AndroidWorld results.
- Use only tasks listed PASS in Midscene's published report and preserve the
  report URL in evaluation metadata.
- Let AndroidWorld initialize and validate state. A locally invented A11y or
  screenshot assertion is supporting evidence, not a replacement oracle.
- Setup may use AndroidWorld's ADB utilities. Measured replay actions must go
  through ActOnce's native Android runtime; never set the target state directly
  with `adb settings put`.
- Include deterministic actions, checkpoint capture, settling, and any fallback
  inside replay execution time. Keep dependency setup, AVD boot, fixture
  initialization, official validation, and artifact writing outside it.
- Preserve failed artifacts and diagnose the first divergence. Do not weaken
  the task or validator to produce a pass.
