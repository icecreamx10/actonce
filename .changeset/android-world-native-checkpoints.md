---
"@byted-lynx/actonce-android": minor
"@byted-lynx/actonce-recorder": minor
"@byted-lynx/actonce-replay": minor
---

Add native Android recording and checkpoint support for Skill-compiled replay, including a persistent shared UIAutomator2 source for Midscene and recorder checkpoints, separate capture/settle diagnostics, Midscene-compatible replace/keyboard and package-launch semantics, and Skill-verified unique element clicks with recorded-coordinate fallback. AndroidWorld deliberately leaves semantic synthesis to `synthesize-device-replay`; benchmark scripts no longer infer accessibility targets from coordinates. Package launches resolve the device's launcher component at runtime and use explicit Android launcher flags instead of an unchecked package-only intent. Observe-before-retry segments can register one bounded deterministic retry after a failed postcondition, with retry metrics kept separate from AI fallback.
