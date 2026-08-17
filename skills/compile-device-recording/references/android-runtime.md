# Android replay target

Generate Android replay fragments for `@byted-lynx/actonce-android`. Select and reset the ADB device outside generated fragments; let the runner own connection and cleanup.

## Lower recorded actions

```bash
actonce-android compile-primitives <recording-or-segment> --output recorded-input.js
```

Use the normalized logical coordinates from completed Midscene actions. Do not copy physical screenshot pixels or inline `adb shell input`. Unknown actions fail closed.

Keep those recorded coordinates as the default tap implementation. Do not automatically replace a coordinate because it happens to overlap an accessibility node. An agent may optimize a tap to a native selector only after checking uniqueness, action-description alignment, ancestor/context identity, and transient-layer coverage, then proving the mapping through fresh-fixture replay. Preserve the coordinate primitive as the fallback. If the relevant popup, canvas, WebView, or overlay is absent from the native tree, use the recorded coordinate.

Use `tapUniqueNode` only for that Skill-owned optimization. Cite the before-action
native artifact that proves the selector has exactly one match, include class plus a
semantic field where possible, and pass the normalized recorded coordinate as its
fallback. `tapUniqueNode` performs a real UIAutomator2 element click; do not emulate
it by finding node bounds and sending another coordinate event.
When the selector click can report success without satisfying its recorded
postcondition, mark the segment `observe-before-retry` and register the original
coordinate as its single `deterministicRetry`; let `ReplayFlow` gate and diagnose it.

Treat Android `Input` as a compound recorded primitive. Midscene's default replace
mode deletes on both sides of an unknown cursor position (up to 100 characters), and
its default input behavior dismisses a visible software keyboard after typing. Verify
that the shared runtime preserves both semantics before blaming later coordinates.
Fix missing parity in the runtime, never by adding unrecorded Back/Delete calls to a
case-specific generated script.
Do not monkeypatch `android.device`, override runtime methods, or inline a different
keyboard timeout in generated replay. If the shared bounded dismissal behavior is
insufficient, repair and test the published runtime first, then recompile from the
immutable recording.

Preserve Android `Launch` as `launchApp(recordedPackage)` and require its recorded
after-checkpoint. Let the shared runtime resolve the component; never hard-code a
development-device activity in generated replay.

## Guarded fragments

Compose `replayAndroidPrimitive` calls with `flow.segment`. Guard state transitions with Android UI-tree expectations only when a relevant `checkpoint.captured` native UI artifact supports the fact. A screenshot-backed Midscene Assert/Boolean/Query remains visual even when an Android UI tree exists nearby.

Do not turn every `checkpoint.captured` screenshot into a pixel oracle. Recorder
checkpoints intentionally capture both screenshot and native UI around every action;
for ordinary intermediate states, extract the smallest stable native facts that prove
the transition. Use visual comparison only when the requested oracle is itself visual
or the necessary state is absent from native UI. Crop out cursors, touch overlays,
toasts, clocks, and unrelated animation, and prove the crop rejects the nearest
recorded negative state before execution.

Android popup windows may be visible in the recorded screenshot while absent from a
live persistent UIAutomator2 source. For a transition that opens such a popup, settle
on the smallest recorded screenshot crop that contains distinguishing options; do not
wait for source text the live service cannot expose. After selecting an option, prefer
a stable semantic field on the owning form over asserting that an off-screen Spinner
remains in the current source. Validate the crop against the nearest closed state and
require consecutive visual matches.

The Android checkpoint driver reuses a matched postcondition as the immediately adjacent precondition while no primitive has run. Every primitive invalidates that observation before acting, so do not add fixed sleeps or duplicate source reads between segments.

For the initial fresh-fixture pass, schedule every selected primitive once and in
source order. Do not scan later postconditions or the case-final oracle to decide that
intermediate work can be skipped. `observe-before-retry` permits checking only the
same primitive's immediate postcondition after that primitive has already been
attempted. Cleanup may be skipped only when that cleanup primitive's own recorded
postcondition already matches.

Treat the benchmark fixture reset and public task/oracle as contracts. Generate a new
replay from the selected recording; do not copy an existing case-specific replay.
Guard cleanup/retry primitives individually and skip remaining calls once the final
recorded state matches.

When a checkpoint carries multiple necessary facts, require all of them. A focused
node is not a substitute for a separately recorded label, value, or visual outcome.

## Verification

```bash
actonce-android doctor --serial emulator-5554
actonce-android run setup.js actions.js assertions.js --serial emulator-5554
```

Reset the app before every attempt. Require the recorded semantic outcome, final screenshot/native state, fallback count, and cleanup state to pass. Preserve failures and repeat the complete fresh-state case until two consecutive runs pass or a concrete blocker is established.

If runtime checkpoints fail but the official validator passes, the replay is still a
development failure. Inspect the actual captured source/screenshot: replace an
unobservable or over-specific field only with an equivalent fact supported by the
recording and live evidence, then rerun. Never accept official reward alone and never
weaken the semantic outcome.
