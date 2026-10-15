import { describe, expect, it } from "vitest";
import { isDrawnTargetWindow, normalizeStartEnvironment, permissionPolicy, startEnvironmentParity, TargetStartupError, verifyStartEnvironment, verifyStableForeground, withStableStartupRecovery } from "../benchmark/android/android-world/start-environment.js";

const pkg = "com.android.camera2", name = "android.permission.CAMERA";
function mock() {
  const calls: string[][] = [];
  let granted = true, userSet = true, userFixed = true, oneTime = true;
  const adb = async (args: string[]) => {
    calls.push(args);
    if (args.includes("getprop")) return "33\n";
    if (args.includes("id")) return "0\n";
    if (args.includes("get-current-user")) return "0\n";
    if (args.includes("wm")) return args.includes("reset") ? "" : args.includes("size") ? "Physical size: 1080x2400\n" : "Physical density: 420\n";
    if (args.includes("get")) return args.includes("navigation_mode") ? "2\n" : "0\n";
    if (args.includes("revoke")) { granted = false; oneTime = false; }
    if (args.includes("grant")) granted = true;
    if (args.includes("clear-permission-flags")) {
      if (args.includes("user-set")) userSet = false;
      if (args.includes("user-fixed")) userFixed = false;
    }
    if (args.includes("dumpsys")) return `User 0:\n  runtime permissions:\n    ${name}: granted=${granted}, flags=[${userSet ? "USER_SET|" : ""}${userFixed ? "USER_FIXED|" : ""}${oneTime ? "ONE_TIME" : ""}]\n`;
    if (args[1]?.includes("shared_prefs")) return "abcdef  /data/user/0/com.android.camera2/shared_prefs/camera.xml\n";
    if (args[1]?.startsWith("content query")) return "No result found.\n";
    return "";
  };
  return { adb, calls, state: () => ({ granted, userSet, userFixed, oneTime }) };
}

describe("stable AndroidWorld start environment", () => {
  it("requires the same stable contract for a correctness/performance claim without upgrading legacy evidence", () => {
    const state = { status: "verified", permissionPolicy: "grant-all", sha256: "a".repeat(64) };
    expect(startEnvironmentParity(state, { ...state })).toEqual({ required: true, matched: true, status: "verified" });
    expect(startEnvironmentParity(state, undefined).matched).toBe(false);
    expect(startEnvironmentParity(state, { ...state, sha256: "b".repeat(64) }).matched).toBe(false);
    expect(startEnvironmentParity(state, { ...state, permissionPolicy: "first-request" }).matched).toBe(false);
    expect(startEnvironmentParity(undefined, undefined)).toEqual({ required: false, matched: null, status: "legacy-unverified" });
  });
  it("defaults only new video tasks to grant-all and respects persisted contracts", () => {
    expect(permissionPolicy("CameraTakeVideo")).toBe("grant-all");
    expect(permissionPolicy("CameraTakePhoto")).toBe("recorded");
    expect(permissionPolicy("CameraTakeVideo", "recorded")).toBe("recorded");
    expect(() => permissionPolicy("CameraTakeVideo", "invalid")).toThrow("Invalid");
    const saved = { schemaVersion: 1, task: "CameraTakeVideo", initialization: "official-task-snapshot", permissionPolicy: "grant-all" };
    expect(permissionPolicy("CameraTakeVideo", undefined, saved)).toBe("grant-all");
    expect(() => permissionPolicy("CameraTakeVideo", "first-request", saved)).toThrow("mismatch");
    expect(() => permissionPolicy("other", undefined, saved)).toThrow("mismatch");
  });

  it("force-stops the declared target before permissions and replaces expiring grants", async () => {
    const { adb, calls, state } = mock();
    const result = await normalizeStartEnvironment("CameraTakeVideo", [{ package: pkg }], "grant-all", adb);
    expect(state()).toEqual({ granted: true, userSet: false, userFixed: false, oneTime: false });
    expect(calls.indexOf(calls.find(args => args.includes("force-stop"))!)).toBeLessThan(calls.indexOf(calls.find(args => args.includes("revoke"))!));
    expect(calls).toContainEqual(["shell", "pm", "revoke", "--user", "0", pkg, name]);
    expect(calls).toContainEqual(["shell", "pm", "grant", "--user", "0", pkg, name]);
    expect(calls.some(args => args.includes("reset-permissions") || args.includes("clear") || args.includes("input"))).toBe(false);
    expect(calls.some(args => args.includes("reset") || args.includes("put"))).toBe(false);
    expect(result.permissions.packages[0]!.permissions[name]).toBe(true);
    expect(result.preferences[pkg]).toMatch(/^[a-f0-9]{64}$/);
    verifyStartEnvironment(structuredClone(result), result);
    expect(() => verifyStartEnvironment({ ...result, preferences: {} }, result)).toThrow("differs");
  });

  it("requires the exact focused window's drawn, visible nonzero surface", () => {
    const component = `${pkg}/com.android.camera.CameraActivity`;
    const header = `mCurrentFocus=Window{abc u0 ${component}}\nWindow #0 Window{abc u0 ${component}}:\n`;
    const surface = "mViewVisibility=0x0 mHasSurface=true\nFrames: frame=[0,0][1080,2400]\nmDrawState=HAS_DRAWN\n";
    expect(isDrawnTargetWindow(pkg, header + surface)).toBe(true);
    expect(isDrawnTargetWindow(pkg, header + surface.replace("[1080,2400]", "[0,0]"))).toBe(false);
    expect(isDrawnTargetWindow(pkg, header + surface.replace("HAS_DRAWN", "DRAW_PENDING"))).toBe(false);
    expect(isDrawnTargetWindow(pkg, header + surface.replace("0x0", "0x8"))).toBe(false);
    expect(isDrawnTargetWindow(pkg, header + surface.replace("true", "false"))).toBe(false);
    expect(isDrawnTargetWindow(pkg, header.replace("Window #0 Window{abc", "Window #0 Window{old") + surface)).toBe(false);
  });

  it("preserves startup failure and resets the official fixture before one bounded retry", async () => {
    const calls: string[] = [];
    let count = 0;
    const result = await withStableStartupRecovery(async () => { calls.push("attempt"); if (++count === 1) throw new TargetStartupError("crash"); return "ready"; }, async () => { calls.push("reset"); }, async f => { calls.push(`preserve${f.attempt}`); });
    expect(calls).toEqual(["attempt", "preserve1", "reset", "attempt"]);
    expect(result).toEqual({ value: "ready", setupAttemptCount: 2, startupFailures: [{ attempt: 1, error: "crash" }] });
  });

  it("never retries a contract mismatch, never runs a third launch", async () => {
    let attempts = 0, resets = 0;
    const failures: unknown[] = [];
    await expect(withStableStartupRecovery(async () => { attempts++; throw new Error("contract mismatch"); }, async () => { resets++; }, async f => { failures.push(f); })).rejects.toThrow("contract mismatch");
    expect([attempts, resets, failures.length]).toEqual([1, 0, 0]);
    attempts = 0;
    await expect(withStableStartupRecovery(async () => { attempts++; throw new TargetStartupError("crash"); }, async () => { resets++; }, async f => { failures.push(f); })).rejects.toThrow("crash");
    expect([attempts, resets, failures.length]).toEqual([2, 1, 2]);
  });

  it("denied first-request baseline clears refusal history without granting or wiping app data", async () => {
    const { adb, calls, state } = mock();
    await normalizeStartEnvironment("CameraTakeVideo", [{ package: pkg }], "first-request", adb);
    expect(state()).toEqual({ granted: false, userSet: false, userFixed: false, oneTime: false });
    expect(calls.some(args => args.includes("grant") || args.includes("clear"))).toBe(false);
  });

  it("rejects undeclared/malformed packages and unpinned devices before writes", async () => {
    const { adb, calls } = mock();
    await expect(normalizeStartEnvironment("CameraTakeVideo", [{ package: "a;bad" }], "grant-all", adb)).rejects.toThrow("packages");
    expect(calls).toHaveLength(0);
    await expect(normalizeStartEnvironment("CameraTakeVideo", [{ package: pkg }], "grant-all", async args => args.includes("getprop") ? "35" : adb(args))).rejects.toThrow("API 33");
    expect(calls).toHaveLength(0);
  });

  it("fails closed for a pregranted permission window, preserving legacy modal support", () => {
    const windows = "mCurrentFocus=Window{abc u0 com.google.android.permissioncontroller/com.android.permissioncontroller.permission.ui.GrantPermissionsActivity}";
    expect(() => verifyStableForeground("grant-all", windows)).toThrow("permission requester");
    verifyStableForeground("first-request", windows);
    verifyStableForeground("recorded", windows);
    expect(() => verifyStableForeground("grant-all", "mCurrentFocus=Window{abc u0 com.android.camera2/com.android.camera.PermissionsActivity}")).toThrow("permission requester");
    verifyStableForeground("grant-all", "mCurrentFocus=Window{abc u0 com.android.camera2/com.android.camera.CameraActivity}");
  });
});
