import { readFile } from "node:fs/promises";
import { replayAndroidPrimitive, type AndroidReplayScript } from "@byted-lynx/actonce-android";
export const config = { appNameMapping: { camera: "com.android.camera2" } };
export default (async ({ android, flow }) => {
  const plan = JSON.parse(await readFile(new URL("./replay-plan.json", import.meta.url), "utf8"));
  for (const segment of plan.segments) {
    await flow.segment({ id: segment.id, precondition: segment.precondition, postcondition: segment.postcondition,
      idempotency: segment.idempotency, deterministic: () => replayAndroidPrimitive(android, segment.action) });
  }
}) satisfies AndroidReplayScript;
