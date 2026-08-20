# Checkpoint Replay and Agent Recovery

Status: PR2a implementation design.

## 1. Scope

An agent synthesizes an immutable recording into an ordered `plan.json`; ActOnce
executes that plan deterministically. A checkpoint is the only success oracle.

Two things are immutable:

- checkpoint assertions;
- the basic run structure: segment count, order, and target checkpoint.

The action inside a segment is the replaceable *how*. An agent may manually
perform or lightly adjust that action, but it may not weaken checkpoints or
change the case structure.

## 2. Synthesize

`synthesize-device-replay` requires the agent to determine checkpoints first and emits a versioned
plan:

```ts
type ReplayPlanFile = {
  schemaVersion: 1;
  recordingId: string;
  version: number;
  platform: DevicePlatform;
  segments: ReplayPlanSegment[];
};

type ReplayPlanSegment = {
  id: string;
  precondition: CheckpointSpec<unknown>;
  action: { operation: string; arguments: unknown[] };
  postcondition: CheckpointSpec<unknown>;
  idempotency?: SegmentIdempotency;
};
```

The plan contains no automatic fallback policy. Synthesis and execution are separate:
author and validate once, then execute the same plan as many times as needed.

## 3. Deterministic Execute

The platform CLI runs segments in order:

```bash
actonce-ios replay <plan.json>
actonce-android replay <plan.json>
```

For every segment:

1. verify the precondition;
2. run the mechanically lowered action;
3. verify the postcondition.

If a checkpoint does not pass, execution stops. Failure is not reclassified or
repaired by the runtime. `ReplayResult.failedCheckpoint` reports:

- `segmentId`;
- `checkpointId`;
- `phase` (`precondition` or `postcondition`);
- optional state label;
- expected checkpoint;
- sanitized differences.

This single-run result is enough for an agent to inspect the failure.

## 4. Agent Recovery

Hybrid replay is a skill workflow, not a runtime mode. Use `hybrid-replay`:

1. run the deterministic plan;
2. if it fails, inspect `failedCheckpoint` and the live device;
3. use agent-controlled actions to reach that checkpoint;
4. verify the checkpoint with device evidence;
5. resume the remaining deterministic plan.

Resume uses:

```bash
actonce-ios replay <plan.json> --from-segment <segment-id>
actonce-android replay <plan.json> --from-segment <segment-id>
```

`--from-segment` still verifies the selected segment's precondition before
running its action.

- Precondition failure: recover that precondition, then resume from the failed
  segment.
- Postcondition failure: recover that postcondition, then resume from the next
  segment. The next segment's precondition verifies the recovered state again.
- Final postcondition failure: once the agent verifies it, the case is complete.

If the checkpoint cannot be reached without changing an immutable checkpoint or
the basic run structure, escalate the failure.

## 5. Explicit Non-Goals

This design intentionally has no cross-run trend store, recompilation advisor,
runtime strategy selection, or automatic plan fallback. Those can be reconsidered
only when a benchmark demonstrates a concrete need.

The existing script-level `ReplayFlow` fallback API remains available for legacy
callers, but `plan.json` execution is deterministic and agent recovery stays
outside the runtime.

## 6. Verification

PR2a is complete when:

- plan parsing rejects missing checkpoint contracts;
- deterministic replay stops at the first failed checkpoint;
- failure identifies the exact checkpoint and state assertion;
- `--from-segment` starts at the named segment and verifies its precondition;
- an unknown segment id fails before any action runs;
- `hybrid-replay` documents the run, inspect, recover, verify, and resume loop.

The checked-in replay regression suite runs with:

```bash
npm run test:replay
```

It consumes the replay artifacts themselves rather than maintaining equivalent
test-only copies:

- the iOS Settings executor test loads `benchmark/ios/settings-about.plan.json`;
- iOS and Android checkout benchmarks share their segment definitions with the
  offline regression test;
- macOS Lynxtron replay scripts execute their own decision-only path and verify
  that every compiled checkpoint still points to recorded evidence.

This suite is device-independent and therefore part of `npm test`. It protects
the plan, action sequence, checkpoint contracts, and recorded evidence links.
It does not claim that a current app build still renders the same UI.

Device correctness remains an explicit integration gate:

```bash
npm run benchmark:ios:replay-settings
npm run benchmark:ios:replay-demo-app
npm run benchmark:android:replay-demo-app
npm run benchmark:macos:lynxtron:cli -- run --mode replay --case diagnostic-hover
```

Those commands require their platform fixtures and device services. They are
kept out of the default test command so ordinary unit-test runs remain
deterministic and do not control a live UI.
