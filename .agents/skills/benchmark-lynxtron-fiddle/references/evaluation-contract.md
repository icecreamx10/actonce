# Fixed evaluation contract

## Correctness gate

The replay passes only when every measured run reports all three live observations:

```json
{
  "syntaxErrorVisible": true,
  "tooltipVisible": true,
  "tooltipMessage": "Expression expected."
}
```

The replay must also restore the editor without saving. A process exit code or absence of exceptions is not proof of correctness.

The replay must preserve the original evidence modality. A screenshot-backed Midscene
observation cannot be replaced with AX/DOM lookup unless the selected original range
contains relevant native evidence for the same fact. Require an assertion decision
record and reject results whose implementation contradicts it.

Run five independent replays from the fixture's reset state. One incorrect run fails the correctness dimension. Do not discard failed runs as outliers.

## Conditional performance

Compute performance only if the original run passes and all five replay runs pass correctness with valid positive `executionDurationMs` values.

Use:

- original time: the successful original run's `executionDurationMs`;
- replay time: median of the five replay `executionDurationMs` values;
- speedup: `original time / replay median`;
- reduction percent: `(1 - replay median / original time) * 100`.

Do not impose a hidden speed threshold. Report the measured advantage or regression. If correctness is false, speedup is `null` and performance is not comparable.

Fallback does not disqualify a replay from performance comparison. A correct replay
that invokes AI remains a valid replay measurement. Its scored duration must include
all checkpoint checks, model latency, fallback actions, recovery waits, and
post-fallback verification. Record fallback count and duration as diagnostics, not as
a third score.

Adaptive checkpoint settling is deterministic replay work, not fallback. Include all
polling screenshots and comparisons inside `executionDurationMs`. Record poll count,
actual checkpoint wait duration, and timeout count. A timeout may enter the existing
fallback path; do not hide it as ordinary settling. Prefer the original fixed wait as
the timeout ceiling so optimization lowers typical latency without relaxing the
correctness checkpoint.

## Timing boundary

Start after the fixture is ready and every controller required by the selected replay strategy is connected. Stop after the outcome has been verified and the in-task editor restoration has completed. Apply the same semantic boundary to original and replay even though their controllers differ. Starting a fallback controller lazily after this boundary is scored replay work; preconnecting it before the boundary is allowed only when done consistently for every measured replay.

Preparation, application startup, Appium/WDA startup, model/runtime initialization, artifact serialization, and application teardown remain outside the scored interval. Retain full end-to-end duration separately for operational diagnosis.

Count any online screenshot AI evaluator required to produce live replay observations
inside the scored interval. It is read-only evaluation rather than action fallback;
record its model calls and duration separately in diagnostics without adding a score.

## Minimum result fields

Both modes must provide:

```json
{
  "schemaVersion": 1,
  "benchmark": "diagnostic-hover",
  "mode": "original",
  "runId": "...",
  "status": "passed",
  "executionDurationMs": 1234.5,
  "expected": {},
  "observed": {}
}
```

Use `mode: "replay"` for replay results. Additional provenance and diagnostic fields are allowed.

Every replay result also records:

```json
{
  "replayDiagnostics": {
    "strategy": "hybrid",
    "fallbackCount": 1,
    "fallbackDurationMs": 4321
  }
}
```

Use `strategy: "deterministic"` and zero values when no fallback is enabled or used.
