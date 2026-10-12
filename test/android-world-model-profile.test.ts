import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import {
  codexAppServerPath,
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
      PUPPETEER_SKIP_DOWNLOAD: "true",
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

  it("keeps the explicit GPT-6.1 Sol profile separate from existing Luna profiles", () => {
    const profile = requireAndroidWorldModelProfile("codex-6.1-sol");
    expect(profile.env.MIDSCENE_MODEL_NAME).toBe("gpt-6.1-sol");
    expect(modelProfileProvenance("codex-6.1-sol").model).toBe("gpt-6.1-sol");
    expect(requireAndroidWorldModelProfile("codex-6-luna").env.MIDSCENE_MODEL_NAME).toBe("gpt-6-luna");
    expect(requireAndroidWorldModelProfile("codex-luna").env.MIDSCENE_MODEL_NAME).toBe("gpt-5.6-luna");
  });

  it("uses the requested GPT-6 Luna for both execution and provenance", () => {
    const profile = requireAndroidWorldModelProfile("codex-6-luna");
    expect(profile.env.MIDSCENE_MODEL_NAME).toBe("gpt-6-luna");
    expect(modelProfileProvenance("codex-6-luna").model).toBe(profile.env.MIDSCENE_MODEL_NAME);
  });

  it("exposes the ChatGPT-bundled Codex CLI to a clean benchmark shell", () => {
    const bundledPaths = [
      "/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS",
      "/Applications/ChatGPT.app/Contents/Resources",
    ];
    const value = codexAppServerPath(["/usr/bin", "/bin"].join(delimiter));
    const availableBundle = process.platform === "darwin"
      ? bundledPaths.find((directory) => existsSync(join(directory, "codex")))
      : undefined;
    if (availableBundle) expect(value.split(delimiter)[0]).toBe(availableBundle);
    else expect(value).toBe(["/usr/bin", "/bin"].join(delimiter));
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
      expect(goal).toContain('recover once using Launch with the exact logical name "Audio Recorder"');
      expect(goal).toContain("Create the requested recording");
      expect(mapping).toEqual({ audiorecorder: "com.dimowner.audiorecorder" });
    } finally {
      restoreEnv("ACTONCE_ANDROID_WORLD_GOAL", previousGoal);
      restoreEnv("ACTONCE_ANDROID_WORLD_APPS", previousApps);
    }
  });
});

describe("AndroidWorld official home scaffold", () => {
  it("does not claim that a candidate app was opened and preserves the requested goal", () => {
    const previousGoal = process.env.ACTONCE_ANDROID_WORLD_GOAL;
    const previousApps = process.env.ACTONCE_ANDROID_WORLD_APPS;
    const previousStart = process.env.ACTONCE_ANDROID_WORLD_START_STATE;
    process.env.ACTONCE_ANDROID_WORLD_GOAL = "Open the dialer app";
    process.env.ACTONCE_ANDROID_WORLD_APPS = JSON.stringify([
      { name: "camera", package: "com.android.camera2" },
      { name: "dialer", package: "com.android.dialer" },
    ]);
    process.env.ACTONCE_ANDROID_WORLD_START_STATE = "official-home";
    try {
      const goal = configureAndroidWorldTask({ setAppNameMapping() {} } as never);
      expect(goal).toContain("official initialized Home screen");
      expect(goal).toContain('"camera", "dialer"');
      expect(goal).toContain("Open the dialer app");
      expect(goal).not.toContain("already opened");
    } finally {
      restoreEnv("ACTONCE_ANDROID_WORLD_GOAL", previousGoal);
      restoreEnv("ACTONCE_ANDROID_WORLD_APPS", previousApps);
      restoreEnv("ACTONCE_ANDROID_WORLD_START_STATE", previousStart);
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
