---
name: compile-device-recording
description: Inspect an ActOnce recording, correlate Midscene semantics with device, AX, WDA, screenshots, and checkpoints, compile checkpoint-gated deterministic or hybrid replay code, and execute/fix it until fresh-fixture results stably match the recorded outcome or a concrete blocker is proven. Use when reviewing `manifest.json` plus `events.ndjson`, explaining a recorded run, extracting useful sequence ranges, converting a successful AI demonstration into tested repeatable scripts, or adding bounded AI recovery to compiled replay.
---

# Compile Device Recording

Treat the recording as immutable evidence. Produce derived summaries, segments, and replay code without rewriting the source trace.

## Availability and environment

- Offline inspection needs Node.js 20.19+, 22.12+, or 24+ and a completed recording containing `manifest.json` and `events.ndjson`.
- Execution needs the matching runtime included by `@byted-lynx/actonce`: `actonce-macos`, `actonce-ios`, or `actonce-android`. Run its `doctor` command first. Select and start the platform/device outside generated fragments.
- Deterministic replay needs no model credential. Hybrid recovery or online visual evaluation needs configured provider credentials.
- If live prerequisites are absent, finish offline inspection and extraction, then report the exact blocker. Never replace a missing runtime with handwritten driver calls.

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
5. Read the selected platform reference completely: [references/macos-runtime.md](references/macos-runtime.md), [references/ios-runtime.md](references/ios-runtime.md), or [references/android-runtime.md](references/android-runtime.md). Run `compile-primitives` first and compose its opaque calls into shared-session `flow.segment` fragments. Give every state change independently evidenced pre/post checkpoints and `safe`, `observe-before-retry`, or `never-retry` idempotency.
6. Default to deterministic fail-closed execution. Use hybrid recovery only when requested or explicitly allowed; bound it to the current segment and require the same checkpoint after recovery. Never let fallback define correctness or repeat `never-retry` work.
7. Before execution, write the replay oracle and assertion decision record. Preserve each recorded observation modality. On macOS require `validate-observations` to pass. Replace checkable waits with bounded checkpoint settling; event dispatch is not proof of state.
8. Run through the repository's fixture reset and benchmark harness when supplied. Require every oracle observation and cleanup/final state, not merely exit code. Preserve failures; fix the narrowest layer, reset, and rerun the complete case until two consecutive fresh-fixture passes or a concrete external blocker. Never weaken evidence, expected values, or recorded timeout bounds to pass.
9. Return generated files, range/exclusions, fixture requirements, mode/fallback policy, oracle, assertion decisions, complete attempt history, residual risks, and any exact blocker/unblock action. Include online evaluator and fallback time/actions in benchmark duration.

## Non-negotiable integrity

- Preserve the recording and observation modality; never fabricate evidence or substitute AX/WDA/DOM/native UI for screenshot-only observations.
- Compile completed actions through the platform runtime, not model reasoning or handwritten driver input.
- Keep credentials, authorization data, clipboard contents, and model reasoning out of generated artifacts.
- Include recording ID and sequence range in generated files. Keep platform APIs separate.

Read [references/guide.zh-CN.md](references/guide.zh-CN.md) only when a concise Chinese workflow is useful.
