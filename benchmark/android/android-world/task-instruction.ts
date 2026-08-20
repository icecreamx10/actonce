import type { AndroidDevice } from "@byted-lynx/actonce-midscene-adapter";

type TaskApp = { name: string; package?: string | null };

export function configureAndroidWorldTask(device: AndroidDevice): string {
  const goal = process.env.ACTONCE_ANDROID_WORLD_GOAL;
  if (!goal) throw new Error("ACTONCE_ANDROID_WORLD_GOAL is required");
  const apps = parseApps(process.env.ACTONCE_ANDROID_WORLD_APPS);
  device.setAppNameMapping(Object.fromEntries(
    apps.flatMap((app) => app.package ? [[normalizeAppName(app.name), app.package]] : []),
  ));
  const initialApp = apps.find((app) => app.package);
  if (!initialApp?.package) return goal;
  const additionalApps = apps.filter((app) => app !== initialApp);
  const setupInstruction = additionalApps.length === 0
    ? `The benchmark has already opened the target app "${initialApp.name}". Continue from the current screen; do not return Home or relaunch this app.`
    : [
        `The benchmark has already opened the initial target app "${initialApp.name}". Continue from the current screen.`,
        `If the task requires another app, use Launch with its exact logical name: ${additionalApps.map((app) => `"${app.name}"`).join(", ")}. Do not search the Launcher manually.`,
      ].join(" ");
  return [
    setupInstruction,
    goal,
  ].join("\n");
}

// Midscene normalizes lookup input but intentionally expects mapping keys to
// already be normalized. Keep this in sync with @midscene/shared's contract.
function normalizeAppName(name: string): string {
  return name.toLowerCase().replace(/[\s\-_]+/g, "");
}

function parseApps(raw: string | undefined): TaskApp[] {
  if (!raw) return [];
  const value = JSON.parse(raw) as unknown;
  if (!Array.isArray(value)) throw new Error("ACTONCE_ANDROID_WORLD_APPS must be a JSON array");
  return value.filter((item): item is TaskApp => (
    typeof item === "object" && item !== null && typeof (item as TaskApp).name === "string"
  ));
}
