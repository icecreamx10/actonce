---
name: benchmark-lynxtron-fiddle
description: Run the repository-internal fixed Lynxtron Fiddle original-versus-replay benchmark. Use when evaluating whether a replay compiled from the recorded Midscene macOS diagnostic-hover case reproduces the required UI outcome and, only after correctness passes, measuring its execution-time advantage over the original AI run.
---

# Benchmark Lynxtron Fiddle

Treat correctness as a hard gate and performance as a conditional comparison. Never credit a fast replay that does not reproduce the complete fixed outcome.

## Workflow

1. Read the fixed case at `benchmark/macos/lynxtron-fiddle/cases/diagnostic-hover.json` and [references/evaluation-contract.md](references/evaluation-contract.md). Do not edit the fixture, oracle, prompts, timing boundary, or evaluator during a benchmark run.
2. Run `npm run benchmark:macos:lynxtron:prepare` outside the measurement.
3. Before any original or replay command that controls the desktop, tell the user that the case is about to start, give a rough duration, and ask them not to use the mouse, keyboard, clipboard, apps, windows, or displays until completion. Do not compensate for concurrent user activity by repeatedly stealing focus during the measured case; classify an externally disturbed run as invalid and retry only after notifying the user again.
4. Produce exactly two independent original Midscene runs from reset fixture state through the benchmark CLI. Keep Midscene's default input strategy unchanged. Require both runs to emit `mode: "original"`, `status: "passed"`, and a non-null `executionDurationMs` in `result.json`:

   ```bash
   npm run benchmark:macos:lynxtron:cli -- run \
     --mode original --case diagnostic-hover --output <original-directory>
   ```
5. Select one complete passing original recording as the canonical compilation source. Compile only that recording into checkpoint-gated replay code. Follow the repository's published `compile-device-recording` Skill and preserve each observation's recorded modality. Run `actonce-macos plan-observations` for the selected range, use its `recommendedSettle` to replace checkable fixed waits with bounded polling, produce an assertion decision record, and require `actonce-macos validate-observations` to pass before replay. Reject the compilation if an assertion uses AX, WDA, DOM, or visual evidence that is absent from the selected recording range. The replay may use bounded segment-local AI fallback; fallback is part of the replay implementation, not a correctness failure.
6. Execute the compiled replay immediately and compare its actions, checkpoints, observations, cleanup state, and output with the canonical original event range. If it diverges, diagnose the first mismatch, fix the compiler/runtime/replay rather than weakening the case, and rerun from reset state. Continue until the case is stable or a concrete external blocker is reached. Development attempts remain preserved but are excluded from formal scoring.
7. After validation, run exactly two independent formal replays through `benchmark:macos:lynxtron:cli -- run --mode replay --runner <runner> --source-recording <recording>`. The benchmark CLI revalidates observation provenance before accepting each result. Each run must emit `mode: "replay"`, structured per-step assertions, screenshot paths or an ActOnce recording, fallback diagnostics, checkpoint poll count/wait duration/timeout count, and `executionDurationMs` measured at the same boundary as the originals. Include checkpoint verification and settling, every fallback model call and action, recovery verification, and cleanup in that duration.
8. Run the structured assertion gate and have the CLI select at most three relevant screenshots from each recording:

   ```bash
   npm run benchmark:macos:lynxtron:cli -- evidence \
     --original <original-1-result.json> \
     --original <original-2-result.json> \
     --replay <replay-1-result.json> \
     --replay <replay-2-result.json> \
     --output <review-directory>
   ```

9. Open every screenshot listed by `review-manifest.json`. Compare both originals and both replays visually. Record the AI decision through the CLI; do not edit JSON directly:

   ```bash
   npm run benchmark:macos:lynxtron:cli -- review \
     --manifest <review-directory>/review-manifest.json \
     --decision <passed-or-failed> \
     --reason <specific-visual-evidence> \
     --output <review.json>
   ```

10. Run `benchmark:macos:lynxtron:cli -- evaluate` with both original results, both replay results, and `--review <review.json>`. Report exactly two dimensions:
   - correctness: whether all four measured runs match the fixed oracle and restore the fixture;
   - conditional performance: median original execution time, median replay execution time, and `original median / replay median` speedup.

If either the CLI assertion gate or final AI screenshot review fails, report performance as not comparable. Preserve failure artifacts and diagnose them, but do not alter the case to obtain a pass. AI review time is never part of `executionDurationMs`.

## Integrity rules

- Exclude dependency installation, fixture extraction, app launch, controller startup, and report writing from `executionDurationMs` for both modes.
- Include the task precondition check, input, UI settling required by the implementation, hover, outcome verification, and in-task cleanup in both modes.
- Include checkpoint comparison, fallback planning and model latency, fallback device actions, and post-fallback verification in replay `executionDurationMs`. Never subtract fallback overhead.
- Record replay strategy, fallback count, and fallback duration as diagnostics. Do not use them as an additional score or a reason to suppress an otherwise correct timing comparison.
- Derive replay observations from live UI evidence. Never hard-code the expected object as the observed result.
- Do not alter Midscene's input driver, typing delay, clipboard timing, or other action semantics in the original runner. Original runs measure the pinned Midscene version as shipped.
- Preserve superseded and failed artifacts for diagnosis, but never mix results from an older runner/input strategy into a new formal evaluation.
- Preserve evaluator modality. This case's screenshot-backed Midscene visual observations must be checked visually; saving a screenshot while checking the same claim through an unevidenced AX lookup is invalid. A read-only online visual evaluator is not an action fallback, but its latency belongs inside `executionDurationMs` and its use belongs in diagnostics.
- Require the replay result to reference its assertion decision record. Each decision must include the observation/task identity, recorded modality, evidence sequence/artifacts, selected evaluator, and rejected alternatives. Treat a missing or contradicted decision record as a correctness failure.
- Keep end-to-end duration and logs as diagnostic fields only; they are not benchmark scores.
- Do not add secondary scores such as model calls, token cost, implementation size, or fallback count. They remain diagnostic metadata only.
