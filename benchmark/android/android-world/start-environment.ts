import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { captureRuntimePermissionFixture, restoreRuntimePermissionFixture, type RuntimePermissionFixture } from "./permission-fixture.js";
import { initialTargetPolicy } from "./initial-target.js";
import { normalizeCameraPublication } from "./media-publication-fixture.js";

export type PermissionPolicy = "recorded" | "grant-all" | "first-request";
type Adb = (args: string[]) => Promise<string>;
export class TargetStartupError extends Error {}

export async function withStableStartupRecovery<T>(attempt: () => Promise<T>, resetOfficialFixture: () => Promise<void>, preserve: (failure: { attempt: number; error: string }) => Promise<void>) {
  const startupFailures: Array<{ attempt: number; error: string }> = [];
  for (let index = 1; index <= 2; index++) {
    try { return { value: await attempt(), setupAttemptCount: index, startupFailures }; }
    catch (error) {
      if (!(error instanceof TargetStartupError)) throw error;
      const failure = { attempt: index, error: error.message };
      startupFailures.push(failure);
      await preserve(failure);
      if (index === 2) throw error;
      await resetOfficialFixture();
    }
  }
  throw new Error("Unreachable startup recovery");
}
export type StartEnvironment = {
  schemaVersion: 1 | 2;
  task: string;
  permissionPolicy: Exclude<PermissionPolicy, "recorded">;
  initialization: "official-task-snapshot";
  device: { api: string; size: string; density: string; navigationMode: string; rotation: string; automaticRotation: string };
  preferences: Record<string, string>;
  permissions: RuntimePermissionFixture;
  publication?: Awaited<ReturnType<typeof normalizeCameraPublication>>["baseline"];
};

export function permissionPolicy(task: string, explicit?: string, saved?: unknown): PermissionPolicy {
  const persisted = saved as Partial<StartEnvironment> | undefined;
  const value = explicit ?? persisted?.permissionPolicy ?? (task === "CameraTakeVideo" ? "grant-all" : "recorded");
  if (!["recorded", "grant-all", "first-request"].includes(value)) throw new Error(`Invalid permission policy: ${value}`);
  if (persisted && (![1, 2].includes(persisted.schemaVersion ?? 0) || persisted.task !== task || persisted.initialization !== "official-task-snapshot"
      || persisted.permissionPolicy !== value)) throw new Error("Start environment contract identity/policy mismatch");
  return value as PermissionPolicy;
}

/** Measurement-external, scoped to task-declared packages. Never reset global permissions. */
export async function normalizeStartEnvironment(task: string, apps: unknown, policy: Exclude<PermissionPolicy, "recorded">, adb: Adb, onPublication?: (value: Awaited<ReturnType<typeof normalizeCameraPublication>>) => void): Promise<StartEnvironment> {
  const { packages } = initialTargetPolicy(task, apps);
  if (!packages.length || packages.some(pkg => !/^[\w]+(?:\.[\w]+)+$/.test(pkg))) throw new Error("No valid task packages for stable setup");
  const api = (await adb(["shell", "getprop", "ro.build.version.sdk"])).trim();
  if (api !== "33") throw new Error(`Stable AndroidWorld setup requires API 33, got ${api}`);
  if ((await adb(["shell", "id", "-u"])).trim() !== "0") throw new Error("Stable setup requires the pinned rooted emulator for app-state verification");
  if ((await adb(["shell", "am", "get-current-user"])).trim() !== "0") throw new Error("Stable AndroidWorld setup requires foreground user 0");
  // The official initializer has already restored app data. Terminate activities
  // before touching permissions, including the target's old permission requester.
  for (const pkg of packages) await adb(["shell", "am", "force-stop", pkg]);
  // Avoid unnecessary display reconfiguration while starting an app; clear
  // actual overrides only, and leave an already-canonical display untouched.
  if ((await adb(["shell", "wm", "size"])).includes("Override size:")) await adb(["shell", "wm", "size", "reset"]);
  if ((await adb(["shell", "wm", "density"])).includes("Override density:")) await adb(["shell", "wm", "density", "reset"]);
  for (const setting of ["accelerometer_rotation", "user_rotation"]) {
    if ((await adb(["shell", "settings", "get", "system", setting])).trim() !== "0") await adb(["shell", "settings", "put", "system", setting, "0"]);
  }
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
  const publicationResult = task === "CameraTakeVideo" ? await normalizeCameraPublication(adb) : undefined;
  if (publicationResult) onPublication?.(publicationResult);
  const publication = publicationResult?.baseline;
  return { schemaVersion: publication ? 2 : 1, task, permissionPolicy: policy, initialization: "official-task-snapshot", device, preferences, permissions: actual, ...(publication ? { publication } : {}) };
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

/** Focus alone can precede a drawn/nonzero activity surface or a startup crash. */
export function isDrawnTargetWindow(target: string, windows: string, allowPermissionModal = false): boolean {
  const focusedLine = windows.split("\n").find(line => line.includes("mCurrentFocus="));
  const focus = focusedLine?.match(/\b([\w.]+\/[\w.$]+)(?=[\s}])/)?.[1];
  const token = focusedLine?.match(/Window\{([^\s}]+)/)?.[1];
  if (!focus || (focus.split("/")[0] !== target && !(allowPermissionModal && /^(com.google.android.permissioncontroller|com.android.permissioncontroller)\//.test(focus)))) return false;
  const block = windows.split(/(?=^\s*Window #\d+ Window\{)/m).find(value => value.includes(`Window{${token} `) && value.includes(`${focus}}:`));
  if (!block || !block.includes("mHasSurface=true") || !block.includes("mDrawState=HAS_DRAWN") || !block.includes("mViewVisibility=0x0")) return false;
  const frame = block.match(/\bframe=\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/);
  return !!frame && Number(frame[3]) > Number(frame[1]) && Number(frame[4]) > Number(frame[2]);
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
