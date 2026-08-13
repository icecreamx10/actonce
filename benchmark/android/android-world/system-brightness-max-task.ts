import type { AndroidAgent, AndroidDevice } from "@byted-lynx/actonce-midscene-adapter";
import type { RecordingTaskContext } from "../../../interceptor/src/recording-profiles.js";

/** The goal and initial state come from AndroidWorld's SystemBrightnessMax. */
export default async function run(
  context: RecordingTaskContext<AndroidAgent, AndroidDevice>,
): Promise<void> {
  await context.device.launch("com.android.settings");
  await context.agent.aiAct("Turn brightness to the max value.", {
    abortSignal: AbortSignal.timeout(300_000),
  });
}
