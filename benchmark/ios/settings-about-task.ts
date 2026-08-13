import type { IOSAgent, IOSDevice } from "@midscene/ios";
import type { RecordingTaskContext } from "../../interceptor/src/recording-profiles.js";

/** Canonical AI demonstration consumed by the fixed midscene-ios recorder profile. */
export default async function run(
  context: RecordingTaskContext<IOSAgent, IOSDevice>,
): Promise<void> {
  await context.device.terminate("com.apple.Preferences").catch(() => undefined);
  await context.device.launch("com.apple.Preferences");
  await resetToSettingsRoot(context.device);
  await context.agent.aiAct(
    "In Settings, tap 通用 (General), then tap 关于本机 (About). Stop when the About page is visible. Do not change any setting or open another app.",
    { abortSignal: AbortSignal.timeout(300_000) },
  );
  await context.agent.aiAssert(
    "The About page is open and visibly shows the device name, iOS version, and model name.",
  );
}

async function resetToSettingsRoot(device: IOSDevice): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await device.runWdaRequest<unknown>("GET", "/source");
    const source = typeof response === "string" ? response : JSON.stringify(response);
    if (source.includes("com.apple.settings.general")) return;
    if (!source.includes('name=\"BackButton\"')) break;
    await device.tap(25, 59);
  }
  const response = await device.runWdaRequest<unknown>("GET", "/source");
  if (!JSON.stringify(response).includes("com.apple.settings.general")) {
    throw new Error("Could not normalize Settings to its root page before the AI demonstration");
  }
}
