import type { AndroidAgent, AndroidDevice } from "@byted-lynx/actonce-midscene-adapter";
import type { RecordingTaskContext } from "../../../interceptor/src/recording-profiles.js";
import { configureAndroidWorldTask } from "./task-instruction.js";

export default async function run(
  context: RecordingTaskContext<AndroidAgent, AndroidDevice>,
): Promise<void> {
  const goal = configureAndroidWorldTask(context.device);
  const timeoutMs = Number(process.env.ACTONCE_ANDROID_WORLD_TASK_TIMEOUT_MS ?? 600_000);
  await context.agent.aiAct(goal, { abortSignal: AbortSignal.timeout(timeoutMs) });
}
