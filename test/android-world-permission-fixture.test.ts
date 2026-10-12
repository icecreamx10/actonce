import { describe, expect, it } from "vitest";
import { captureRuntimePermissionFixture, parseRuntimePermissions, restoreRuntimePermissionFixture } from "../benchmark/android/android-world/permission-fixture.js";

const pkg = "com.example.recorder", permission = "android.permission.RECORD_AUDIO";
const dump = (granted: boolean) => `Package [${pkg}]:\n  install permissions:\n    android.permission.INTERNET: granted=true\n  User 0: installed=true\n    runtime permissions:\n      ${permission}: granted=${granted}, flags=[ USER_SET ]\n  User 10: installed=true\n    runtime permissions:\n      ${permission}: granted=false\n`;
const fixture = { schemaVersion: 1, userId: 0, packages: [{ package: pkg, permissions: { [permission]: false } }] };

describe("AndroidWorld runtime permission fixture", () => {
  it("captures only user-0 runtime permissions, not install permissions or another user", async () => {
    expect(parseRuntimePermissions(dump(true))).toEqual({ [permission]: true });
    expect(await captureRuntimePermissionFixture([{ package: pkg }, { package: pkg }], async () => dump(false))).toEqual({ ...fixture, packages: [{ ...fixture.packages[0], permissionFlags: { [permission]: { "user-set": true, "user-fixed": false } } }] });
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

  it("restores flag-only changes and preserves unspecified mutable flags", async () => {
    const calls: string[][] = [];
    let fixed = true;
    const partial = { ...fixture, packages: [{ ...fixture.packages[0], permissionFlags: { [permission]: { "user-fixed": false } } }] };
    await restoreRuntimePermissionFixture(partial, [{ package: pkg }], async args => {
      calls.push(args);
      if (args.includes("clear-permission-flags")) fixed = false;
      return dump(false).replace("USER_SET", `USER_SET${fixed ? "|USER_FIXED" : ""}`);
    });
    expect(calls).toContainEqual(["shell", "pm", "clear-permission-flags", "--user", "0", pkg, permission, "user-fixed"]);
    expect(calls.some(args => args.includes("grant") || args.includes("revoke"))).toBe(false);
    expect(calls.filter(args => args.includes("dumpsys"))).toHaveLength(2);
    expect(calls.filter(args => args.includes("user-set"))).toHaveLength(0);
  });

  it("applies flags after grant commands that change them", async () => {
    let granted = true, fixed = false;
    const flagged = { ...fixture, packages: [{ ...fixture.packages[0], permissionFlags: { [permission]: { "user-fixed": false } } }] };
    await restoreRuntimePermissionFixture(flagged, [{ package: pkg }], async args => {
      if (args.includes("revoke")) { granted = false; fixed = true; }
      if (args.includes("clear-permission-flags")) fixed = false;
      return dump(granted).replace("USER_SET", fixed ? "USER_FIXED" : "");
    });
    expect(fixed).toBe(false);
  });

  it("validates every flag before writes and rejects system flags, keys, and types", async () => {
    for (const flags of [{ "system-fixed": false }, { "user-fixed": "false" }, { "USER_FIXED": false }]) {
      const calls: string[][] = [];
      await expect(restoreRuntimePermissionFixture({ ...fixture, packages: [{ ...fixture.packages[0], permissionFlags: { [permission]: flags } }] }, [{ package: pkg }], async args => { calls.push(args); return dump(true); })).rejects.toThrow("flag");
      expect(calls.every(args => args.includes("dumpsys"))).toBe(true);
    }
    const calls: string[][] = [];
    await expect(restoreRuntimePermissionFixture({ ...fixture, packages: [{ ...fixture.packages[0], permissionFlags: { [permission]: { "user-fixed": false } } }, { package: "com.other.app", permissions: {}, permissionFlags: { missing: { "user-fixed": false } } }] }, [{ package: pkg }, { package: "com.other.app" }], async args => { calls.push(args); return dump(true); })).rejects.toThrow("flags");
    expect(calls.every(args => args.includes("dumpsys"))).toBe(true);
  });

  it("fails closed on unknown flag data and failed flag verification, but permits grant-only legacy data", async () => {
    const flagged = { ...fixture, packages: [{ ...fixture.packages[0], permissionFlags: { [permission]: { "user-fixed": false } } }] };
    await expect(restoreRuntimePermissionFixture(flagged, [{ package: pkg }], async () => dump(false).replace("USER_SET", "USER_FIXED"))).rejects.toThrow("did not match flag");
    const unknown = dump(false).replace(", flags=[ USER_SET ]", "");
    await expect(restoreRuntimePermissionFixture(flagged, [{ package: pkg }], async () => unknown)).rejects.toThrow("Unknown");
    await expect(captureRuntimePermissionFixture([{ package: pkg }], async () => unknown)).rejects.toThrow("Unknown");
    await expect(restoreRuntimePermissionFixture(fixture, [{ package: pkg }], async () => unknown)).resolves.toBeUndefined();
  });

  it("accepts opaque decimal system bits without dropping named mutable flags", async () => {
    const calls: string[][] = [];
    let fixed = true;
    const output = () => dump(false).replace("USER_SET", `USER_SET|USER_SENSITIVE_WHEN_GRANTED|ONE_TIME|524288${fixed ? "|USER_FIXED" : ""}`);
    const captured = await captureRuntimePermissionFixture([{ package: pkg }], async () => output());
    expect(captured.packages[0]!.permissionFlags![permission]).toEqual({ "user-set": true, "user-fixed": true });
    const partial = { ...fixture, packages: [{ ...fixture.packages[0], permissionFlags: { [permission]: { "user-fixed": false } } }] };
    await restoreRuntimePermissionFixture(partial, [{ package: pkg }], async args => {
      calls.push(args);
      if (args.includes("clear-permission-flags")) fixed = false;
      return args.includes("dumpsys") ? output() : "";
    });
    expect(calls).toContainEqual(["shell", "pm", "clear-permission-flags", "--user", "0", pkg, permission, "user-fixed"]);
    expect(calls.some(args => args.includes("user-set") || args.includes("524288") || args.includes("ONE_TIME"))).toBe(false);
  });

  it("rejects malformed or ambiguous numeric flags before any writes", async () => {
    for (const token of ["524288oops", "-524288", "524288.0", "4294967296", "1", "3"]) {
      const calls: string[][] = [];
      const output = dump(false).replace("USER_SET", token);
      const flagged = { ...fixture, packages: [{ ...fixture.packages[0], permissionFlags: { [permission]: { "user-fixed": false } } }] };
      await expect(restoreRuntimePermissionFixture(flagged, [{ package: pkg }], async args => { calls.push(args); return output; })).rejects.toThrow("Unknown");
      expect(calls.every(args => args.includes("dumpsys"))).toBe(true);
      await expect(captureRuntimePermissionFixture([{ package: pkg }], async () => output)).rejects.toThrow("Unknown");
    }
  });
});
