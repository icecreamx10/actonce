import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { replayAndroidPrimitive, type AndroidReplayScript } from "@byted-lynx/actonce-android";

// Relocation-only derivative; the measured module and plan remain byte-identical.
export const config = { appNameMapping: { camera: "com.android.camera2" } };
export default (async ({ android, flow }) => {
  const plan = JSON.parse(await readFile(new URL("./synthesized-v1/replay-plan.json", import.meta.url), "utf8"));
  function relocate(value: unknown): void {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (key === "referencePath" && typeof child === "string") {
        const match = child.match(/(?:^|\/)original\/(artifacts\/[a-f0-9]{2}\/[a-f0-9]{64})$/);
        if (!match) throw new Error("Unknown reference path; refusing relocation");
        (value as Record<string, unknown>)[key] = fileURLToPath(new URL(`./original/${match[1]}`, import.meta.url));
      } else relocate(child);
    }
  }
  relocate(plan);
  for (const segment of plan.segments) {
    await flow.segment({ id: segment.id, precondition: segment.precondition, postcondition: segment.postcondition,
      idempotency: segment.idempotency, deterministic: () => replayAndroidPrimitive(android, segment.action) });
  }
}) satisfies AndroidReplayScript;
