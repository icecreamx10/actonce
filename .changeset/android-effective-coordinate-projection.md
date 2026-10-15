---
"@byted-lynx/actonce-android": patch
---

Project native Android coordinate actions using effective physical dimensions and the rounded logical viewport independently per axis. Prefer explicit wm size/density overrides, validate geometry, and refresh the cached projection at connection and public size reads without per-action device queries.
