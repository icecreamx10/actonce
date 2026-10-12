---
"@byted-lynx/actonce-android": patch
---

Disable UIAutomator2's implicit idle wait while retaining unconditional accessibility
cache refresh. Checkpoint polling remains responsible for bounded settling and
stability checks; capture latency no longer includes an intentional idle wait.
