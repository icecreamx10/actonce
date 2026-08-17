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
