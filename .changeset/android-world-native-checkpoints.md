---
"@byted-lynx/actonce-android": minor
"@byted-lynx/actonce-recorder": minor
---

Add native Android recording and checkpoint support for Skill-compiled replay, including a persistent shared UIAutomator2 source for Midscene and recorder checkpoints, separate capture/settle diagnostics, Midscene-compatible replace/keyboard semantics, and Skill-verified unique element clicks with recorded-coordinate fallback. AndroidWorld deliberately leaves semantic compilation to `compile-device-recording`; benchmark scripts no longer infer accessibility targets from coordinates.
