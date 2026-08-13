---
name: compile-device-recording
description: Inspect an ActOnce recording, correlate Midscene semantics with device, AX, WDA, screenshots, and checkpoints, compile checkpoint-gated deterministic or hybrid replay code, and execute/fix it until fresh-fixture results stably match the recorded outcome or a concrete blocker is proven. Use when reviewing `manifest.json` plus `events.ndjson`, explaining a recorded run, extracting useful sequence ranges, converting a successful AI demonstration into tested repeatable scripts, or adding bounded AI recovery to compiled replay.
---

# Compile Device Recording

Treat the recording as immutable evidence. Produce derived summaries, segments, and replay code without rewriting the source trace.

## Availability and environment

- Offline verification, summarization, and segment extraction are self-contained and use only Node.js 20.19+, 22.12+, or 24+ plus a completed ActOnce recording.
- Replay execution requires the matching platform package included by `@byted-lynx/actonce`: `@byted-lynx/actonce-macos`, `@byted-lynx/actonce-ios`, or `@byted-lynx/actonce-android`.
- macOS requires the permissions reported by `actonce-macos doctor`; iOS requires an explicitly selected device and reachable WebDriverAgent; Android requires one connected ADB device reported by `actonce-android doctor`.
- Deterministic replay needs no model credential. Hybrid recovery or an online screenshot evaluator additionally requires the configured Midscene/model provider credentials.
- If only offline requirements are available, complete inspection and extraction, then report live replay as blocked with the exact missing platform prerequisite.

## Availability and environment

- Offline inspection is self-contained in this skill package. The bundled summarizer and segment extractor use only Node.js built-ins and need Node.js 20.19+, 22.12+, or 24+, plus a completed ActOnce recording containing `manifest.json` and `events.ndjson`.
- Replay compilation and execution are not self-contained in this skill package. They require the matching ActOnce platform runtime and CLI: `actonce-macos`, `actonce-ios`, or `actonce-android`. Until those packages are available in the target registry, use a built ActOnce checkout. Do not substitute handwritten driver calls when the runtime is absent.
- macOS execution requires macOS 11.3+, Xcode 13+, a compatible Node.js/npm toolchain, Appium Mac2 dependencies, and the Accessibility permissions diagnosed by `actonce-macos doctor`.
- iOS execution requires an explicitly selected Simulator or device and a reachable WebDriverAgent. The runtime does not start or select the device implicitly.
- Android execution requires an explicitly selected ADB device. The runtime does not boot or choose an emulator inside generated fragments.
- Deterministic replay needs no model credential. Hybrid action recovery or an online screenshot evaluator additionally needs the configured Midscene/model provider and its credentials; never copy those credentials into generated code or artifacts.
- If only the offline requirements are present, complete inspection, summarization, range selection, and segment extraction, then report runtime execution as blocked with the exact missing platform prerequisite.

## Workflow

1. Verify that the recording contains `manifest.json` and `events.ndjson` and is not actively being written.
2. Resolve this skill's installation directory from the loaded `SKILL.md`, then run its bundled summarizer by absolute path:

   ```bash
   node /absolute/path/to/compile-device-recording/scripts/summarize-recording.mjs <recording-dir>
   ```

3. Read [references/selection-and-replay.md](references/selection-and-replay.md). Identify the smallest contiguous sequence range that contains the intended action, required setup, observable outcome, and recovery evidence.
4. Inspect checkpoint screenshots and native UI artifacts at the boundaries. Do not select a segment based only on the AI's textual conclusion.
5. Extract the immutable source slice:

   ```bash
   node /absolute/path/to/compile-device-recording/scripts/extract-segment.mjs \
     <recording-dir> --from <sequence> --to <sequence> --output <segment.json>
   ```

6. Build the observation evidence ledger mechanically before writing replay code. For macOS, run `actonce-macos plan-observations <recording> --from <sequence> --to <sequence> --output <plan.json>`. Treat its allowed modalities and rejected modalities as compiler constraints, not suggestions. On iOS or Android, cite the relevant `checkpoint.captured` screenshot and native UI artifact plus the normalized Midscene observation. Choose a replay target that reaches the same execution boundary as the recorded primitives. Prefer stable selectors or protocol commands; use coordinates only with explicit viewport/display/scale/orientation guards.
7. Divide state-changing work into segments. Compile the last independently evidenced pre-action checkpoint, deterministic action, and first independently evidenced post-action checkpoint into one guarded unit. Replace recorded fixed waits before observations with bounded checkpoint settling when `plan-observations` emits `recommendedSettle`: verify immediately, poll at its interval, advance on a match, and enter the existing fallback only after its timeout. Do not treat successful event dispatch as proof that the application consumed an action.
8. Select the execution mode:
   - Use deterministic mode by default when no recovery policy is requested. A checkpoint mismatch fails closed and no model call is allowed.
   - Use hybrid mode only when the user requests recovery or the target product explicitly permits it. Give fallback only the current segment goal, evidence differences, action/time limits, application scope, and forbidden actions. Require the same checkpoint to match after recovery before resuming deterministic replay.
9. Assign each segment `safe`, `observe-before-retry`, or `never-retry` idempotency. Never allow postcondition action recovery for `never-retry` work.
10. Select the platform runtime and read its reference: [references/macos-runtime.md](references/macos-runtime.md), [references/ios-runtime.md](references/ios-runtime.md), or [references/android-runtime.md](references/android-runtime.md). First mechanically lower completed recorded actions with the platform's `compile-primitives` command; do not ask a model to translate their implementation. Compose those fixed calls into one or more platform replay fragments using the shared `flow`. Let the platform runner own the session and cleanup; do not start or close those resources inside a fragment.
11. Generate readable fragments containing setup, guarded segments, synchronization, assertions, cleanup, and provenance metadata. Write an assertion decision record beside the fragments that maps each compiled assertion to its recorded evidence, selected evaluator, rejected evaluators, and rejection reasons. For macOS, require `actonce-macos validate-observations <recording> --decisions <decision.json>` to pass before running the replay. Split independently reusable fixed flows when that improves reuse or benchmark attribution.
12. Build a replay oracle from the selected source range before execution. List the required action order, independently evidenced observation values, equivalent checkpoint boundaries, and cleanup/final state. Compare semantic state at those boundaries; do not require identical event counts, timestamps, screenshots, or incidental UI.
13. Execute all fragments together against a reset fixture and capture fresh checkpoint/assertion evidence. A successful process exit is insufficient: require every oracle observation and the cleanup/final-state checkpoint to match through its recorded evidence modality.
14. If execution or comparison fails, preserve the failed artifacts, classify the cause as compiler, runtime, selector/coordinate, evaluator, fixture/environment, or fallback, and fix the narrowest responsible layer. Reset the fixture and rerun the complete case after every fix; do not resume after the failed step using contaminated state.
15. Continue the execute → compare → diagnose → fix → reset loop until the case is stable or concretely blocked. Stable means at least two consecutive complete fresh-fixture runs match every required oracle observation and final state. Do not obtain stability by deleting assertions, weakening expected values/evidence modality, enlarging timeouts without recorded evidence, or excluding failed attempts. Classify any run that invokes AI as hybrid even if recovery succeeds.
16. Stop as blocked only when further progress requires unavailable authority, credentials, platform capability, external service/state, or a missing source artifact that cannot be reconstructed safely. Report the exact failed boundary, expected versus actual evidence, attempted fixes and rerun results, preserved artifact paths, and the smallest action needed to unblock. For benchmarks, include fallback latency and actions inside the measured replay interval; do not disqualify a correct hybrid run from speed comparison.

## Compilation rules

- Replace AI Locate with a stable native selector when the recording provides one. Otherwise preserve normalized coordinates with display, viewport, scale, and orientation preconditions.
- Compile primitive operations, not model reasoning. Preserve the semantic prompt as a comment or test name.
- Generated code must call the matching fixed primitive helper or reuse compiler output: `replayMacPrimitive`, `replayIOSPrimitive`, or `replayAndroidPrimitive`. For mobile, compile normalized logical device coordinates emitted by the completed action, never raw screenshot pixels. Never inline driver input implementations. Unknown, failed, or incomplete primitives fail closed and require an explicit compiler/runtime change.
- Compile `Assert`, `Boolean`, and `Query` results into explicit assertions only when independent checkpoint evidence supports them.
- Preserve observation modality. A Midscene observation with `domIncluded: false` and a screenshot-backed `uiContext` compiles to a visual evaluator, never to AX/DOM text lookup. Prefer bounded deterministic visual checks or OCR when they can establish the complete result; otherwise use a read-only screenshot AI evaluator. Do not classify a read-only evaluator as an action fallback, but include an online evaluator's model latency in replay execution time and disclose it in diagnostics.
- Permit AX assertions only when the selected range contains relevant `macos-ax`/native-UI evidence. Permit WDA assertions only when relevant WDA evidence exists. The mere availability of a replay API is not evidence that the original observation used or exposed that modality.
- Fail closed if no faithful evaluator is available. Never fabricate an observed value from the expectation, and never convert a saved screenshot into an unused artifact while asserting the same fact through an unrecorded source.
- Compare necessary state, not raw artifact identity. Derive resilient expectations from application/window identity, required and forbidden UI nodes, relevant properties or text, guarded viewport metadata, and narrowly scoped visual evidence.
- Do not reproduce fixed sleeps when the trace contains a checkable next-step checkpoint. Use the recorded wait duration as a timeout budget, not a mandatory delay. For visual state, compare frequent low-cost screenshots over the smallest relevant region and require consecutive matches when animation or transient frames are possible. Record checkpoint poll count, actual wait duration, timeout count, and any subsequent fallback.
- Treat compiled code as unfinished until the execution loop reaches stability or a blocker report is produced. Keep every failed attempt in the verification history; never report only the final passing run.
- Preserve checkpoint evidence on both sides of every selected state-changing segment. If either boundary lacks independent evidence, state the gap rather than inventing a guard.
- Keep fallback metadata local and bounded. Never fall back by handing the remaining task to AI, never let fallback declare its own checkpoint successful, and never hide fallback use from results.
- Preserve ordering by span/trace relationships first, source observation time second, and global sequence last.
- Do not interpret an AX notification as proof that a tap was consumed. Mark such relationships as inferred unless directly evidenced.
- Exclude incidental focus changes, report viewing, recorder cleanup, and manual repair actions unless the target test requires them.
- Never copy credentials, authorization headers, clipboard contents, or model reasoning into generated scripts.
- Add the recording ID and selected sequence range to the generated file header.
- Keep platform APIs separate. Target the matching macOS, iOS, or Android package; do not invent a cross-platform abstraction while compiling a platform-specific recording.

## Output contract

Return:

1. A short explanation of the selected range and exclusions.
2. The generated replay script in the user's requested location.
3. Any fixture/reset requirements.
4. The selected runtime mode and fallback policy. For hybrid output, include the fallback module/injection requirement and idempotency decisions.
5. The replay oracle plus the complete verification history: run outcome, failed boundary, diagnosis/fix, fresh-fixture rerun result, consecutive stable-pass count, fallback count if exercised, and residual risks. If blocked, include the blocker evidence and smallest unblock action.
6. The assertion decision record. For every assertion include `recordedMode`, evidence event/artifact references, `compiledEvaluator`, and rejected alternatives with reasons.

For source semantics and target mappings, read [references/selection-and-replay.md](references/selection-and-replay.md). For a concise Chinese workflow, read [references/guide.zh-CN.md](references/guide.zh-CN.md).
