---
"@byted-lynx/actonce-android": patch
---

Quote newline, carriage-return and tab characters in native Android text transport so the remote shell cannot truncate or split the payload. Preserve multiline caret insertion as one input-text command without adding Enter or clearing existing content.
