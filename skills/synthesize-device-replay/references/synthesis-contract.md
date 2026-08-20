# Replay synthesis contract

Author `synthesis-ledger.json` before running any primitive-lowering command. This file
is the auditable record of agent decisions; no deterministic script may generate it.

```json
{
  "schemaVersion": 1,
  "kind": "actonce.replay-synthesis-ledger",
  "recordingId": "recording-id",
  "selectedSequenceRange": { "from": 15, "to": 39 },
  "segments": [
    {
      "id": "open-stopwatch",
      "kind": "action",
      "actionId": "recorded-logical-action-id",
      "recordedOperation": "Tap",
      "loweredOperation": "tap",
      "precondition": {
        "checkpointId": "clock-ready",
        "evidence": [{ "sequence": 15, "modality": "native" }],
        "facts": ["Clock is foreground", "Stopwatch tab is uniquely available"]
      },
      "postcondition": {
        "checkpointId": "stopwatch-ready",
        "evidence": [{ "sequence": 17, "modality": "native" }],
        "facts": ["Stopwatch is selected", "Start control is visible"]
      },
      "idempotency": "safe",
      "rationale": "One recorded top-level state transition"
    }
  ],
  "exclusions": []
}
```

Every completed top-level logical action in the selected range must appear exactly once
as either an action segment or an exclusion. An exclusion requires its recorded action
ID, sequence, operation, cited evidence sequences, and a concrete reason.

An action segment must contain exactly one top-level logical action. Its precondition
and postcondition must cite that action's own `before-action` and `after-action`
`checkpoint.captured` events. `facts` state what the agent actually verified in those
artifacts; a package name alone is normally only a fixture guard, not proof of a UI
transition.

Observation-only segments use `kind: "observation"`, omit `actionId`, set
`loweredOperation` to `noop`, and cite the recorded semantic observation plus its
supporting screenshot/native artifacts. Keep them separate from state-changing action
segments.

`replay-plan.json` must contain the same segment IDs in the same order. Each action's
operation must equal `loweredOperation`; mechanical lowering may fill only its
arguments. Plan checkpoint IDs must equal the ledger checkpoint IDs. The validator
checks this structural and provenance contract; the agent remains responsible for the
semantic correctness of every cited fact and expectation.
