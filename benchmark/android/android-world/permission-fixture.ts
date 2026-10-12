/** Runtime permissions live outside AndroidWorld's app-data snapshots. */
export type RuntimePermissionFixture = {
  schemaVersion: 1;
  userId: 0;
  packages: Array<{ package: string; permissions: Record<string, boolean> }>;
};
type App = { package?: string | null };
type Adb = (args: string[]) => Promise<string>;

export function parseRuntimePermissions(output: string): Record<string, boolean> {
  const lines = output.split(/\r?\n/);
  let inUser = false, inRuntime = false, foundUser = false, runtimeIndent = 0;
  const result: Record<string, boolean> = {};
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
    if (permission) result[permission[1]!] = permission[2] === "true";
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
    entries.push({ package: packageName, permissions: parseRuntimePermissions(await adb(["shell", "dumpsys", "package", packageName])) });
  }
  return { schemaVersion: 1, userId: 0, packages: entries };
}

export async function restoreRuntimePermissionFixture(value: unknown, apps: App[], adb: Adb): Promise<void> {
  const fixture = value as RuntimePermissionFixture;
  if (!fixture || fixture.schemaVersion !== 1 || fixture.userId !== 0 || !Array.isArray(fixture.packages))
    throw new Error("Invalid user-0 runtime permission fixture");
  const allowed = new Set(packages(apps)), seen = new Set<string>();
  // Validate the entire fixture before the first mutation, including installed runtime permissions.
  const prepared = [];
  for (const entry of fixture.packages) {
    if (!entry || !allowed.has(entry.package) || seen.has(entry.package)
        || !entry.permissions || typeof entry.permissions !== "object" || Array.isArray(entry.permissions))
      throw new Error("Permission fixture package is undeclared, duplicated or invalid");
    seen.add(entry.package);
    const current = parseRuntimePermissions(await adb(["shell", "dumpsys", "package", entry.package]));
    for (const [permission, granted] of Object.entries(entry.permissions)) {
      if (!/^[\w.]+$/.test(permission) || typeof granted !== "boolean" || !Object.hasOwn(current, permission))
        throw new Error(`Fixture permission is not a declared runtime permission: ${permission}`);
    }
    prepared.push({ entry, current });
  }
  for (const { entry, current } of prepared) {
    const changes = Object.entries(entry.permissions).filter(([permission, granted]) => current[permission] !== granted);
    if (!changes.length) continue;
    await adb(["shell", "am", "force-stop", entry.package]);
    for (const [permission, granted] of changes)
      await adb(["shell", "pm", granted ? "grant" : "revoke", "--user", "0", entry.package, permission]);
    const actual = parseRuntimePermissions(await adb(["shell", "dumpsys", "package", entry.package]));
    for (const [permission, granted] of Object.entries(entry.permissions))
      if (actual[permission] !== granted) throw new Error(`Permission fixture restore did not match: ${entry.package} ${permission}`);
  }
}
