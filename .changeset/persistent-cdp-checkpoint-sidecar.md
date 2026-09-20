---
"@byted-lynx/actonce": minor
"@byted-lynx/actonce-cdp": minor
---

Publish the long-lived external CDP checkpoint sidecar and expose it through
the top-level `actonce checkpoint serve-stdio` command for products that own
their CDP connection. Include a DOM-independent `ping` handshake so suite
setup can prestart the service before the first real page checkpoint.
