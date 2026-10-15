# `@byted-lynx/actonce-android`

Deterministic Android replay runtime for ActOnce-generated scripts.

### Explicit logical app names

Keep the original recorded `Launch` URI in primitives/plans. When it is a logical
name rather than a package, the caller must supply an evidence-backed mapping:

```ts
await executeAndroidPlan(plan, {
  session: { appNameMapping: { dialer: "com.google.android.dialer" } },
});
// Also supported by AndroidSession.connect({ appNameMapping: ... }) and
// runAndroidScripts(paths, { session: { appNameMapping: ... } }).
```

Names resolve exactly first, then by trimming, collapsing whitespace and
lowercasing. The entire mapping is validated and copied before connection:
empty names, invalid packages, accessors and duplicate normalized names fail
closed (even when their targets agree). Direct package names remain unchanged;
mapping keys cannot redirect a package. Unknown aliases fail without fuzzy
matching, app enumeration, or AI dependencies. The example is not a built-in
alias: use the package established by the original run's evidence.

It connects to one explicit ADB device, mechanically lowers recorded Android actions to fixed primitives, and gates replay segments with Android accessibility-tree and screenshot checkpoints. The runtime starts one persistent Appium UIAutomator2 server per replay session and reads `/source` from that process; it does not invoke a cold `uiautomator dump` for every checkpoint and does not depend on Midscene. A successful postcondition is reused as the next adjacent precondition until a primitive invalidates the observation.

Source reads disable UIAutomator2's implicit idle wait and still refresh its
accessibility/window caches on each capture. A fresh snapshot may show a
transition: callers must retain bounded checkpoint polling and stability checks,
not assume the first read is settled. Deadlines are not extended to hide slow
capture; `captureDurationMs` and `settleDelayMs` remain separate metrics.

Each checked observation also reports monotonic `actual.captureTiming` stages:
`sourceDurationMs`, `screenshotDurationMs`, and `visualComparisonDurationMs`.
Unattempted stages are omitted; source reads may use the adjacent-observation cache.
Comparison includes reference loading and pixel processing, not device capture.
These diagnostics do not change deadlines, freshness, or checkpoint semantics.

Coordinate taps and swipes use native Android `input swipe` injection, while
UIAutomator2 remains the persistent observation service and unique-node click
provider. `device.tap(point, durationMs?)` has an explicit 150-ms default press;
swipes retain their recorded duration (300 ms when absent). Explicit neutral
recorded tap durations are lowered and dispatched unchanged. The default press
preserves the pinned original device's implicit hold rather than a zero-duration
W3C down/up; it does not establish fixture or UI-consumption equivalence by itself.

Visual checkpoints may specify `visual.anchor: { selector, referenceSourcePath }`
alongside an explicit `visual.region`. The runtime resolves a unique native node
in each recorded/live tree and translates the live crop by its physical-pixel
displacement. Missing, ambiguous, hidden, disabled, resized or invalid anchors
fail closed. It never searches pixels, rescales content, uses OCR, or relaxes the
threshold; `actual.visual` records both crop regions. The agent must prove the
landmark and visual fact share one rigid content container from the action's own
evidence, and reject the nearest negative state. Anchoring localizes pixels; a
native label never substitutes for screenshot-only correctness. Source and
screenshot are bounded observations, not an atomic snapshot; settling still applies.

```bash
actonce-android doctor --serial emulator-5554
actonce-android compile-primitives recordings/<id> --output replay.ts
actonce-android run replay.ts --serial emulator-5554
```

Generated code must use `replayAndroidPrimitive`; do not inline ADB commands. Coordinates are normalized logical points. The native backend derives the rounded logical viewport from effective `wm size` and density (explicit overrides take precedence), then projects each axis using physical extent / logical extent. Geometry is cached at connection and refreshed by `size()`, never per action; invalid geometry fails closed. Refresh `size()` after display configuration changes. This is not automatic rotation tracking. Native selector matching/clicks remain unchanged; exported native-tree bounds retain their density-based conversion and are not a replacement coordinate projection contract.

`sleep(timeMs)` preserves an explicitly selected recorded dwell, for example while
capturing media. Primitive lowering no longer silently deletes `Sleep` actions.
The agent decides whether a wait is semantically necessary or can instead be
replaced by evidenced bounded settling; the lowerer never makes that decision.
Retained dwell keeps its exact integer duration (0–2147483647 ms, no timer
overflow/clamping), invalidates observations, and remains inside measured replay
execution time. It does not replace the action's required before/after checkpoints.

`typeText` preserves Midscene's Android replace and keyboard-dismiss semantics,
including a bounded three-second IME dismissal observation window before trying
the guarded secondary key path.
For recorded `Input`, clearing is lowered only when a target was located and
replacement was not disabled. Targetless input inserts at the current caret,
even when its normalized mode is `replace`; existing text must be preserved.
This does not change an explicitly authored `typeText` primitive with
`replace: true`, which can deliberately clear an already-focused field.
`launchApp` preserves package-level activation semantics by resolving the
device's launcher component at runtime and starting it explicitly. Generated
replays keep the recorded package name and never hard-code a development-device
activity.
The compile Skill may emit `tapUniqueNode` only after proving a selector unique
and semantically aligned from recorded evidence; the primitive performs a native
UIAutomator2 element click and retains the normalized recorded coordinate as its
fallback. Mechanical primitive compilation never invents this mapping.
For an `observe-before-retry` selector segment, the common replay flow can execute
the recorded coordinate once as `deterministicRetry` only after the selector action's
postcondition times out. Retry count and duration are reported separately from AI
fallback.

`replayCheckpointGatedAndroidRecording` executes mechanically compiled steps
with screenshot-first settling and recorded native-node evidence when raster
state is ambiguous. It reuses a matched postcondition as the
adjacent precondition, and reports screenshot capture, source capture, actual
settle delay, skipped actions, and fallback separately.
