import type { AndroidAgent, AndroidDevice } from "@byted-lynx/actonce-midscene-adapter";
import type { RecordingTaskContext } from "../../../interceptor/src/recording-profiles.js";

export default async function run(
  context: RecordingTaskContext<AndroidAgent, AndroidDevice>,
): Promise<void> {
  const goal = process.env.ACTONCE_ANDROID_WORLD_GOAL;
  if (!goal) throw new Error("ACTONCE_ANDROID_WORLD_GOAL is required");
  const timeoutMs = Number(process.env.ACTONCE_ANDROID_WORLD_TASK_TIMEOUT_MS ?? 600_000);
  await context.agent.aiAct(goal, { abortSignal: AbortSignal.timeout(timeoutMs) });
}
