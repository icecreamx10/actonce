# ActOnce JIT Feedback Loop — Design

Status: draft (design only; no runtime code yet)
Scope: `runtime/common` replay engine, `runtime/midscene-fallback`, and the
`compile-device-recording` skill. macOS lynxtron-fiddle replays are out of scope
because they do not use `ReplayFlow` (they run straight-line `measuredStep` +
`pollVisualCheckpoint` scripts).

## 0. Mental model

`ReplayFlow` is a JIT compiler for AI-agent execution flows. Stable, hot spans
are compiled to deterministic code (the fast path); non-deterministic judgement
stays with the AI agent (the interpreter). The skeleton already exists. What is
missing is the JIT feedback loop.

| JIT concept | ActOnce mapping | Status | Evidence |
| --- | --- | --- | --- |
| guard | checkpoint (pre/post) | present | `runtime/common/src/flow.ts:43` |
| hot path | `segment.deterministic()` | present | `runtime/common/src/flow.ts:78` |
| deopt (fall back to interpreter) | bounded AI fallback | present | `runtime/common/src/flow.ts:155` |
| OSR (enter/leave compiled code mid-run) | per-segment fallback | present | segment-scoped `ensure()` |
| profiler (per call site) | per-segment telemetry | **missing** | `diagnostics()` is global only, `runtime/common/src/flow.ts:30` |
| captured deopt result | agent corrective demonstration | **missing** | `FallbackResult` drops it, `runtime/common/src/types.ts:60` |
| tiered controller / retirement | de-optimize + runtime-adaptive boundary | **missing** | no store, no tier |

Divergence from LOOP (arXiv:2605.14237): LOOP is AOT — it parameterizes the
whole task into a branch-free deterministic plan. ActOnce is JIT — it only
compiles spans it can prove are stable, leaves judgement to the agent, and moves
the compile boundary adaptively from runtime observation.

## 1. Invariants (apply to every phase)

1. **Correctness is the only hard gate.** The acceptance signal is always "the
   postcondition checkpoint reaches `matched`". Profiling, hotness, tiering, and
   retirement change *whether/how fast* the compiled path runs, never the
   pass/fail decision. A retired segment still passes through the same
   postcondition gate. **Retirement cannot self-heal past a real regression.**
2. **All type changes are additive.** New fields are optional or default-empty.
   The single repo-wide break is `runtime/common/test/flow.test.ts:117` (an
   exact `toEqual`), fixed with one added line.
3. **`runtime/common` stays Midscene-free.** The profiler, store, and tier
   classifier live in `runtime/common`; the flow talks to them only through
   injected hooks (`onSegmentProfiled`, `tierFor`) and never imports `fs`.
4. **Defaults reproduce today's behavior exactly.** With no `tierFor` and no
   store, every segment is `compiled`, so execution and the emitted event stream
   are byte-for-byte identical to today.

## 2. Deliverable A — Per-segment profiler

Modify `runtime/common/src/{types.ts,flow.ts,index.ts}`.

```ts
// types.ts (new)
export type SegmentOutcome =
  | "matched"              // postcondition matched cleanly, no deopt
  | "recovered"            // matched only after fallback
  | "deterministic-failed" // deterministic() threw
  | "fallback-failed"      // fallback ran but postcondition never matched
  | "mismatched";          // failed closed (policy disabled / no fallback)

export type SegmentGuardCost = {
  captureDurationMs: number;
  settleDelayMs: number;
  pollCount: number;
  timeoutCount: number;
};

export type SegmentFallbackOutcomes = {
  completed: number;
  declined: number;
  failed: number;
};

export type SegmentProfile = {
  segmentId: string;
  runs: number;
  attempts: number;
  deterministicFailures: number;
  guard: { precondition: SegmentGuardCost; postcondition: SegmentGuardCost };
  fallback: { count: number; durationMs: number; outcomes: SegmentFallbackOutcomes };
  outcome: SegmentOutcome;   // final outcome of the most recent run
  matchedCleanly: boolean;   // postcondition matched with zero deopts
};

// ReplayDiagnostics gains one additive field (existing 8 fields unchanged)
export type ReplayDiagnostics = {
  /* ...existing global fields... */
  segments: SegmentProfile[];
};
```

Accumulation hooks in `flow.ts` (add `private readonly segmentProfiles =
new Map<string, MutableSegmentProfile>()` plus a lazy-inserting `profileFor(id)`
that preserves insertion order):

- `checkpoint()` (`runtime/common/src/flow.ts:43`): it already has `segmentId`
  and `phase`. Next to the global `checkpointCaptureDurationMs +=`, add
  `profileFor(id).guard[phase].captureDurationMs +=`.
- `settleCheckpoint()` (`runtime/common/src/flow.ts:174`): attribute per-phase
  `settleDelayMs` (near lines 220-222), `pollCount` (line 224), and
  `timeoutCount` (line 237) to the matching phase.
- `segment()` (`runtime/common/src/flow.ts:66`): on entry bump `runs`; when
  `deterministicFailure` is set (line 85) bump `deterministicFailures`; after
  the postcondition `ensure` returns, set `outcome`/`matchedCleanly`; on the
  catch path (line 107) mark `mismatched` / `fallback-failed`.
- `ensure()` (`runtime/common/src/flow.ts:117`): per attempt bump
  `fallback.count`, add `durationMs`, and increment `outcomes[status]`; a
  recovered postcondition sets `outcome = "recovered"`.
- `diagnostics()` (`runtime/common/src/flow.ts:30`): append
  `segments: [...segmentProfiles.values()].map(finalize)`.

Single test fix: `runtime/common/test/flow.test.ts:117` `toEqual({...})` gains
one line `segments: [],` (that deterministic-mode test runs no segment, so the
map is empty). Every other diagnostics assertion in the repo uses
`toMatchObject` and is unaffected. The downstream benchmark reader
`benchmark/macos/lynxtron-fiddle/evaluation.ts:14` declares its own narrow
optional type and ignores the new field.

Re-export `SegmentProfile`, `SegmentGuardCost`, `SegmentFallbackOutcomes`,
`SegmentOutcome` from `runtime/common/src/index.ts`.

## 3. Deliverable B — Enriched `FallbackResult` (captured deopt demonstration)

Modify `runtime/common/src/{types.ts,index.ts}` and
`runtime/midscene-fallback/src/index.ts`; extend
`runtime/midscene-fallback/test/fallback.test.ts`.

```ts
// types.ts (new)
export type CorrectiveAction = {
  kind: string;        // normalized: "tap" | "type" | "scroll" | "key" | ...
  target?: string;     // normalized selector/description; never raw secrets
  atMonotonicNs?: string;
};

export type CorrectiveDemonstration = {
  segmentId: string;
  phase: "precondition" | "postcondition";
  attempt: number;
  actions: CorrectiveAction[];
  evidenceRefs?: string[]; // artifact path / sha references only, never bytes
  summary?: string;        // sanitized recap, NOT raw model reasoning
};

export type FallbackResult = {
  status: "completed" | "declined" | "failed";
  actionCount?: number;
  reason?: string;
  corrective?: CorrectiveDemonstration; // NEW, optional
};
```

- `MidsceneFallbackDriver.recover()` (`runtime/midscene-fallback/src/index.ts:29`)
  already registers `addProgressListener` (lines 43-49) that counts
  `aiAct/action_running`. Extend that listener to also push a normalized
  `CorrectiveAction`. On success (line 58) return `corrective` **only when
  `actions.length > 0`**, so the zero-action path stays exactly
  `{ status: "completed", actionCount }`.
- **SKILL red line** (`skills/compile-device-recording/SKILL.md:46`): `corrective`
  carries only action kinds and evidence refs — never the `aiAction` return
  string (model reasoning), values, clipboard, or screenshot bytes.
- Threading: `ensure()` already emits the full `fallbackResult` into
  `replay.fallback.completed` (`runtime/common/src/flow.ts:159`), so `corrective`
  reaches the event stream unchanged. Additionally collect non-empty
  `corrective` into a per-segment `CorrectiveDemonstration[]` passed to
  `onSegmentProfiled` (Deliverable C).

Optionality keeps `runtime/midscene-fallback/test/fallback.test.ts:26`
(`toEqual({ status: "completed", actionCount: 0 })`) green.

## 4. Deliverable C — Cross-run `ProfileStore` (new `runtime/common` module)

New file `runtime/common/src/profile-store.ts`; add an options hook to
`types.ts`; call the hook in `flow.ts`; export from `index.ts`.

```ts
export type SegmentProfileRecord = {
  recordingId: string;
  segmentId: string;
  sampleCount: number;
  deoptCount: number;
  deterministicFailures: number;
  deoptRateEwma: number;            // EWMA of per-run "did this run deopt"
  guardMsEwma: number;              // EWMA of total guard cost per run
  recentOutcomes: SegmentOutcome[]; // rolling window, default 20
  fallbackOutcomes: SegmentFallbackOutcomes;
  hotness: number;                  // 1 - deoptRateEwma
  stability: number;                // fraction of window that is "matched"
  lastCorrectiveRefs?: string[];
  firstSeenAt: string;
  updatedAt: string;
};

export type ProfileStoreFile = {
  schemaVersion: 1;
  recordingId: string;
  segments: Record<string, SegmentProfileRecord>;
  updatedAt: string;
};

export type ProfileStoreOptions = {
  path: string;
  recordingId: string;
  now?: () => number;      // injected clock for deterministic timestamps
  window?: number;         // default 20
  ewmaAlpha?: number;      // default 0.3
  readFile?: (p: string) => Promise<string>;            // injectable; default node:fs/promises
  writeFile?: (p: string, data: string) => Promise<void>;
};

export class ProfileStore {
  static load(options: ProfileStoreOptions): Promise<ProfileStore>; // ENOENT => empty
  get(segmentId: string): SegmentProfileRecord | undefined;
  record(profile: SegmentProfile, correctives?: CorrectiveDemonstration[]): void;
  snapshot(): ProfileStoreFile;
  save(): Promise<void>;   // re-read disk, per-segment merge, write
}
```

- Aggregation: `didDeopt = profile.fallback.count > 0`;
  `deoptRateEwma = alpha * Number(didDeopt) + (1 - alpha) * prev`;
  `hotness = 1 - deoptRateEwma`; push `profile.outcome` onto `recentOutcomes`
  capped at `window`; `stability = count(matched) / recentOutcomes.length`; fold
  `fallbackOutcomes` and `guardMsEwma`; `lastCorrectiveRefs` = flattened
  `evidenceRefs` + action `kind`s from the supplied correctives.
- Read-merge-write mirrors `benchmark/macos/lynxtron-fiddle/suite-runner.ts:47`
  and `:82`: `load` reads once (ENOENT tolerant); `save` re-reads current disk
  state and merges per segment so parallel runs of the same recording do not
  clobber each other, then writes `JSON.stringify(..., null, 2) + "\n"`. Default
  path convention matches `benchmark/ios/settings-about-replay.ts:10`, e.g.
  `.cache/<platform>-runtime/<name>/segment-profile.json`.
- Options hook on `ReplayFlowOptions` (`runtime/common/src/types.ts:128`):
  `onSegmentProfiled?: (profile: SegmentProfile, correctives: CorrectiveDemonstration[]) => void | Promise<void>`.
  `segment()` awaits it after the run resolves — after `replay.segment.completed`
  on success, and in the catch before rethrow on failure — so a failed
  retirement still records a data point.
- Benchmark wiring (opt-in, no behavior change): `ProfileStore.load(...)`, pass
  `onSegmentProfiled: (p, c) => store.record(p, c)` into `createIOSReplayFlow` /
  `createAndroidReplayFlow`, and `await store.save()` in the `finally`.
  `IOSReplayFlowOptions` / `AndroidReplayFlowOptions`
  (`runtime/ios/src/checkpoint.ts`, `runtime/android/src/checkpoint.ts`) forward
  the two new optional fields into `new ReplayFlow({...})`.

Re-export `ProfileStore`, `SegmentProfileRecord`, `ProfileStoreFile`,
`ProfileStoreOptions`, `CorrectiveAction`, `CorrectiveDemonstration`.

## 5. Deliverable D — Runtime-adaptive retirement controller

This is the chosen boundary side: the compile boundary moves at runtime, driven
by cross-run `ProfileStore` stats, with a `minSamples` floor and a
rehabilitation path. Modify `types.ts`, `flow.ts`, `profile-store.ts` (pure
classifier), `index.ts`; forward options in the iOS/Android factories.

```ts
export type SegmentTier = "compiled" | "probation" | "retired";

export type RetirementPolicy = {
  minSamples?: number;                 // default 5 — never retire before N samples
  retireDeoptRate?: number;            // default 0.6 — EWMA above => retired
  probationDeoptRate?: number;         // default 0.25 — band between => probation
  rehabilitateAfterCleanRuns?: number; // default 3 — trailing clean matched => step up
};

// ReplayFlowOptions gains:
tierFor?: (segmentId: string) => SegmentTier;

// profile-store.ts (pure, unit-testable, no flow dependency)
export function classifyTier(
  record: SegmentProfileRecord | undefined,
  policy?: RetirementPolicy,
): SegmentTier; // undefined / insufficient samples => "compiled"
```

`classifyTier` logic: below `minSamples` → `compiled`; trailing
`rehabilitateAfterCleanRuns` all `matched` → step down toward `compiled`; else
`deoptRateEwma >= retireDeoptRate` → `retired`, `>= probationDeoptRate` →
`probation`, else `compiled`. This is the runtime-adaptive behavior: the boundary
contracts/recovers as the EWMA moves, with a floor against noise.

New events: add `"replay.segment.tier"` and `"replay.deterministic.skipped"` to
the `ReplayEvent.kind` union (`runtime/common/src/types.ts:100`) plus an optional
`tier?: SegmentTier` field.

Slot into `segment()` (`runtime/common/src/flow.ts:66`) after the precondition
`ensure` and before the deterministic block:

```ts
const tier = this.options.tierFor?.(segment.id) ?? "compiled";
if (this.options.tierFor) {
  await this.emit({ kind: "replay.segment.tier", segmentId: segment.id, tier });
}
const retire = tier === "retired" && this.policy !== "disabled" && !!segment.fallback;
if (retire) {
  await this.emit({ kind: "replay.deterministic.skipped", segmentId: segment.id, phase: "deterministic" });
  // skip segment.deterministic(); do NOT set deterministicFailure
} else {
  // existing deterministic try/catch block, unchanged (compiled AND probation run it)
}
await this.ensure(segment, "postcondition", segment.postcondition, idempotency, []);
```

Safety arguments:

1. `retired` **only skips `deterministic()`.** The postcondition `ensure` still
   settles and, on mismatch, drives the bounded fallback exactly as today. If
   the compiled action was actually needed, the postcondition mismatches → agent
   recovers → same `matched` gate. If the agent also cannot satisfy it,
   `FallbackFailedError` still throws. Retirement cannot mask a real regression.
2. Retirement auto-disarms when unsafe: `policy === "disabled"` or no
   `segment.fallback` → `retire = false` → deterministic still runs.
3. `probation` executes identically to `compiled` (observation only). With no
   `tierFor`, no tier/skip events are emitted, so existing event-order
   assertions are undisturbed.

Benchmark wiring: `tierFor: (id) => classifyTier(store.get(id), policy)`, with
`policy` a `RetirementPolicy` literal at the benchmark boundary — thresholds are
never baked into the flow.

## 6. Deliverable E — Offline recompile advisor (complements the runtime loop)

New `skills/compile-device-recording/scripts/recompile-advisor.mjs`; update
`skills/compile-device-recording/SKILL.md` and its `CHANGELOG.md`.

- Plain Node ESM in the style of `extract-segment.mjs` / `summarize-recording.mjs`
  (argv parsing, `node:fs/promises`, JSON to stdout, no dependencies). Usage:
  `node .../recompile-advisor.mjs <segment-profile.json> [--result <result.json> ...] [--retire-rate 0.6]`.
- Reads the `ProfileStoreFile` artifact; optionally reads run `result.json`
  files whose `events[]` contain `replay.fallback.completed` with
  `fallbackResult.corrective`.
- Per segment: report tier (reuse `classifyTier` thresholds), `deoptRateEwma`,
  `hotness`, `stability`, `recentOutcomes`, `lastCorrectiveRefs`. Flag retired
  and hot-deopting segments and surface their corrective demonstrations (action
  kinds + evidence refs) as candidate re-selection ranges, mapping an
  `evidenceRef` back to an `extract-segment.mjs --from/--to` range.
- Advisory only: it recommends; it never regenerates code. SKILL.md gains a step
  (after step 9): when prior runs produced a `segment-profile.json`, run the
  advisor to identify retired/hot-deopting segments and review corrective
  demonstrations as candidate re-selection ranges before recompiling.
  Recompilation stays human/agent-approved; never auto-generate from telemetry.

Division of labor: D protects speed *during* a run (retire chronically missing
segments so they stop wasting the compiled attempt). E, *offline*, uses the
accumulated profile + correctives to redraw the boundary more accurately
(re-select spans and recompile). Both share the same `classifyTier` thresholds.

## 7. Deliverable F — Test plan (vitest, colocated)

Modify `runtime/common/test/flow.test.ts`:

- Line 117 `toEqual`: add `segments: [],` (the one required fix).
- Profiler accumulation: two segments with injected `now`/`delay`; assert
  `diagnostics().segments` has 2 entries in order, correct per-phase
  `captureDurationMs`, `attempts`, and `fallback.count`/`outcomes`.
- Retirement skips deterministic but keeps the gate: `tierFor: () => "retired"`,
  `policy: "recover"`, fallback present, a mismatched-then-matched verify
  sequence; assert the `deterministic` `vi.fn()` was not called, events contain
  `replay.deterministic.skipped`, fallback ran, and `replay.segment.completed`
  still emitted.
- Retirement cannot mask a real bug: retired + fallback returning
  `{ status: "failed" }` and a postcondition that never matches ⇒
  `await expect(...).rejects.toBeInstanceOf(FallbackFailedError)`.
- Default unchanged: no `tierFor`; assert deterministic runs and no tier/skip
  events appear.
- `onSegmentProfiled` hook: spy receives a `SegmentProfile` and corrective array.

New `runtime/common/test/profile-store.test.ts`:

- `load` with injected `readFile` rejecting ENOENT ⇒ empty store.
- `record` across N runs with injected `now` ⇒ assert EWMA / hotness /
  stability math and the `recentOutcomes` window cap.
- `classifyTier` transitions: below `minSamples` ⇒ compiled; rising deopt rate ⇒
  probation ⇒ retired; trailing clean runs ⇒ rehabilitate.
- `save` read-merge-write: injected `writeFile` capturing output; a concurrently
  present segment on "disk" is preserved (not clobbered).

Extend `runtime/midscene-fallback/test/fallback.test.ts`:

- Keep the existing `toEqual({ status: "completed", actionCount: 0 })` (proves
  `corrective` is omitted when no actions).
- When the progress listener fires action events, `result.corrective` is
  populated with normalized actions and contains no raw values / screenshot /
  model-reasoning strings.

`runtime/common/test/replay-contract.test.ts` already uses `toMatchObject` and is
unaffected.

## 8. Deliverable G — Phasing and risk

PR 1 — foundation (no behavior change): A + B + C. Risk: the single additive
break at `flow.test.ts:117` (fixed); potential write contention in
`ProfileStore.save` (mitigated by read-merge-write + injected fs in tests).
Invariant: the deterministic path and event stream are byte-for-byte unchanged,
diagnostics is a strict superset, and nothing consults the profile to make
decisions yet.

PR 2 — runtime-adaptive retirement (the only behavior change): D + E. Risks and
mitigations: premature retirement on noise → `minSamples` floor + EWMA +
rehabilitation; retirement in fail-closed configs → auto-disarmed unless
`policy !== "disabled"` and a fallback exists; event-order regressions → tier/skip
events only when `tierFor` is supplied. Invariant: the postcondition checkpoint
remains the sole acceptance oracle.

## 9. Open questions

1. Default tuning constants (EWMA alpha 0.3, window 20, retire 0.6, probation
   0.25, minSamples 5, rehabilitate 3) need calibration against the iOS/Android
   benchmarks.
2. The `evidenceRef → recording artifact path → extract-segment range` mapping
   convention the advisor relies on.
3. Whether guard cost should be an independent tier signal (e.g. "the guard is
   more expensive than the action it protects" also triggers a downgrade), given
   `formal-result-summary.json` shows checkpoint capture at ~84% of replay time,
   or whether deopt rate alone is enough.

## 10. Expected effect / before–after

The value of this loop is not "the happy path gets faster". On a clean run it is
inert. The gains show up as attribution (PR1) and as drift resilience (PR2).

### 10.1 PR1 — attribution you cannot get today

Today `diagnostics()` returns only global aggregates. From the real
`formal-result-summary.json`:

```jsonc
// before (today): global only
"replayDiagnostics": {
  "strategy": "deterministic",
  "fallbackCount": 0,
  "checkpointCaptureDurationMs": 15308,  // ~84% of the 18282 ms replay
  "checkpointSettleDelayMs": 405,
  "checkpointTimeoutCount": 0
}
```

You know 84% of replay time is spent verifying guards, but not which segment, or
pre vs post. After PR1 each replay also emits a `segment-profile.json`. The
segment ids and per-segment values below are illustrative (the real profiler
does not exist yet, so this subdivision is not yet measured); the totals are
anchored to the real `checkpointCaptureDurationMs: 15308` for this same
`android-world-browser-maze` run:

```jsonc
// after (PR1): per-segment attribution (illustrative subdivision of the real 15308 ms)
{
  "recordingId": "android-world-browser-maze",
  "segments": {
    "maze-step-1": {
      "guardMsEwma": 2100, "deoptRateEwma": 0.0, "hotness": 1.0, "stability": 1.0,
      "recentOutcomes": ["matched", "matched", "matched"]
    },
    "maze-step-final": {
      "guardMsEwma": 13200,          // <- the bulk of the 15308 ms is concentrated in this post-checkpoint
      "deoptRateEwma": 0.0, "hotness": 1.0, "stability": 1.0
    }
  }
}
```

Effect: "checkpoint capture is slow" becomes "optimize `maze-step-final`'s
postcondition capture" — a target instead of a guess. This directly serves the
README roadmap item of reducing checkpoint overhead. No execution behavior
changes in this phase.

### 10.2 PR2 — the app drifts, the engine stops losing (without lowering the bar)

Only visible when a segment starts to deopt (UI drift). On a zero-deopt run it
does nothing.

Scenario: an app update invalidates `maze-step-final`'s coordinates, so several
replays need the agent fallback to pass that segment.

- Before: every replay first attempts the now-dead deterministic tap → the
  postcondition necessarily mismatches → then waits for fallback. The failed
  compiled attempt plus the guard timeout are paid every single run.
- After: once `deoptRateEwma >= 0.6`, `classifyTier` marks the segment `retired`
  → the next replay skips the dead tap and hands straight to the agent, saving
  the "attempt + wait for mismatch" cost. When the app stabilizes and three
  consecutive clean `matched` runs accrue, the segment rehabilitates to
  `compiled`.

Observable products:

```jsonc
// event stream during drift
{ "kind": "replay.segment.tier", "segmentId": "maze-step-final", "tier": "retired" }
{ "kind": "replay.deterministic.skipped", "segmentId": "maze-step-final", "phase": "deterministic" }
```

The most important guarantee, and what separates this from blind self-healing: a
retired segment must still pass the same postcondition checkpoint. If the agent
also cannot satisfy it, `FallbackFailedError` still throws. The effect is
"hand control back to the agent faster during drift", never "skip the check so
it turns green". A real regression still fails red.

### 10.3 PR3 side effect — recompilation gets a data basis

`recompile-advisor.mjs` reads that profile and says, in effect: "`maze-step-final`
is retired; the last few corrective demonstrations cluster near new coordinates;
consider re-selecting `--from 150 --to 170` and recompiling." You stop guessing
which span to re-record.

### 10.4 Honest boundaries (what will not happen)

- The stable happy path does not get faster. On the `fallbackCount: 0` run above,
  PR2 changes nothing and the 26.18x speedup holds. Gains materialize only under
  drift or polymorphism.
- A single run shows no adaptation. Tier decisions use cross-run EWMA plus a
  `minSamples` floor; the first run only samples.
- No automatic codegen. At runtime the engine only skips a dead path and defers
  to the agent; actual code changes remain offline and human/agent-approved.

## 11. Extension — state-graph JIT (forward-looking, PR3+)

The linear model above assumes one recorded path. Real apps are graphs: record
the same app several times, or go forward/back, and one UI reaches many others
(ui1 → ui12, ui13, ...). The generalization is to stop treating a replay as a
chain of segments and start treating the app as a **state machine** whose edges
are compiled transitions. The linear replay is then just a degenerate line
through this graph.

### 11.1 The three APIs this needs

1. `identify(snapshot) -> StateMatch` — fingerprint the live UI and decide which
   known state we are in (or that we are somewhere unknown). This is the JIT OSR
   entry resolver: "where in the compiled graph am I right now?"
2. `nextStates(stateId) -> StateTransition[]` — enumerate the outgoing compiled
   edges from the current state. This is the menu of "known next states you can
   JIT to".
3. `transition(flow, edgeId)` — run the fixed JIT for one edge. The intermediate
   operations are the compiled deterministic action; the guard confirms arrival.
   On mismatch, control returns to the agent (the interpreter).

Control loop (agent-facing), which is exactly the behavior described:

```text
loop:
  snapshot = await tree.capture()
  match    = engine.identify(snapshot)
  if match.status == "known":
      options = engine.nextStates(match.stateId)   // list the next-state options
      if agentTarget ∈ options and tier(edge) != "retired":
          await engine.transition(flow, edge)      // intermediate ops = fixed JIT
          continue
  // unknown / ambiguous / target-not-in-graph => agent explores (interpreter),
  // and a successful traversal is recorded back as a new/strengthened edge.
  await agent.act(...)
```

### 11.2 Types (new `runtime/common/src/state-graph.ts`)

Reuse what already exists: `canonicalTreeHash` and `TreeSnapshot` /
`SemanticNode` / `SemanticSelector` (`runtime/common/src/observation.ts:187,50,29,62`),
`DevicePlatform` (`runtime/common/src/device.ts:1`), `ReplaySegment` and
`SegmentTier` (`runtime/common/src/types.ts:91`, this doc §5).

```ts
// A coarsened, drift-tolerant signature of a UI state. Full canonicalTreeHash
// is too brittle — any dynamic text/value would mint a new state. The signature
// hashes only a *landmark projection* of the tree (roles + stable names/testIds;
// text, values, and bounds dropped).
export type StateSignature = {
  platform: DevicePlatform;
  appId: string;                 // bundle id / package name
  structuralHash: string;        // canonicalTreeHash over the landmark projection
  landmarks: SemanticSelector[]; // stable selectors that must be present
};

export type StateId = string;

export type StateNode = {
  id: StateId;
  signature: StateSignature;
  label?: string;                // e.g. "settings.general"
  observedCount: number;
  evidenceRefs?: string[];       // representative screenshot / AX refs
};

export type StateTransition = {
  id: string;                    // edge id == the ReplaySegment id (so the
                                 // profiler/tier/retirement machinery keys on it)
  from: StateId;
  to: StateId;
  segment: ReplaySegment<unknown>; // precondition = "in `from`", postcondition = "arrived at `to`"
  tier?: SegmentTier;            // rolling reliability from ProfileStore
  observedCount: number;
};

export type StateGraph = {
  schemaVersion: 1;
  platform: DevicePlatform;
  appId: string;
  nodes: Record<StateId, StateNode>;
  edges: Record<string, StateTransition>;
  outgoing: Record<StateId, string[]>; // adjacency: from -> edge ids
};

export type StateMatch =
  | { status: "known"; stateId: StateId; confidence: number }
  | { status: "ambiguous"; candidates: StateId[] } // >1 plausible => defer to agent
  | { status: "unknown" };                          // 0 matches => defer to agent

export class StateGraphEngine {
  static load(options: { path: string; platform: DevicePlatform; appId: string }): Promise<StateGraphEngine>;
  identify(snapshot: TreeSnapshot): StateMatch;
  nextStates(from: StateId): StateTransition[];
  transition(flow: ReplayFlow<unknown, unknown>, edgeId: string): Promise<void>;
  observeTransition(from: StateId, to: StateId, segment: ReplaySegment<unknown>): void; // grow the graph
  save(): Promise<void>;
}
```

### 11.3 Why this drops cleanly onto A–E

- **An edge is a segment.** `StateTransition.segment` is an ordinary
  `ReplaySegment` whose precondition asserts "in the from-state" and whose
  postcondition asserts "arrived at the to-state". So `transition()` just runs
  it through `ReplayFlow.segment()` — the profiler (A), captured correctives (B),
  `ProfileStore` (C), and retirement (D) all apply **per edge** with zero new
  machinery. A retired edge = "this transition is unreliable, don't JIT it, let
  the agent do it", gated exactly by `classifyTier(store.get(edgeId))`.
- **Graph construction merges recordings.** Two recordings that pass through the
  same signature share a node; their differing next steps become multiple
  outgoing edges — that is the ui1 → ui12, ui13 branching. Forward/back are just
  edges in both directions. `observeTransition` is how a successful agent
  traversal (interpreter path) is compiled into a new edge — the JIT "compile a
  newly hot path" step.
- **The advisor (E) extends naturally**: retired/hot-deopting *edges* become the
  re-selection candidates, and unknown states that the agent keeps visiting are
  candidates for new recordings.

### 11.4 Correctness invariants specific to the graph

1. **Conservative identification.** A wrong `StateId` would send the JIT down the
   wrong edge — a correctness hazard. `identify()` returns `known` **only** on a
   single high-confidence landmark match; 0 matches → `unknown`, >1 → `ambiguous`;
   both defer to the agent. The engine never claims a state it is not sure of.
2. **The arrival guard is unchanged.** `transition()` still requires the edge's
   postcondition checkpoint to reach `matched`. A JIT edge that no longer works
   (drift) mismatches → agent takes over → the same edge-level retirement kicks
   in. State-graph JIT still cannot self-heal past a real regression.
3. **The signature is the central open problem.** Landmark-projection coarsening
   decides how many distinct states exist; too fine mints a state per dynamic
   value, too coarse merges genuinely different screens. A proposed starting
   heuristic: project to `{role, testId, stableName}` and drop text/value/bounds,
   then `canonicalTreeHash` the projection; tune per platform. This deserves its
   own spike before committing.

### 11.5 Phasing

This is a separate track after PR1/PR2, and depends on them (it reuses the
profiler and `ProfileStore` per edge). Suggested order: (PR3) `StateSignature` +
`identify()` spike with a fixed two-recording fixture, correctness-gated to
"identify or defer"; (PR4) `StateGraph` persistence + `nextStates()` +
`transition()` reusing `ReplayFlow`; (PR5) `observeTransition()` graph growth and
advisor integration. Each phase keeps the arrival-guard and conservative-identify
invariants above.
