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
4. Produce one successful original Midscene run through the benchmark CLI. Require `mode: "original"`, `status: "passed"`, and a non-null `executionDurationMs` in `result.json`:

   ```bash
   npm run benchmark:macos:lynxtron:cli -- run \
     --mode original --case diagnostic-hover --output <original-directory>
   ```
5. Compile only that run's ActOnce recording into checkpoint-gated replay code. Follow the repository's published `compile-device-recording` Skill and preserve each observation's recorded modality. Run `actonce-macos plan-observations` for the selected range, use its `recommendedSettle` to replace checkable fixed waits with bounded polling, produce an assertion decision record, and require `actonce-macos validate-observations` to pass before replay. Reject the compilation if an assertion uses AX, WDA, DOM, or visual evidence that is absent from the selected recording range. The replay may use bounded segment-local AI fallback; fallback is part of the replay implementation, not a correctness failure.
6. Run the complete replay five times through `benchmark:macos:lynxtron:cli -- run --mode replay --runner <runner> --source-recording <recording>`. The benchmark CLI revalidates observation provenance before accepting each result. The replay runner is platform-specific benchmark glue, not a Skill. Each run must emit `mode: "replay"`, structured per-step assertions, screenshot paths or an ActOnce recording, fallback diagnostics, checkpoint poll count/wait duration/timeout count, and `executionDurationMs` measured at the same boundary as the original. Include checkpoint verification and settling, every fallback model call and action, recovery verification, and cleanup in that duration.
7. Run the structured assertion gate and have the CLI select at most three relevant screenshots from each recording:

   ```bash
   npm run benchmark:macos:lynxtron:cli -- evidence \
     --original <original-result.json> \
     --replay <replay-1-result.json> \
     --replay <replay-2-result.json> \
     --replay <replay-3-result.json> \
     --replay <replay-4-result.json> \
     --replay <replay-5-result.json> \
     --output <review-directory>
   ```

8. Open every screenshot listed by `review-manifest.json`. Compare the original and replay evidence visually. Record the AI decision through the CLI; do not edit JSON directly:

   ```bash
   npm run benchmark:macos:lynxtron:cli -- review \
     --manifest <review-directory>/review-manifest.json \
     --decision <passed-or-failed> \
     --reason <specific-visual-evidence> \
     --output <review.json>
   ```

9. Run `benchmark:macos:lynxtron:cli -- evaluate` with the original result, all replay results, and `--review <review.json>`. Report exactly two dimensions:
   - correctness: whether all five replay observations exactly match the fixed oracle;
   - conditional performance: original execution time, median correct replay execution time, and `original / replay` speedup.

If either the CLI assertion gate or final AI screenshot review fails, report performance as not comparable. Preserve failure artifacts and diagnose them, but do not alter the case to obtain a pass. AI review time is never part of `executionDurationMs`.

## Integrity rules

- Exclude dependency installation, fixture extraction, app launch, controller startup, and report writing from `executionDurationMs` for both modes.
- Include the task precondition check, input, UI settling required by the implementation, hover, outcome verification, and in-task cleanup in both modes.
- Include checkpoint comparison, fallback planning and model latency, fallback device actions, and post-fallback verification in replay `executionDurationMs`. Never subtract fallback overhead.
- Record replay strategy, fallback count, and fallback duration as diagnostics. Do not use them as an additional score or a reason to suppress an otherwise correct timing comparison.
- Derive replay observations from live UI evidence. Never hard-code the expected object as the observed result.
- Preserve evaluator modality. This case's screenshot-backed Midscene visual observations must be checked visually; saving a screenshot while checking the same claim through an unevidenced AX lookup is invalid. A read-only online visual evaluator is not an action fallback, but its latency belongs inside `executionDurationMs` and its use belongs in diagnostics.
- Require the replay result to reference its assertion decision record. Each decision must include the observation/task identity, recorded modality, evidence sequence/artifacts, selected evaluator, and rejected alternatives. Treat a missing or contradicted decision record as a correctness failure.
- Keep end-to-end duration and logs as diagnostic fields only; they are not benchmark scores.
- Do not add secondary scores such as model calls, token cost, implementation size, or fallback count. They remain diagnostic metadata only.
