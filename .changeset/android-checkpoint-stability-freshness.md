---
"@byted-lynx/actonce-android": patch
---

Refresh native source evidence when a checkpoint is verified repeatedly, so consecutive stability matches cannot reuse one cached observation. Preserve matched evidence reuse for distinct adjacent checkpoints until a primitive invalidates it.
