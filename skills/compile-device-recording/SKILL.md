---
name: compile-device-recording
description: Inspect an ActOnce recording, correlate Midscene semantics with device, AX, WDA, screenshots, and checkpoints, and compile a checkpoint-gated deterministic `plan.json`. Use when reviewing `manifest.json` plus `events.ndjson`, explaining a recorded run, extracting useful sequence ranges, or converting a successful AI demonstration into a repeatable replay plan. Use `hybrid-replay` separately when an agent must recover a failed checkpoint.
---

# Compile Device Recording

Treat the recording as immutable evidence. Produce a deterministic `plan.json`
without rewriting the source trace.

## Availability and environment

- Offline inspection needs Node.js 20.19+, 22.12+, or 24+ and a completed recording containing `manifest.json` and `events.ndjson`.
- Execution needs the matching runtime included by `@byted-lynx/actonce`: `actonce-macos`, `actonce-ios`, or `actonce-android`. Run its `doctor` command first. Select and start the platform/device outside generated fragments.
- Deterministic replay needs no model credential.
- Recording and compilation may happen on different machines. Treat the recording machine as unavailable unless current access is proven; a complete recording does not prove that its app, fixture, device, display geometry, credentials, reset path, or benchmark harness exists on the compilation machine.
- Before promising or starting live validation, write an execution-environment assessment covering the current host/platform, runtime and `doctor` result, app/build identity, fixture/reset mechanism, target device or display, required credentials/services, and benchmark harness. Classify it as `available`, `equivalent-but-unproven`, or `unavailable`, with evidence and the smallest unblock action.
- Only `available` may enter the execute/fix/reset loop. `equivalent-but-unproven` and `unavailable` must stop after offline compilation and static validation; do not repeatedly attempt execution, reconstruct an inaccessible recording machine by guesswork, or claim replay correctness/stability. Never replace a missing runtime with handwritten driver calls.

## Workflow

1. Confirm that the recording is complete and immutable. Resolve this skill's directory from the loaded `SKILL.md`, then summarize it:

   ```bash
   node /absolute/path/to/compile-device-recording/scripts/summarize-recording.mjs <recording-dir>
   ```

2. Read [references/selection-and-replay.md](references/selection-and-replay.md) completely. Prove that the requested oracle and final checkpoint exist before generating code: `manifest.status: complete` means the trace was finalized, not that its task succeeded. Then select the smallest contiguous range containing setup, action, independently evidenced result, cleanup, and relevant recovery evidence. Inspect screenshots and native artifacts; model prose alone is not evidence.
3. Extract the source slice:

   ```bash
   node /absolute/path/to/compile-device-recording/scripts/extract-segment.mjs \
     <recording-dir> --from <sequence> --to <sequence> --output <segment.json>
   ```

4. Build the evidence ledger before code. On macOS run `plan-observations` and treat allowed/rejected modalities and `recommendedSettle` as constraints. On mobile cite relevant screenshots, native UI artifacts, and normalized observations; intercepted protocol traffic alone is not an oracle.
5. Read the selected platform reference completely: [references/macos-runtime.md](references/macos-runtime.md), [references/ios-runtime.md](references/ios-runtime.md), or [references/android-runtime.md](references/android-runtime.md). Run `compile-primitives` first and compose the opaque actions into ordered plan segments. Give every state change independently evidenced pre/post checkpoints and `safe`, `observe-before-retry`, or `never-retry` idempotency. The checkpoints and segment order are immutable; only the segment action is the replaceable *how*.
6. Produce deterministic fail-closed replay. A failed checkpoint stops execution and returns `failedCheckpoint`; do not embed AI fallback in the plan.
7. Before execution, write the replay oracle and assertion decision record. Preserve each recorded observation modality. On macOS require `validate-observations` to pass. Replace checkable waits with bounded checkpoint settling on the applicable `precondition` or `postcondition`; use the recorded wait as the timeout ceiling. Never execute an action or assertion evaluator until its precondition checkpoint has settled, and never accept it until its postcondition checkpoint matches. Event dispatch or evaluator invocation is not proof of state.
8. Produce the execution-environment assessment. If and only if it is `available`, run through the repository's fixture reset and benchmark harness when supplied. Require every oracle observation and cleanup/final state, not merely exit code. Preserve failures; fix the narrowest layer, reset, and rerun the complete case until two consecutive fresh-fixture passes or a concrete external blocker. Never weaken evidence, expected values, or recorded timeout bounds to pass. If the assessment is not `available`, do not start this loop.
9. Return generated files, range/exclusions, fixture requirements, oracle, assertion decisions, execution-environment assessment, complete attempt history (including zero live attempts), validation level (`offline-only` or `live-validated`), residual risks, and any exact blocker/unblock action. If execution fails at a checkpoint, preserve the result for the separate `hybrid-replay` skill.

## Non-negotiable integrity

- Preserve the recording and observation modality; never fabricate evidence or substitute AX/WDA/DOM/native UI for screenshot-only observations.
- Compile completed actions through the platform runtime, not model reasoning or handwritten driver input.
- Keep credentials, authorization data, clipboard contents, and model reasoning out of generated artifacts.
- Include recording ID and sequence range in generated files. Keep platform APIs separate.

Read [references/guide.zh-CN.md](references/guide.zh-CN.md) only when a concise Chinese workflow is useful.
