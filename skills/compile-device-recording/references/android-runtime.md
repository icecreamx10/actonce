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

Treat Android `Input` as a compound recorded primitive. Midscene's default replace
mode deletes on both sides of an unknown cursor position (up to 100 characters), and
its default input behavior dismisses a visible software keyboard after typing. Verify
that the shared runtime preserves both semantics before blaming later coordinates.
Fix missing parity in the runtime, never by adding unrecorded Back/Delete calls to a
case-specific generated script.

## Guarded fragments

Compose `replayAndroidPrimitive` calls with `flow.segment`. Guard state transitions with Android UI-tree expectations only when a relevant `checkpoint.captured` native UI artifact supports the fact. A screenshot-backed Midscene Assert/Boolean/Query remains visual even when an Android UI tree exists nearby.

Android popup windows may be visible in the recorded screenshot while absent from a
live persistent UIAutomator2 source. For a transition that opens such a popup, settle
on the smallest recorded screenshot crop that contains distinguishing options; do not
wait for source text the live service cannot expose. After selecting an option, prefer
a stable semantic field on the owning form over asserting that an off-screen Spinner
remains in the current source. Validate the crop against the nearest closed state and
require consecutive visual matches.

The Android checkpoint driver reuses a matched postcondition as the immediately adjacent precondition while no primitive has run. Every primitive invalidates that observation before acting, so do not add fixed sleeps or duplicate source reads between segments.

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
