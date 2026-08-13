# Recording format v1

[English](recording.md) | [简体中文](recording.zh-CN.md)

An ActOnce recording is a directory, not a single serialized object. Its main
JSON file is a rebuildable index over an immutable event stream and
content-addressed artifacts.

```text
recordings/<recording-id>/
  recording.json
  events.ndjson
  artifacts/<sha256-prefix>/<sha256>
```

- `events.ndjson` is the append-only source of truth.
- `artifacts/` contains byte-faithful bodies, decoded images, and native UI
  dumps, addressed only by SHA-256.
- `recording.json` connects raw requests, derived protocol annotations, actions,
  state checkpoints, and artifacts. It can be rebuilt from the other two.

The machine-readable contracts are:

- [`event-envelope.schema.json`](../schema/event-envelope.schema.json)
- [`raw-wda-event.schema.json`](../schema/raw-wda-event.schema.json)
- [`protocol-annotation.schema.json`](../schema/protocol-annotation.schema.json)
- [`derived-protocol-annotation.schema.json`](../schema/derived-protocol-annotation.schema.json)
- [`recording.schema.json`](../schema/recording.schema.json)

## Platform capture boundaries

The persistence path is intentionally the same across platforms; the capture
boundary is not:

| Target | Capture boundary | Raw evidence |
| --- | --- | --- |
| iOS | transparent HTTP proxy in front of WDA | requests, responses, bodies, timing |
| macOS | decorator around Midscene `ComputerDevice` | screenshots and concrete pointer, keyboard, and scroll primitive calls |

Shared persistence code lives in `src/core/`. Composable source adapters live
in `src/sources/`; `src/ios/` and `src/macos/` are scenario compositions. The
macOS adapter cannot observe an unmodified
external Midscene process because `@midscene/computer` calls native input
libraries in-process; callers must construct the agent with
`agentForRecordedComputer()`.

`ACTONCE_PLATFORM=auto` selects iOS when WDA is reachable at the configured
upstream address and otherwise selects the local macOS adapter. Explicit
`ACTONCE_PLATFORM=ios|macos` always wins.

### Midscene correlation layers

For macOS, the adapter uses Midscene's public interface hooks
`beforeInvokeAction` and `afterInvokeAction` to create the logical action and its
checkpoint pair. Wrapped input primitives record the actual device calls and
reference that logical action. Direct primitive calls, which bypass Midscene's
hooks, receive their own standalone checkpoint pair. Public agent progress and
execution-dump listeners retain planning/report correlation.

Midscene does not provide an action-error hook, and `afterInvokeAction` is not
called if the action throws. A still-open logical action is therefore emitted as
`logical.action.outcome-unknown` when another action starts or the recorder
closes; primitive failures remain independently observable.

## Raw versus derived data

Raw events are never updated with a later interpretation. WDA classification is
stored as a derived annotation containing a catalog rule ID and the source event
sequences. Unknown endpoints remain explicitly unknown.

Protocol annotations describe observed protocol semantics, not user intent. For
example, `input.tap` says that WDA received a tap; it does not claim that the user
intended to open General.

Generate annotations without changing the raw log:

```bash
npm run interceptor:annotate -- recordings/<recording-id>
```

The command atomically writes `derived/protocol-annotations.ndjson` and reports
known-rule coverage. An unknown endpoint stays in the output with conservative
`unknown` semantics.

## Checkpoint contract

An ActOnce checkpoint is a coherent state bundle, not merely a screenshot. A
complete checkpoint contains a final screenshot, a native UI source dump, device
metadata, timing, and source event references.

Evidence availability is recorded, never invented. WDA exposes native UI source.
Midscene Computer currently exposes no macOS AX tree; the macOS prototype records
`nativeUi.status = "unavailable"`. That checkpoint remains incomplete for trusted
replay until a separate AX capture provider is added.

The default capture sequence is:

```text
wait for visual stability
capture screenshot A
capture native UI source
capture screenshot B
compare A and B
```

If A and B differ beyond the configured threshold, the recorder retries once or
marks the checkpoint `incoherent`. It must not silently attach a source tree to a
different visual state.

Every classified protocol has an explicit checkpoint policy:

- `trigger` opens or advances a logical checkpoint;
- `contributor` adds evidence to a pending checkpoint;
- `metadata` enriches a checkpoint without creating state;
- `boundary` establishes an initial or final state boundary;
- `none` has no checkpoint effect.

The policy also declares `provides` and `requiredEvidence`. For example,
`/screenshot` is an observation trigger that provides only `screenshot`; it is
not complete until native UI and device metadata are associated with the same
logical state. A window-rect read is metadata and never creates a state by
itself.

Triggers are coalesced, not counted one-for-one as states. After an action, the
recorder keeps one pending post-action checkpoint. Subsequent screenshot/source
observations contribute to or refresh that checkpoint until it is complete and
settled. Repeated observations of an unchanged UI reference the same state and
content-addressed artifacts. The raw requests remain separate immutable events.

## State chain

The index represents a demonstration as a state chain:

```text
S0 -- A1 --> S1 -- A2 --> S2
```

The previous post-state is reused as the next pre-state. An extra pre-action
checkpoint is required only when state is missing, stale, incomplete, or changed
outside the recorded WDA action stream.

## Crash recovery

While recording, events are appended and artifacts are written by hash. The
index is written through a temporary file and atomically renamed. If the process
crashes, a recovery tool rebuilds `recording.json` from the surviving events and
artifacts and marks unresolved gaps as incomplete.
