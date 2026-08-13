# ActOnce replay runtimes

ActOnce keeps replay orchestration separate from platform control:

- `common/` publishes `@actonce/replay`: checkpoint-gated segments, structured
  events, idempotency policy, bounded fallback, and resume semantics.
- `macos/` publishes `@actonce/macos`: Mac2/AX execution and checkpoint evidence.
- `midscene-fallback/` publishes `@actonce/midscene-fallback`: an optional adapter
  around an existing, recorder-attached Midscene Agent.

Platform runtimes capture and compare native evidence. The common runtime decides
whether deterministic execution may continue. AI fallback is local to one failed
checkpoint and never bypasses the subsequent checkpoint verification.

Fallback is disabled unless a driver is explicitly injected. Benchmarks may compare
deterministic or hybrid replay as long as final correctness passes. Hybrid measurements
must include fallback overhead in the scored interval and retain replay and fallback
events in their run artifacts.
