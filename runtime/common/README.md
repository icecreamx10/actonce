# @byted-lynx/actonce-replay

Checkpoint-gated replay orchestration shared by ActOnce platform runtimes.
The package does not control a device and does not depend on an AI provider.
Platform packages inject checkpoint verification; products may additionally inject
a bounded AI fallback driver.

```ts
const flow = new ReplayFlow({
  checkpoints,
  policy: "recover",
  fallback,
});

await flow.segment({
  id: "edit-main",
  precondition: ready,
  deterministic: () => replaceText(),
  postcondition: edited,
  fallback: {
    goal: "Make main.js contain the expected probe without saving.",
    maxAttempts: 1,
    maxActions: 5,
  },
});
```

Replace fixed post-action sleeps with bounded checkpoint settling:

```ts
postcondition: {
  id: "edited",
  expected: editedState,
  settle: { timeoutMs: 2_500, intervalMs: 100, consecutiveMatches: 2 },
}
```

The runtime verifies immediately, then polls only while the checkpoint differs.
It advances as soon as the required consecutive matches arrive. If the timeout is
exhausted, the unchanged mismatch enters the existing fallback policy; deterministic
mode fails closed. This keeps the recorded wait as a worst-case budget instead of
paying it on every replay.

Use `policy: "disabled"` for deterministic benchmarks. A recovery is local to the
failed pre- or post-checkpoint; after fallback, the same checkpoint must match before
the next deterministic segment may run. `never-retry` postconditions are exposed to
fallback drivers as observation-only.

Call `flow.diagnostics()` when writing a replay result. It reports the selected
strategy, fallback count and duration, checkpoint poll count, actual checkpoint wait
duration, and timeout count. The benchmark's enclosing
execution timer must still cover the complete flow, including checkpoint verification
before and after fallback.
