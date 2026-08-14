# Segment selection and replay compilation

## Read the timeline

Use these relationships in order:

1. `traceId`, `spanId`, and `parentSpanId`
2. Domain IDs such as `logicalActionId`, `primitiveId`, `requestId`, and `captureId`
3. Source observation timestamps
4. Global append `sequence`

The shared sequence explains file order, not necessarily physical causality across asynchronous sources.

## Select a segment

First prove that the recording contains the requested outcome. A complete manifest
only means the writer finalized the trace. Reject recordings whose task failed,
stopped early, or lacks independent evidence for the oracle/final checkpoint; do not
generate or execute a partial replay and do not invent missing actions.

Include:

- the last checkpoint that establishes required preconditions;
- the logical action and all causally nested primitives;
- synchronization or response events needed to establish completion;
- the first checkpoint or observation that independently proves the result.

Exclude:

- unrelated AI inspection before the precondition is established;
- duplicate execution dump updates;
- report UI activity and recorder shutdown;
- manual repairs performed after the recorder closed;
- assertions supported only by model prose and no recorded evidence.

When two actions share state, either include the setup action or make its resulting state an explicit fixture precondition.

## Replay target mapping

| Recorded source | Preferred replay target | Fallback |
|---|---|---|
| WDA endpoint | WDA/Appium command with accessibility selector | normalized coordinates with device guards |
| macOS AX | `@byted-lynx/actonce-macos` accessibility/id/name/predicate/class-chain locator | guarded `mac.driver` Mac2 call |
| macOS input | `@byted-lynx/actonce-macos` element or input primitive | guarded coordinate input |
| Midscene logical action | test name/comment plus compiled primitives | bounded segment-local AI recovery in explicitly hybrid runs |

Map observations independently from actions:

| Recorded observation evidence | Compiled evaluator |
|---|---|
| `macos-ax` snapshot or available native UI evidence | AX assertion over the evidenced property |
| WDA response/source | WDA/native assertion over the evidenced property |
| Midscene `Assert`/`Boolean`/`Query` with `domIncluded: false` and screenshot `uiContext` | screenshot visual/OCR evaluator; read-only visual AI when deterministic evaluation is insufficient |
| Mixed screenshot plus native evidence | the same necessary combination, with each source identified |
| Missing or unavailable evidence | fail closed and report the gap |

Do not choose an assertion source merely because the replay runtime exposes it. In
particular, never compile a screenshot-only Midscene Query into `mac.source()` or an
AX selector when the recording has no relevant AX evidence.

On macOS, enforce this mapping with the runtime CLI:

```bash
actonce-macos plan-observations <recording> --from <n> --to <n> --output observation-plan.json
actonce-macos validate-observations <recording> --decisions assertion-decision.json
```

The first command derives allowed modalities from the immutable trace. The second
checks observation coverage, evidence citations, registered evaluator identity, and
modality compatibility. Implement and register a new evaluator in the runtime before
using its name; a decision record cannot self-declare its way around validation.

Write an assertion decision record before running generated code:

```json
{
  "observationTaskId": "<task-id>",
  "recordedMode": "visual",
  "evidence": [{ "sequence": 75, "kind": "observation.screenshot" }],
  "compiledEvaluator": "visual-ai",
  "rejectedEvaluators": [
    { "type": "macos-ax", "reason": "no relevant macos-ax evidence" }
  ]
}
```

An online visual model used only to decide an assertion is read-only evaluation, not
action recovery. Record and time it. If evaluation is deferred to benchmark review,
emit pending evidence rather than inventing a live observed value.

Avoid model calls in a deterministic replay benchmark. If AI remains necessary, classify the output as a hybrid replay rather than deterministic replay.

Do not use fallback to compensate for a segment that lacks a meaningful postcondition.
Fallback repairs drift; it does not replace evidence or define correctness.

## Generated script structure

```ts
/**
 * Generated from ActOnce recording: <recording-id>
 * Source sequence range: <from>..<to>
 */

// 1. Connect and assert device/display/viewport preconditions.
// 2. Reset or create the fixture state.
// 3. Execute compiled primitives.
// 4. Wait on an observable condition, not an arbitrary long sleep.
// 5. Assert the independently recorded outcome.
// 6. Restore state in finally.
```

Compile state-changing actions as `flow.segment` units whenever independent pre- and
post-checkpoints exist. A mismatch must fail closed unless the caller explicitly runs
in hybrid recovery mode. In hybrid mode, fallback may repair only the current segment;
the runtime must recapture and match its checkpoint before deterministic replay resumes.

Compile assertions as observation-only `flow.segment` units using the same concrete
checkpoint contract as actions. Put the last independently evidenced state required
to evaluate the assertion in `precondition`, with `settle` derived from
`recommendedSettle` or the recorded synchronization budget. The `deterministic`
function may only invoke the assertion decision record's read-only evaluator; when
the checkpoint driver is that evaluator, use a no-op. Put the independently evidenced
assertion outcome in `postcondition`. This applies to Assert, Boolean, Query, and final
oracle checks. Never invoke the evaluator before the precondition settles, advance
after evaluator dispatch alone, or turn a precondition timeout into an observed false.

```ts
await flow.segment({
  id: "assert-tooltip-message",
  precondition: {
    id: "tooltip-ready",
    expected: tooltipExpectation,
    settle: { timeoutMs: 1_200, intervalMs: 60, consecutiveMatches: 2 },
  },
  deterministic: async () => {
    // No device input. Invoke the decision record's read-only evaluator here
    // only when the checkpoint driver is not already that evaluator.
  },
  postcondition: {
    id: "tooltip-message-verified",
    expected: tooltipExpectation,
  },
  idempotency: "safe",
});
```

Mark non-idempotent segments as `observe-before-retry` or `never-retry`. Never allow
an AI fallback to repeat a `never-retry` postcondition action.

Treat mechanically lowered calls as immutable implementations, not an unconditional
schedule. Before every retry or cleanup call, observe its recorded postcondition. If
the final target already matches, skip remaining calls; never undo, delete, submit,
or close after cleanup is complete. Otherwise execute only the next opaque call,
settle on its checkpoint, and reassess.

Use bounded polling for asynchronous UI changes in both action and assertion
pre/post checkpoints. Keep short input-settle delays only when required by the
recorded driver behavior.

## Correctness loop

- Gate the loop on a written execution-environment assessment. Verify the current machine has the required platform/runtime, matching app or build, equivalent fixture and reset path, target device/display, credentials/services, and repository benchmark harness. Record concrete checks; do not infer availability from recording metadata alone.
- Classify the environment as `available`, `equivalent-but-unproven`, or `unavailable`. Cross-machine compilation is normal: if the recording machine cannot be accessed and the compilation machine cannot prove an equivalent resettable environment, finish offline compilation/static validation and stop with zero live attempts. This is an environment blocker, not a replay failure.
- Never enter an execute/fix retry loop without a fresh-fixture validation environment. Do not loop on launch/connection failures that merely restate the same missing environment, and do not claim correctness, stability, or two-pass validation from offline evidence.
- Build the replay oracle before execution: action order, independently evidenced observations, equivalent checkpoint boundaries, cleanup, and final state. Compare semantic state, not timestamps, event counts, or raw artifact identity.
- Require evidence on both sides of each state change. Event dispatch, protocol success, or an AX notification alone does not prove application state.
- Preserve every failure. Classify the first mismatch as compiler, runtime, selector/coordinate, evaluator, fixture/environment, or fallback; fix the narrowest layer, reset, and rerun the complete case.
- Treat a successful official oracle plus a failed internal checkpoint as evidence of an evaluator/observability mismatch, not permission to ignore the checkpoint. Re-express the same recorded fact through a modality that is both recorded and live-observable.
- Require two consecutive fresh-fixture passes. Do not delete assertions, weaken values/modalities, enlarge recorded timeout bounds, exclude failures, or resume from contaminated state.
- Stop only for unavailable authority, credentials, platform capability, external state, or irrecoverable source evidence. Report the exact boundary, expected/actual evidence, attempted fixes, artifacts, and smallest unblock action.

For visual comparison, use the smallest content-bearing crop. Measure preserved live
attempts against the recorded positive and nearest negative state; choose a threshold
that admits benign raster/focus variation but still rejects the negative. Require
consecutive matches for transient UI. Never widen crop or tolerance merely to pass.

When a repository provides a benchmark, read its case/task, fixture reset, public CLI
or result contract, timing boundary, and evaluator before generating code. Use that
harness for every attempt. Do not copy an existing case-specific replay; derive the
implementation from the recording and public runtime support.

## Output contract

Return generated replay and decision files; range/exclusions; fixture requirements;
deterministic/hybrid mode and bounded fallback; oracle; execution-environment
assessment and validation level; and complete attempt history (including zero live
attempts) with diagnoses, fixes, consecutive pass count, fallback diagnostics,
residual risks, or exact blocker evidence and the smallest unblock action.

For platform fragments and shared-session execution, read [macos-runtime.md](macos-runtime.md)
or [ios-runtime.md](ios-runtime.md), or [android-runtime.md](android-runtime.md).
