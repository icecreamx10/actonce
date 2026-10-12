/** Runtime permissions live outside AndroidWorld's app-data snapshots. */
export type RuntimePermissionFixture = {
  schemaVersion: 1;
  userId: 0;
  packages: Array<{ package: string; permissions: Record<string, boolean>; permissionFlags?: Record<string, Partial<Record<MutableFlag, boolean>>> }>;
};
export type MutableFlag = "user-set" | "user-fixed";
const mutableFlags: MutableFlag[] = ["user-set", "user-fixed"];
type App = { package?: string | null };
type Adb = (args: string[]) => Promise<string>;

export function parseRuntimePermissions(output: string): Record<string, boolean> {
  return Object.fromEntries(Object.entries(parseRuntimePermissionState(output)).map(([name, state]) => [name, state.granted]));
}

function parseRuntimePermissionState(output: string): Record<string, { granted: boolean; flags?: Record<MutableFlag, boolean> }> {
  const lines = output.split(/\r?\n/);
  let inUser = false, inRuntime = false, foundUser = false, runtimeIndent = 0;
  const result: Record<string, { granted: boolean; flags?: Record<MutableFlag, boolean> }> = {};
  for (const line of lines) {
    if (/^\s*User \d+:/.test(line)) {
      inUser = /^\s*User 0:/.test(line);
      if (inUser) foundUser = true;
      inRuntime = false;
    }
    if (!inUser) continue;
    if (/^\s*runtime permissions:\s*$/.test(line)) {
      inRuntime = true; runtimeIndent = line.length - line.trimStart().length; continue;
    }
    if (!inRuntime) continue;
    const permission = line.match(/^\s*([\w.]+): granted=(true|false)(?:,|\s|$)/);
    if (permission) {
      const flags = line.match(/flags=\[([^\]]*)\]/);
      const flagsKnown = flags && flags[1]!.split(/[|,\s]+/).filter(Boolean).every(flag => /^[A-Z_]+$/.test(flag));
      result[permission[1]!] = { granted: permission[2] === "true", ...(flagsKnown ? { flags: {
        "user-set": /\bUSER_SET\b/.test(flags[1]!), "user-fixed": /\bUSER_FIXED\b/.test(flags[1]!),
      } } : {}) };
    }
    else if (line.trim() && line.length - line.trimStart().length <= runtimeIndent) inRuntime = false;
  }
  if (!foundUser)
    throw new Error("Package dump has no user-0 runtime permission state");
  return result;
}

function packages(apps: App[]): string[] {
  return [...new Set(apps.flatMap(app => typeof app.package === "string" && app.package ? [app.package] : []))];
}

export async function captureRuntimePermissionFixture(apps: App[], adb: Adb): Promise<RuntimePermissionFixture> {
  const entries = [];
  for (const packageName of packages(apps)) {
    if (!/^[\w]+(?:\.[\w]+)+$/.test(packageName)) throw new Error("Invalid fixture package");
    const state = parseRuntimePermissionState(await adb(["shell", "dumpsys", "package", packageName]));
    if (Object.values(state).some(permission => !permission.flags)) throw new Error("Unknown runtime permission flag data");
    entries.push({ package: packageName,
      permissions: Object.fromEntries(Object.entries(state).map(([name, permission]) => [name, permission.granted])),
      permissionFlags: Object.fromEntries(Object.entries(state).map(([name, permission]) => [name, permission.flags!])),
    });
  }
  return { schemaVersion: 1, userId: 0, packages: entries };
}

export async function restoreRuntimePermissionFixture(value: unknown, apps: App[], adb: Adb): Promise<void> {
  const fixture = value as RuntimePermissionFixture;
  if (!fixture || Object.keys(fixture).some(key => !["schemaVersion", "userId", "packages"].includes(key))
      || fixture.schemaVersion !== 1 || fixture.userId !== 0 || !Array.isArray(fixture.packages))
    throw new Error("Invalid user-0 runtime permission fixture");
  const allowed = new Set(packages(apps)), seen = new Set<string>();
  // Validate the entire fixture before the first mutation, including installed runtime permissions.
  const prepared = [];
  for (const entry of fixture.packages) {
    if (!entry || Object.keys(entry).some(key => !["package", "permissions", "permissionFlags"].includes(key))
        || typeof entry.package !== "string" || !/^[\w]+(?:\.[\w]+)+$/.test(entry.package) || !allowed.has(entry.package) || seen.has(entry.package)
        || !entry.permissions || typeof entry.permissions !== "object" || Array.isArray(entry.permissions))
      throw new Error("Permission fixture package is undeclared, duplicated or invalid");
    seen.add(entry.package);
    const current = parseRuntimePermissionState(await adb(["shell", "dumpsys", "package", entry.package]));
    for (const [permission, granted] of Object.entries(entry.permissions)) {
      if (!/^[\w.]+$/.test(permission) || typeof granted !== "boolean" || !Object.hasOwn(current, permission))
        throw new Error(`Fixture permission is not a declared runtime permission: ${permission}`);
    }
    if (entry.permissionFlags !== undefined) {
      if (!entry.permissionFlags || typeof entry.permissionFlags !== "object" || Array.isArray(entry.permissionFlags)) throw new Error("Invalid permission flags");
      for (const [permission, flags] of Object.entries(entry.permissionFlags)) {
        if (!Object.hasOwn(entry.permissions, permission) || !Object.hasOwn(current, permission)
            || !flags || typeof flags !== "object" || Array.isArray(flags)) throw new Error("Invalid permission flags");
        for (const [flag, expected] of Object.entries(flags)) {
          if (!mutableFlags.includes(flag as MutableFlag) || typeof expected !== "boolean") throw new Error("Invalid mutable permission flag");
          if (!current[permission]!.flags) throw new Error("Unknown runtime permission flag data");
        }
      }
    }
    prepared.push({ entry, current });
  }
  for (const { entry, current } of prepared) {
    const changes = Object.entries(entry.permissions).filter(([permission, granted]) => current[permission]!.granted !== granted);
    const flagChanges = Object.entries(entry.permissionFlags ?? {}).some(([permission, flags]) =>
      Object.entries(flags).some(([flag, expected]) => current[permission]!.flags?.[flag as MutableFlag] !== expected));
    if (!changes.length && !flagChanges) continue;
    await adb(["shell", "am", "force-stop", entry.package]);
    for (const [permission, granted] of changes)
      await adb(["shell", "pm", granted ? "grant" : "revoke", "--user", "0", entry.package, permission]);
    // Grant/revoke can modify flags; apply expectations afterwards, preserving unspecified flags.
    for (const [permission, flags] of Object.entries(entry.permissionFlags ?? {}))
      for (const [flag, expected] of Object.entries(flags))
        await adb(["shell", "pm", expected ? "set-permission-flags" : "clear-permission-flags", "--user", "0", entry.package, permission, flag]);
    const actual = parseRuntimePermissionState(await adb(["shell", "dumpsys", "package", entry.package]));
    for (const [permission, granted] of Object.entries(entry.permissions))
      if (actual[permission]?.granted !== granted) throw new Error(`Permission fixture restore did not match: ${entry.package} ${permission}`);
    for (const [permission, flags] of Object.entries(entry.permissionFlags ?? {}))
      for (const [flag, expected] of Object.entries(flags))
        if (actual[permission]?.flags?.[flag as MutableFlag] !== expected) throw new Error(`Permission fixture restore did not match flag: ${entry.package} ${permission} ${flag}`);
  }
}
