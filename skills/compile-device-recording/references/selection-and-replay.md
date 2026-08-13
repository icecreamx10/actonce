# Segment selection and replay compilation

## Read the timeline

Use these relationships in order:

1. `traceId`, `spanId`, and `parentSpanId`
2. Domain IDs such as `logicalActionId`, `primitiveId`, `requestId`, and `captureId`
3. Source observation timestamps
4. Global append `sequence`

The shared sequence explains file order, not necessarily physical causality across asynchronous sources.

## Select a segment

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
| macOS AX | `@actonce/macos` accessibility/id/name/predicate/class-chain locator | guarded `mac.driver` Mac2 call |
| macOS input | `@actonce/macos` element or input primitive | guarded coordinate input |
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

Mark non-idempotent segments as `observe-before-retry` or `never-retry`. Never allow
an AI fallback to repeat a `never-retry` postcondition action.

Use bounded polling for asynchronous UI changes. Keep short input-settle delays only when required by the recorded driver behavior.

For macOS fragments and shared-session execution, read [macos-runtime.md](macos-runtime.md).
