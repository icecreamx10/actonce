---
"@byted-lynx/actonce-android": patch
---

Preserve recorded targetless Android Input as caret insertion instead of clearing existing text. Lower replacement only for a located target and honor explicit append/replace:false. Keep explicitly authored native primitive replacement unchanged and add lowering-to-dispatch regression coverage.
