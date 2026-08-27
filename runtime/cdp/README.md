# `@byted-lynx/actonce-cdp`

CDP-backed tree observation for ActOnce. The adapter captures and canonicalizes a DOM tree, supports source-native tree hashes and portable semantic projections, and deliberately does not capture screenshots. Visual evidence stays on the connected device capability.

```ts
const tree = await new CdpTreeObserver().connect({
  device,
  target,
  options: { endpoint: "http://127.0.0.1:9222", target: { title: "Lynx" } },
});
```

For replay, inject that tree session and the platform-owned visual session into
the shared checkpoint chain. `ReplayFlow` owns polling, deadlines and fallback;
the CDP driver performs one coherent tree → optional visual → tree observation.

```ts
const flow = createCdpReplayFlow({ tree, visual });

await flow.segment({
  id: "open-card",
  precondition: {
    id: "before-open",
    expected: { tree: { projection: beforeProjection } },
  },
  deterministic: openCard,
  postcondition: {
    id: "card-ready",
    expected: {
      tree: { projection: readyProjection },
      visual: { referenceId, comparator: { type: "pixelDiff", mismatchThreshold: 0.01 } },
    },
    settle: { timeoutMs: 5_000, intervalMs: 30 },
  },
});
```

Products that already own the CDP connection can run the JSONL sidecar and
answer its `capture` events with `{sessionId, root}` snapshots. A recorded
sleep is represented in two phases:

1. `recordStableCdpAnchor` runs after the original sleep, captures one accepted
   post-sleep observation, and returns a compact, session-independent canonical
   DOM anchor. It does not add another stability wait to the recording.
2. `waitForCdpAnchor` replaces that sleep during replay and polls until the
   recorded anchor matches for the requested number of consecutive captures.

`waitForStableCdpTree` remains available for infrastructure readiness, but it
must not be used as a substitute for a recorded case checkpoint: a loading
tree can be temporarily stable without being the intended post-sleep state.
For connection readiness alone, `waitForCdpReady` accepts the first successful
DOM round-trip from a non-rejected session and adds no arbitrary settle delay.
Suite setup should use `ping` to handshake and prestart the persistent sidecar
when the application's bootstrap session does not guarantee a DOM. The first
card checkpoint then proves the actual card DOM instead of treating transport
registration as page readiness.
