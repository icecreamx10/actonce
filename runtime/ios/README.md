# @byted-lynx/actonce-ios

The iOS counterpart to `@byted-lynx/actonce-macos`. It connects directly to an existing
WebDriverAgent HTTP endpoint, creates a native WDA session, and exposes
fixed replay primitives, WDA-source checkpoints, screenshot checkpoints,
bounded checkpoint settling through `@byted-lynx/actonce-replay`, and a script runner.
The deterministic runtime has no Midscene dependency.

The runtime does not start or select a Simulator implicitly. Use the repository's
`ios:start` and `ios:wda` commands so the controlled device remains explicit.

```ts
await context.flow.segment({
  id: "open-general",
  precondition: { id: "settings", expected: { source: { includes: ["通用"] } } },
  deterministic: () => replayIOSPrimitive(context.ios, {
    operation: "tap",
    arguments: [{ x: 92, y: 284 }],
  }),
  postcondition: {
    id: "general",
    expected: { source: { includes: ["关于本机"] } },
    settle: { timeoutMs: 2_500, intervalMs: 100 },
  },
});
```

WDA accessibility/source evidence is preferred when the recording contains it.
Visual replay must remain visual when screenshot evidence is the only recorded
modality; do not silently replace it with a WDA-source assertion.
