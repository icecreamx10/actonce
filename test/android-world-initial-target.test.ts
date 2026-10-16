import { describe, expect, it } from "vitest";
import { initialTargetPolicy, isInitialTargetForeground } from "../benchmark/android/android-world/initial-target.js";

const target = "com.google.android.contacts";
const controller = "com.google.android.permissioncontroller";
const activity = "com.android.permissioncontroller.permission.ui.GrantPermissionsActivity";
const modal = `${controller}/${activity}`;
const windowFor = (name: string) => `mCurrentFocus=Window{123 u0 ${name}}`;
const records = (requester = target, name = modal, top = name) => `
topResumedActivity=ActivityRecord{abc u0 ${top} t6}
  * Hist #1: ActivityRecord{abc u0 ${name} t6}
    launchedFromUid=10123 launchedFromPackage=${requester} launchedFromFeature=null
    resultTo=ActivityRecord{def u0 ${target}/.MainActivity t6} resultWho=@android:requestPermissions:
  * Hist #0: ActivityRecord{def u0 ${target}/.MainActivity t6}
    launchedFromPackage=${target}
    app=ProcessRecord{123 target}
    state=PAUSED stopped=false finishing=false
`;

describe("AndroidWorld initial target readiness", () => {
  it("accepts the exact target foreground, not a package substring", () => {
    expect(isInitialTargetForeground(target, windowFor(`${target}/.MainActivity`), "")).toBe(true);
    expect(isInitialTargetForeground(target, windowFor(`${target}.fake/.MainActivity`), "")).toBe(false);
    expect(isInitialTargetForeground(target, "mCurrentFocus=null", records())).toBe(false);
  });
  it("accepts a foreground permission modal launched by the exact target", () => {
    expect(isInitialTargetForeground(target, windowFor(modal), records())).toBe(true);
    expect(isInitialTargetForeground(target, windowFor(modal), records().replace(`${target}/.MainActivity t6} resultWho`, `${target}/.MainActivity} t6} resultWho`))).toBe(true);
  });
  it("rejects unrelated requesters, controllers, activities, and background records", () => {
    expect(isInitialTargetForeground(target, windowFor(modal), records("com.other"))).toBe(false);
    for (const name of [`com.other/${activity}`, `${controller}/.OtherActivity`]) {
      expect(isInitialTargetForeground(target, windowFor(name), records(target, name))).toBe(false);
    }
    expect(isInitialTargetForeground(target, windowFor(modal), records(target, modal, `${target}/.MainActivity`))).toBe(false);
    expect(isInitialTargetForeground(target, windowFor(modal), `topResumedActivity=ActivityRecord{abc u0 ${modal} t6}`)).toBe(false);
    expect(isInitialTargetForeground(target, windowFor(modal), records().replace(`launchedFromPackage=${target}`, "launchedFromPackage=com.other"))).toBe(false);
    expect(isInitialTargetForeground(target, windowFor(modal), records().replace("Hist #1: ActivityRecord{abc", "Hist #1: ActivityRecord{zzz"))).toBe(false);
  });
  it("does not mistake a crash or unrelated system surface for readiness", () => {
    expect(isInitialTargetForeground(target, windowFor("android/.AppErrorDialog"), records())).toBe(false);
  });
  it("rejects a force-stopped requester's surviving permission window", () => {
    expect(isInitialTargetForeground(target, windowFor(modal), records().replace(`t6} resultWho`, `t-1 f}} resultWho`))).toBe(false);
    expect(isInitialTargetForeground(target, windowFor(modal), records().replace("finishing=false", "finishing=true"))).toBe(false);
    expect(isInitialTargetForeground(target, windowFor(modal), records().replace("app=ProcessRecord{123 target}", "app=null"), true)).toBe(false);
    expect(isInitialTargetForeground(target, windowFor(modal), records().replace("state=PAUSED", "state=DESTROYED"), true)).toBe(false);
    expect(isInitialTargetForeground(target, windowFor(modal), records().replace("Hist #0: ActivityRecord{def", "Hist #0: ActivityRecord{missing"), true)).toBe(false);
    expect(isInitialTargetForeground(target, windowFor(modal), records().replace(`${target}/.MainActivity t6}\n`, `${target}/.MainActivity t7}\n`), true)).toBe(false);
  });
  it("keeps unknown legacy requester fields compatible but requires live evidence for stable setup", () => {
    const unknown = records().replace(/^.*resultTo=.*\n/mu, "");
    expect(isInitialTargetForeground(target, windowFor(modal), unknown)).toBe(true);
    expect(isInitialTargetForeground(target, windowFor(modal), unknown, true)).toBe(false);
    expect(isInitialTargetForeground(target, windowFor(modal), records().replace("app=ProcessRecord{123 target}", "app=null"))).toBe(true);
    expect(isInitialTargetForeground(target, windowFor(modal), records(), true)).toBe(true);
  });
});

describe("AndroidWorld initial start policy", () => {
  const apps = [{ name: "camera", package: "camera.pkg" }, { name: "contacts", package: target }];
  it("preserves official home for OpenAppTaskEval without prelaunching either candidate", () => {
    expect(initialTargetPolicy("OpenAppTaskEval", apps)).toEqual({ packages: ["camera.pkg", target], initialPackage: undefined });
    expect(apps).toHaveLength(2);
  });
  it("preserves first-app preparation for other tasks", () => {
    expect(initialTargetPolicy("ContactsAddContact", apps).initialPackage).toBe("camera.pkg");
    expect(initialTargetPolicy("SystemBrightnessMax", null).initialPackage).toBeUndefined();
  });
});
