import { describe, expect, it } from "vitest";
import {
  modelProfileProvenance,
  requireAndroidWorldModelProfile,
} from "../benchmark/android/android-world/model-profile.js";
import { configureAndroidWorldTask } from "../benchmark/android/android-world/task-instruction.js";
import { acquireAndroidWorldDeviceLease } from "../benchmark/android/android-world/device-lease.js";

describe("AndroidWorld model profiles", () => {
  it("pins Luna through the local Codex app server without credentials", () => {
    const profile = requireAndroidWorldModelProfile("codex-luna");
    expect(profile.env).toMatchObject({
      MIDSCENE_MODEL_BASE_URL: "codex://",
      MIDSCENE_MODEL_NAME: "gpt-5.6-luna",
      MIDSCENE_MODEL_FAMILY: "gpt-5",
      MIDSCENE_MODEL_REASONING_ENABLED: "true",
      MIDSCENE_MODEL_REASONING_EFFORT: "medium",
      MIDSCENE_REPLANNING_CYCLE_LIMIT: "120",
    });
    expect(Object.keys(profile.env).some((key) => /key|token|secret/i.test(key))).toBe(false);
  });

  it("writes only safe reproducibility metadata", () => {
    expect(modelProfileProvenance("codex-luna")).toEqual({
      profile: "codex-luna",
      provider: "codex-app-server",
      model: "gpt-5.6-luna",
      family: "gpt-5",
      reasoning: { enabled: true, effort: "medium" },
    });
  });

  it("rejects unpinned profiles", () => {
    expect(() => requireAndroidWorldModelProfile("unknown")).toThrow(/Unknown AndroidWorld model profile/);
  });
});

describe("AndroidWorld task scaffold", () => {
  it("configures normalized mappings and preserves the official task goal", () => {
    const previousGoal = process.env.ACTONCE_ANDROID_WORLD_GOAL;
    const previousApps = process.env.ACTONCE_ANDROID_WORLD_APPS;
    process.env.ACTONCE_ANDROID_WORLD_GOAL = "Create the requested recording";
    process.env.ACTONCE_ANDROID_WORLD_APPS = JSON.stringify([
      { name: "Audio Recorder", package: "com.dimowner.audiorecorder" },
    ]);
    let mapping: Record<string, string> | undefined;
    try {
      const goal = configureAndroidWorldTask({
        setAppNameMapping(value: Record<string, string>) { mapping = value; },
      } as never);
      expect(goal).toContain('already opened the target app "Audio Recorder"');
      expect(goal).toContain("Create the requested recording");
      expect(mapping).toEqual({ audiorecorder: "com.dimowner.audiorecorder" });
    } finally {
      restoreEnv("ACTONCE_ANDROID_WORLD_GOAL", previousGoal);
      restoreEnv("ACTONCE_ANDROID_WORLD_APPS", previousApps);
    }
  });
});

describe("AndroidWorld device lease", () => {
  it("rejects a second benchmark using the same emulator lease", async () => {
    const previousPort = process.env.ACTONCE_ANDROID_WORLD_DEVICE_LEASE_PORT;
    const previousOwner = process.env.ACTONCE_ANDROID_WORLD_DEVICE_LEASE_OWNER;
    process.env.ACTONCE_ANDROID_WORLD_DEVICE_LEASE_PORT = String(39_000 + process.pid % 1_000);
    delete process.env.ACTONCE_ANDROID_WORLD_DEVICE_LEASE_OWNER;
    const release = await acquireAndroidWorldDeviceLease();
    try {
      await expect(acquireAndroidWorldDeviceLease()).rejects.toThrow(/already held/);
    } finally {
      await release();
      restoreEnv("ACTONCE_ANDROID_WORLD_DEVICE_LEASE_PORT", previousPort);
      restoreEnv("ACTONCE_ANDROID_WORLD_DEVICE_LEASE_OWNER", previousOwner);
    }
  });
});

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
