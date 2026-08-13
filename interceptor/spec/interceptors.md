# Composable interceptor architecture

[English](interceptors.md) | [简体中文](interceptors.zh-CN.md)

One `RecorderSession` owns the recording clock, global sequence, append-only
event file, artifact store, manifest, integrity status, and interceptor
lifecycle. Interceptors are independent sources and never write recording files
directly.

```text
Midscene ─┐
macOS AX ─┼─> RecorderSession ─> events.ndjson + artifacts + manifest
Mac input ┤
WDA ──────┘
```

## Source interface

Each `RecorderInterceptor` declares a stable `SourceDescriptor` and implements
`start(context)` / `stop()`. The supplied context exposes only event emission,
the session monotonic clock, content-addressed artifact storage, and integrity
reporting. A session can attach any compatible set of sources.

Implemented sources:

- `MidsceneInterceptor`: logical action hooks, progress, raw execution dumps,
  and normalized Assert/Boolean/Query observations;
- `MacOSInputInterceptor`: concrete pointer, keyboard, scroll, and screenshot
  calls crossing Midscene's Computer device boundary;
- `MacOSAXInterceptor`: provider-neutral AX notifications and snapshots;
- `WdaInterceptor`: byte-faithful WDA HTTP requests, responses, and failures.

The AX interceptor intentionally depends on a `MacOSAXProvider`. A native Swift
helper or Node addon can implement that boundary without coupling native AX code
to persistence. Passing that provider as `recorderOptions.axProvider` to
`agentForRecordedComputer()` attaches the AX source and includes its snapshot in
each action checkpoint; without one, the checkpoint explicitly reports native
UI evidence as unavailable.

## Ordering model

Every event has three ordering signals:

- `sequence`: total order assigned synchronously by the session;
- `sourceSequence`: order within one source instance;
- `timing.observedMonotonicNs`: when the source observed the fact, distinct from
  `timing.ingestedMonotonicNs` when the session received it.

Total order describes the log. It does not by itself prove causality across
asynchronous sources. `traceId`, `spanId`, and `parentSpanId` express the causal
chain. For example, a device primitive is a child of its Midscene logical
action, while an AX notification caused by that primitive can reference the
primitive span.

## Raw evidence and normalized events

Midscene execution dumps remain immutable artifacts. The Midscene source also
promotes completed Assert, Boolean, and Query tasks into deduplicated
`observation.completed` events. Each normalized event references its original
dump artifact. New recordings also attach `evidenceSource`, the task's
`domIncluded` declaration, Midscene screenshot context, and concrete screenshot
artifact/sequence references captured while that observation was pending. Consumers
therefore do not need timestamp adjacency to decide whether an observation was
screenshot-, DOM-, or native-backed. Older recordings remain readable through
compiler adjacency fallback.

The append-only `events.ndjson` remains the source of truth. A compact
`recording.json` is a rebuildable derived index, not a mutable shared log.
