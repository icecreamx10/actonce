# @byted-lynx/actonce

Complete ActOnce distribution. It provides platform-specific API subpaths, recording and replay CLIs, and installation of the two bundled agent skills.

```bash
npm install @byted-lynx/actonce --registry=http://bnpm.byted.org
npx actonce skill install record-device-use
npx actonce skill install compile-device-recording
```

Import platform APIs without loading another platform at runtime:

```ts
import { ReplayFlow } from "@byted-lynx/actonce/replay";
import { replayMacPrimitive } from "@byted-lynx/actonce/macos";
import { replayIOSPrimitive } from "@byted-lynx/actonce/ios";
import { replayAndroidPrimitive } from "@byted-lynx/actonce/android";
```
