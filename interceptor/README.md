# ActOnce Interceptors

[English](README.md) | [简体中文](README.zh-CN.md)

The interceptor layer is ActOnce's composable, platform-facing flight recorder.
All sources write through one `RecorderSession`; none owns files directly.

```text
src/
  core/     session, source interface, ordering, artifacts, lifecycle
  sources/  Midscene, macOS input, macOS AX, and WDA interceptors
  android/  recorded Midscene Android composition
  ios/      WDA CLI composition
  macos/    recorded Midscene Computer composition
```

See the [composable interceptor architecture](spec/interceptors.md) for source
contracts, ordering, correlation, and supported combinations.

## CLI recording profiles

```bash
actonce-record profiles --json
actonce-record record midscene-macos --entry /absolute/task.ts --display-id 0
actonce-record record midscene-ios --entry /absolute/task.ts --upstream-port 8100
actonce-record record midscene-android --entry /absolute/task.ts --serial emulator-5554
actonce-record record ios-wda --upstream-port 8100
```

Inside an ActOnce checkout the equivalent development commands are:

```bash
npm run interceptor:start -- profiles --json
npm run interceptor:start -- record midscene-macos --entry /absolute/task.ts --display-id 0
npm run interceptor:start -- record midscene-ios --entry /absolute/task.ts --upstream-port 8100
npm run interceptor:start -- record midscene-android --entry /absolute/task.ts --serial emulator-5554
npm run interceptor:start -- record ios-wda --upstream-port 8100
```

Source composition is owned by named CLI profiles. Skills and task modules never
attach sources directly. `midscene-macos` fixes the `midscene + macos-input +
checkpoint` combination. `midscene-ios` fixes `midscene + wda + checkpoint`,
including screenshot and native UI tree capture. `ios-wda` is the protocol-only
proxy profile. `midscene-android` fixes `midscene + normalized Android actions +
checkpoint`, including screenshot and UI-tree capture. Add and test a new named CLI profile when another combination is
needed.

## iOS / WDA

The iOS interceptor is ActOnce's passive flight recorder for WebDriverAgent traffic.
It sits between an iOS automation client and WDA, forwards the protocol without
changing its meaning, and writes an append-only account of what crossed the
boundary.

```text
Midscene / another WDA client
              |
              v
    ActOnce WDA Interceptor
      listen: 127.0.0.1:8200
              |
              v
       WebDriverAgent :8100
              |
              v
        iOS Simulator
```

The raw recording is evidence, not an executable script. Separate downstream
layers may normalize the protocol, classify actions and observations, assemble a
timeline, and compile replay flows. Those interpretations must remain replaceable
without repeating the original AI demonstration.

## Goal

Build a loss-aware, append-only, byte-faithful WDA HTTP recorder that does not
interpret or intentionally modify device behavior.

The interceptor records:

- the original HTTP method, target, headers, request body, and response body;
- wall-clock timestamps for correlation and monotonic timestamps for duration;
- connection, request, sequence, and WDA session identifiers;
- response status, transport errors, cancellation, and timeout outcomes;
- hashes and content-addressed references for screenshots, page sources, and
  other large payloads;
- its own integrity failures, including queue overflow, incomplete bodies, and
  failed blob writes.

## Invariants

### Transparent

For the client, the proxy should be behaviorally equivalent to talking directly
to WDA. It must preserve methods, paths, bodies, status codes, and ordering. Any
header transformation required by HTTP proxying must be described in the event.

### Passive by default

The interceptor must not inject `/screenshot`, `/source`, element lookup, or
other WDA requests into the original session. Active sampling changes timing and
device load. A future sampler must be a separate opt-in sidecar whose events are
explicitly marked as ActOnce-generated.

### Append-only

Raw events are never edited after capture. Normalization, classification,
redaction for reports, and flow compilation write separate derived artifacts.
Every derived step should retain the source event sequence numbers from which it
was produced.

### Loss-aware

The recorder must never silently omit data. If buffering or persistence fails,
it writes an integrity event when possible and marks the recording incomplete.
An incomplete recording may be inspected but must not be silently compiled into
a trusted replay flow.

### Byte-faithful

Bodies are captured as bytes before parsing. Parsed JSON may be stored later as
an index, but it is not a replacement for the original payload. Content encoding
and media type are retained.

## Explicit non-goals

The interceptor does not:

- decide whether a request is an action or an observation;
- infer labels, targets, intent, preconditions, or postconditions;
- merge low-level requests into user-level steps;
- generate or execute replay scripts;
- repair a failed flow with AI;
- claim zero performance impact without measurement.

These belong to downstream packages. Keeping them out of the capture boundary is
what lets ActOnce improve its compiler without paying for another AI run.

## Recording layout

The proposed on-disk representation is:

```text
recordings/<recording-id>/
  manifest.json
  events.ndjson
  artifacts/
    07/07ab...png
    31/31cd...json
    a8/a8ef...bin
```

`events.ndjson` contains small metadata records. Request and response bodies are
stored by SHA-256 under `artifacts/`; duplicate content is written only once. The
manifest contains the schema version, recorder version, upstream address,
started and completed timestamps, and final integrity status.

The common event envelope is defined in
[`schema/event-envelope.schema.json`](schema/event-envelope.schema.json). The
initial raw WDA event contract is defined in
[`schema/raw-wda-event.schema.json`](schema/raw-wda-event.schema.json).
The complete directory contract and checkpoint semantics are defined in
[`spec/recording.md`](spec/recording.md).

Replay uses the same append-only timeline. Pass the public adapter to
`ReplayFlow.emit` so segment, checkpoint, fallback, and re-verification events
receive the same global sequence and source ordering as recorder events:

```ts
import { RecorderSession, createReplayEventRecorder } from "@byted-lynx/actonce-recorder";

const recording = await RecorderSession.create({ platform: "macos", recorder: "e2e-replay" });
const flow = createCdpReplayFlow({
  tree,
  visual,
  emit: createReplayEventRecorder(recording),
});
```

## Run the capture prototype

Keep WDA running on port 8100, then start the interceptor in another terminal:

```bash
npm run interceptor:start
```

Point the Midscene iOS device at the interceptor without changing WDA itself:

```bash
ACTONCE_WDA_PORT=8200 npm run benchmark:ios:smoke
```

Stop the interceptor with Ctrl-C so it can flush the event queue and finalize
the manifest. The recording is written below `recordings/`, which is ignored by
Git.

## Security boundary

WDA traffic can contain typed text, screenshots, accessibility content, and
application data. A faithful recording must therefore be treated as sensitive.

- Record only a dedicated benchmark simulator during development.
- Bind both the interceptor and WDA to local interfaces.
- Keep recordings out of Git by default.
- Never place authorization headers or model credentials in WDA metadata.
- Add encrypted raw storage before recording real user data.
- Produce a separate sanitized derivative for reports or sharing; do not mutate
  the raw recording in place.

## First milestone

Use the validated Settings task as the first trace:

> Launch Settings, open General, open About, and verify that device information
> is visible.

The milestone is complete when:

1. Midscene can run the task through `127.0.0.1:8200` with WDA on `:8100`.
2. The outcome is identical to the direct-WDA baseline.
3. Every HTTP exchange has ordered request and response events with timing.
4. Large bodies are stored and deduplicated by content hash.
5. A forced write failure produces an explicit incomplete recording.
6. The raw trace can be consumed by a separate program without importing the
   interceptor implementation.

Only after this capture milestone should we implement action classification and
flow compilation.
