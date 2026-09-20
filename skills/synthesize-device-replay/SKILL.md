---
name: synthesize-device-replay
description: Agent-author an evidence-backed, checkpoint-gated deterministic replay from an immutable ActOnce recording, then validate it on a fresh fixture. Use when inspecting manifest.json plus events.ndjson, selecting a successful demonstration span, diagnosing recorded actions and observations, or turning a successful macOS, iOS, Android, or Windows computer-use run into a reusable replay. This is a semantic synthesis task; deterministic tools may extract, validate, and lower already-authored actions but must never choose segments, checkpoints, assertions, or exclusions.
---

# Synthesize Device Replay

Use agent judgment to author the replay's state-transition graph from immutable
recorded evidence. The finished replay is deterministic code; its structure is not
the output of a mechanical compiler.

## Separation of responsibility

The agent must decide:

- the successful source range and exclusions;
- one semantic segment for every replayed top-level state-changing action;
- the recorded precondition and postcondition evidence for every segment;
- checkpoint facts, evaluator modality, idempotency, oracle, and cleanup;
- the narrowest repair after a preserved validation failure.

Scripts may only summarize, extract an agent-selected range, validate the authored
ledger/plan, and lower one already-authored recorded action into a runtime primitive.
Never use a script, existing replay, or task-specific generator to select or merge
actions, invent checkpoints, infer assertions, or write the semantic plan.

## Hard gates

1. Resolve this Skill directory. Inspect attempt boundaries before reading or selecting
   actions, then summarize the completed recording:

   ```bash
   node <skill-dir>/scripts/inspect-attempts.mjs <recording-dir>
   ```

   A recording file may contain multiple attempts even when its manifest is complete.
   If more than one attempt exists, the agent must prove which attempt reached the
   requested oracle. Do not select by recency or action similarity alone. If no single
   successful attempt can be proven, stop with an attempt-isolation blocker.
   After selecting it, summarize only that attempt:

   ```bash
   node <skill-dir>/scripts/summarize-recording.mjs \
     <recording-dir> --attempt <attempt-key>
   ```

2. Read [references/selection-and-replay.md](references/selection-and-replay.md)
   completely. Prove the requested outcome and final oracle from screenshots,
   native artifacts, and normalized observations. Model prose is not evidence.
3. Select the smallest successful contiguous range inside the proven attempt.
   Extracting that range is allowed only after the agent records its attempt and range
   reasons:

   ```bash
   node <skill-dir>/scripts/extract-segment.mjs \
     <recording-dir> --attempt <attempt-key> \
     --from <sequence> --to <sequence> --output <selected-range.json>
   ```

   Never run a sequence-only extraction across multiple attempts. The extractor must
   fail closed when an attempt is ambiguous or contains duplicate sequences.

4. Read [references/synthesis-contract.md](references/synthesis-contract.md) and the
   selected platform reference completely. Inspect every top-level completed logical
   action in the range. Author `synthesis-ledger.json` by hand from the evidence.
5. Run the pre-lowering gate:

   ```bash
   node <skill-dir>/scripts/validate-synthesis.mjs \
     <recording-dir> --ledger synthesis-ledger.json
   ```

   Do not lower actions or write executable replay code unless this passes.
6. For each ledger action segment, extract only that action and its cited before/after
   evidence. Invoke the platform's `compile-primitives` compatibility command on that
   single-action slice. Treat its output as opaque action lowering. Never pass the
   full recording, the full selected range, or a multi-action slice to it.
7. Agent-author `replay-plan.json` by placing each lowered action into the ledger's
   already-fixed segment. Preserve the checkpoint IDs, facts, modalities, evidence,
   order, and idempotency. Mechanical output may fill only `action.operation` and
   `action.arguments`.
8. Run the executable-plan gate:

   ```bash
   node <skill-dir>/scripts/validate-synthesis.mjs \
     <recording-dir> --ledger synthesis-ledger.json --plan replay-plan.json
   ```

   Execution is forbidden until this passes. A task-wide action function, one segment
   containing multiple top-level actions, or a plan with only task-start/task-end
   checkpoints is invalid even if it happens to pass once.
9. Before live execution, write `replay-oracle.json`, `assertion-decision.json`, and
   `execution-environment.json`. Only an environment classified `available` may run.
10. Execute through the repository's fixture reset and public benchmark harness. A
    failed checkpoint stops deterministically. Preserve each attempt, diagnose its
    first divergence, fix the narrowest layer without weakening evidence, reset, and
    rerun the complete case until two consecutive fresh-fixture passes or a concrete
    external blocker.
11. On the first fresh-fixture attempt, execute every selected action exactly once in
    recorded order. Never use a future checkpoint to skip earlier work. A retry may
    inspect only that same action's immediate postcondition; cleanup may inspect only
    its own recorded cleanup postcondition.
12. If diagnosis proves a shared runtime or evaluator defect, repair and commit that
    reusable layer first. Discard the derived synthesis attempt, then forward-test this
    Skill with a context-free agent that receives only the immutable recording and
    public harness—not the prior diagnosis or generated artifacts.

## Integrity rules

- Require a distinct evidenced before/after checkpoint pair for every replayed
  top-level state-changing action. Missing evidence is a synthesis blocker, not
  permission to group actions under task-level checkpoints.
- Preserve the recorded observation modality. Screenshot-only evidence stays visual;
  native evidence may support only the facts it actually contains.
- Preserve action order and normalized semantics. Do not add unrecorded recovery
  actions, copy an existing case replay, or use handwritten ADB/WDA/AX driver calls.
- Replace checkable waits with bounded settling no longer than the recorded budget.
- Mark every action `safe`, `observe-before-retry`, or `never-retry`. Never repeat a
  `never-retry` action.
- Keep model credentials, clipboard contents, authorization data, and model reasoning
  out of generated artifacts.
- Keep deterministic replay model-free and fail closed. Use `hybrid-replay` separately
  only after preserving `failedCheckpoint`.

## Required return

Return the immutable recording identity and range; exclusions; synthesis ledger;
validated replay plan; evidence and assertion decisions; fixture requirements;
execution-environment assessment; complete attempt history; validation level
(`offline-only` or `live-validated`); residual risks; and exact blockers.

Read [references/guide.zh-CN.md](references/guide.zh-CN.md) only when a concise Chinese
workflow is useful.
