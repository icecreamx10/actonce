import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { captureRuntimePermissionFixture, restoreRuntimePermissionFixture, type RuntimePermissionFixture } from "./permission-fixture.js";
import { initialTargetPolicy } from "./initial-target.js";

export type PermissionPolicy = "recorded" | "grant-all" | "first-request";
type Adb = (args: string[]) => Promise<string>;
export type StartEnvironment = {
  schemaVersion: 1;
  task: string;
  permissionPolicy: Exclude<PermissionPolicy, "recorded">;
  initialization: "official-task-snapshot";
  device: { api: string; size: string; density: string; navigationMode: string; rotation: string; automaticRotation: string };
  preferences: Record<string, string>;
  permissions: RuntimePermissionFixture;
};

export function permissionPolicy(task: string, explicit?: string, saved?: unknown): PermissionPolicy {
  const persisted = saved as Partial<StartEnvironment> | undefined;
  const value = explicit ?? persisted?.permissionPolicy ?? (task === "CameraTakeVideo" ? "grant-all" : "recorded");
  if (!["recorded", "grant-all", "first-request"].includes(value)) throw new Error(`Invalid permission policy: ${value}`);
  if (persisted && (persisted.schemaVersion !== 1 || persisted.task !== task || persisted.initialization !== "official-task-snapshot"
      || persisted.permissionPolicy !== value)) throw new Error("Start environment contract identity/policy mismatch");
  return value as PermissionPolicy;
}

/** Measurement-external, scoped to task-declared packages. Never reset global permissions. */
export async function normalizeStartEnvironment(task: string, apps: unknown, policy: Exclude<PermissionPolicy, "recorded">, adb: Adb): Promise<StartEnvironment> {
  const { packages } = initialTargetPolicy(task, apps);
  if (!packages.length || packages.some(pkg => !/^[\w]+(?:\.[\w]+)+$/.test(pkg))) throw new Error("No valid task packages for stable setup");
  const api = (await adb(["shell", "getprop", "ro.build.version.sdk"])).trim();
  if (api !== "33") throw new Error(`Stable AndroidWorld setup requires API 33, got ${api}`);
  if ((await adb(["shell", "id", "-u"])).trim() !== "0") throw new Error("Stable setup requires the pinned rooted emulator for app-state verification");
  // The official initializer has already restored app data. Terminate activities
  // before touching permissions, including the target's old permission requester.
  for (const pkg of packages) await adb(["shell", "am", "force-stop", pkg]);
  await adb(["shell", "wm", "size", "reset"]);
  await adb(["shell", "wm", "density", "reset"]);
  await adb(["shell", "settings", "put", "system", "accelerometer_rotation", "0"]);
  await adb(["shell", "settings", "put", "system", "user_rotation", "0"]);
  const device = {
    api,
    size: (await adb(["shell", "wm", "size"])).trim(),
    density: (await adb(["shell", "wm", "density"])).trim(),
    navigationMode: (await adb(["shell", "settings", "get", "secure", "navigation_mode"])).trim(),
    rotation: (await adb(["shell", "settings", "get", "system", "user_rotation"])).trim(),
    automaticRotation: (await adb(["shell", "settings", "get", "system", "accelerometer_rotation"])).trim(),
  };
  if (device.size !== "Physical size: 1080x2400" || device.density !== "Physical density: 420"
      || device.navigationMode !== "2" || device.rotation !== "0" || device.automaticRotation !== "0") throw new Error("Pinned Pixel 6 geometry/navigation/rotation mismatch");
  const preferences: Record<string, string> = {};
  for (const pkg of packages) {
    // Hash only, never publish preference values. Root access is a pinned
    // AndroidWorld environment requirement. A missing directory is explicit.
    const path = `/data/user/0/${pkg}/shared_prefs`;
    const files = await adb(["shell", `if [ -d '${path}' ]; then find '${path}' -type f -name '*.xml' -exec sha256sum {} \\; | sort; else printf 'absent\\n'; fi`]);
    if (files.includes("Permission denied")) throw new Error("Cannot verify restored app preferences");
    preferences[pkg] = createHash("sha256").update(files.trim()).digest("hex");
  }
  const permissions = await captureRuntimePermissionFixture(packages.map(packageName => ({ package: packageName })), adb);
  for (const entry of permissions.packages) {
    for (const name of Object.keys(entry.permissions)) {
      // Revoke first even if already granted: remove one-time grant lifetime,
      // rather than keeping a grant that can expire after force-stop.
      await adb(["shell", "pm", "revoke", "--user", "0", entry.package, name]);
      if (policy === "grant-all") await adb(["shell", "pm", "grant", "--user", "0", entry.package, name]);
      entry.permissions[name] = policy === "grant-all";
      entry.permissionFlags![name] = { "user-set": false, "user-fixed": false };
    }
  }
  await restoreRuntimePermissionFixture(permissions, packages.map(packageName => ({ package: packageName })), adb);
  const actual = await captureRuntimePermissionFixture(packages.map(packageName => ({ package: packageName })), adb);
  if (!isDeepStrictEqual(actual, permissions)) throw new Error("Stable permission baseline did not match");
  return { schemaVersion: 1, task, permissionPolicy: policy, initialization: "official-task-snapshot", device, preferences, permissions: actual };
}

export function verifyStartEnvironment(expected: unknown, actual: StartEnvironment) {
  if (!isDeepStrictEqual(expected, actual)) throw new Error("Start environment differs from original/setup contract; refusing measurement");
}

export function verifyStableForeground(policy: PermissionPolicy, windows: string) {
  if (policy !== "grant-all") return;
  const focused = windows.split("\n").find(line => line.includes("mCurrentFocus=")) ?? "";
  if (/permissioncontroller|GrantPermissionsActivity|\/com\.android\.camera\.PermissionsActivity/.test(focused)) {
    throw new Error("Pregranted setup still has a permission requester in the foreground");
  }
}

export function startEnvironmentParity(original: unknown, replay: unknown) {
  const left = original as { status?: string; permissionPolicy?: string; sha256?: string } | null;
  const right = replay as typeof left;
  const required = left?.status === "verified" || right?.status === "verified";
  const matched = required ? left?.status === "verified" && right?.status === "verified"
    && /^[a-f0-9]{64}$/.test(left.sha256 ?? "") && left.sha256 === right.sha256
    && left.permissionPolicy === right.permissionPolicy : null;
  return { required, matched, status: required ? matched ? "verified" : "mismatched" : "legacy-unverified" };
}
