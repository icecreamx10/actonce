# Evidence selection and replay authorship

## Read the timeline

Use `traceId`/span relations first, then domain IDs such as `logicalActionId`, then
source timestamps, and finally global append `sequence`. Sequence is file order, not
proof of asynchronous causality.

## Prove the source demonstration

A complete manifest only proves that the writer finalized the trace. Reject a range
that stopped early, failed its requested task, or lacks independently recorded result
evidence. Include the last evidenced precondition, each causal logical action and its
nested implementation events, completion signals, final oracle, cleanup, and relevant
recorded recovery evidence. Exclude unrelated AI exploration, duplicate dumps, report
UI, recorder shutdown, and repairs performed after recording closed.

The agent must inspect the cited screenshots/native artifacts before deciding. Do not
derive inclusion or exclusion from event names alone.

## Author state transitions before actions

Treat every completed top-level state-changing logical action as a candidate transition:

`recorded before-state -> one logical action -> recorded after-state`

Author one action segment for each replayed transition. Nested implementation events
belong to their parent action and are not separate segments. Separate top-level actions
must never be merged merely because a lowering tool can emit them in one function.

If either side lacks independent evidence, stop and report the exact recording gap.
Task-start and task-end checks do not substitute for intermediate action boundaries.

## Map actions and observations independently

| Recorded action source | Runtime lowering |
|---|---|
| WDA/iOS logical action | WDA-backed runtime primitive using normalized device points |
| Android logical action | Android runtime primitive using normalized device points |
| macOS AX/input action | macOS runtime primitive; evidence-backed selector optimization is agent-authored |
| Unknown/failed/incomplete action | Fail closed |

| Recorded observation | Allowed evaluator |
|---|---|
| Relevant native/WDA/AX artifact | Assertion over only the evidenced native fact |
| Screenshot-only Midscene Assert/Boolean/Query | Screenshot evaluator; read-only visual AI only when deterministic evaluation is insufficient |
| Mixed evidence | The necessary recorded combination, with each source cited |
| Missing evidence | Fail closed |

Runtime capability is not evidence. Never turn screenshot-only evidence into an AX,
WDA, UIAutomator, DOM, or OCR assertion merely because the runtime exposes it.

## Checkpoint and retry contract

Each action segment must have a precondition and postcondition citing its own recorded
before/after checkpoint. An event dispatch or successful protocol response is not proof
that the UI consumed an action. Use bounded polling within the recorded timing budget.

Classify idempotency as:

- `safe`: repetition cannot duplicate or corrupt the outcome;
- `observe-before-retry`: inspect the recorded postcondition before one bounded retry;
- `never-retry`: observe only; never dispatch the action again.

Assertions are observation-only segments with the same pre/post evidence contract.
Model calls are not allowed in deterministic benchmark execution. Preserve a failed
checkpoint for the separate `hybrid-replay` workflow.

On the first fresh-fixture attempt execute every selected forward action exactly once
in recorded order. Never use a later or final checkpoint as lookahead to skip setup or
intermediate actions. Only retry an already-attempted action against its own immediate
postcondition; skip cleanup only when that cleanup action's own postcondition matches.

## Validation loop

Write the oracle before execution. Verify runtime, app/build, fixture reset, target
device/display, credentials/services, and public benchmark harness. Classify the
environment as `available`, `equivalent-but-unproven`, or `unavailable`; only
`available` may execute.

Reset before every attempt. Preserve every result and classify the first mismatch as
synthesis, runtime, selector/coordinate, evaluator, or fixture/environment. Fix the
narrowest layer and require two consecutive fresh-fixture passes. Never weaken the
oracle, values, modality, or recorded timeout to obtain a pass.

If the independent official oracle passes while an internal checkpoint fails, treat it
as an evaluator/observability mismatch rather than ignoring the checkpoint. Re-express
only the same recorded fact through a modality supported by both recording and live
evidence. When a shared runtime/evaluator defect is proven, fix the reusable layer,
discard the derived attempt, and forward-test from immutable evidence in a context-free
agent.

For visual comparison use the smallest content-bearing crop and prove that its
threshold accepts the recorded positive while rejecting the nearest negative state.

## Output contract

Return `synthesis-ledger.json`, `replay-plan.json`, `replay-oracle.json`,
`assertion-decision.json`, `execution-environment.json`, lowered single-action files,
and complete attempt history. Report range/exclusions, evidence gaps, validation level,
residual risk, and the smallest unblock action.
