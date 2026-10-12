import { describe, expect, it } from "vitest";
import { captureRuntimePermissionFixture, parseRuntimePermissions, restoreRuntimePermissionFixture } from "../benchmark/android/android-world/permission-fixture.js";

const pkg = "com.example.recorder", permission = "android.permission.RECORD_AUDIO";
const dump = (granted: boolean) => `Package [${pkg}]:\n  install permissions:\n    android.permission.INTERNET: granted=true\n  User 0: installed=true\n    runtime permissions:\n      ${permission}: granted=${granted}, flags=[ USER_SET ]\n  User 10: installed=true\n    runtime permissions:\n      ${permission}: granted=false\n`;
const fixture = { schemaVersion: 1, userId: 0, packages: [{ package: pkg, permissions: { [permission]: false } }] };

describe("AndroidWorld runtime permission fixture", () => {
  it("captures only user-0 runtime permissions, not install permissions or another user", async () => {
    expect(parseRuntimePermissions(dump(true))).toEqual({ [permission]: true });
    expect(await captureRuntimePermissionFixture([{ package: pkg }, { package: pkg }], async () => dump(false))).toEqual(fixture);
    expect(parseRuntimePermissions("  User 0: installed=true\n    runtime permissions:\n  User 10: installed=true\n    runtime permissions:\n      other.permission: granted=true\n")).toEqual({});
    expect(() => parseRuntimePermissions("Unable to find package")).toThrow("user-0");
  });

  it("restores and verifies a changed permission outside replay actions", async () => {
    const calls: string[][] = [];
    let granted = true;
    await restoreRuntimePermissionFixture(fixture, [{ package: pkg }], async args => {
      calls.push(args);
      if (args.includes("revoke")) granted = false;
      return args.includes("dumpsys") ? dump(granted) : "";
    });
    expect(calls).toContainEqual(["shell", "pm", "revoke", "--user", "0", pkg, permission]);
    expect(calls.filter(args => args.includes("dumpsys"))).toHaveLength(2);
  });

  it("does not mutate an already matching baseline", async () => {
    const calls: string[][] = [];
    await restoreRuntimePermissionFixture(fixture, [{ package: pkg }], async args => { calls.push(args); return dump(false); });
    expect(calls).toHaveLength(1);
  });

  it("validates all entries before mutating and refuses non-runtime or undeclared packages", async () => {
    const calls: string[][] = [];
    const adb = async (args: string[]) => { calls.push(args); return dump(true); };
    await expect(restoreRuntimePermissionFixture({ ...fixture, packages: [...fixture.packages, { package: "other.app", permissions: {} }] }, [{ package: pkg }], adb)).rejects.toThrow("undeclared");
    expect(calls.every(args => args.includes("dumpsys"))).toBe(true);
    await expect(restoreRuntimePermissionFixture({ ...fixture, packages: [{ package: pkg, permissions: { "android.permission.INTERNET": false } }] }, [{ package: pkg }], adb)).rejects.toThrow("runtime permission");
  });

  it("fails closed when the permission command did not restore state", async () => {
    await expect(restoreRuntimePermissionFixture(fixture, [{ package: pkg }], async () => dump(true))).rejects.toThrow("did not match");
  });
});
