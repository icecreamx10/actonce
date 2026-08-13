import { describe, expect, it } from "vitest";
import {
  RECORDING_PROFILES,
  recordingProfile,
} from "../interceptor/src/recording-profiles.js";

describe("recording CLI profiles", () => {
  it("owns stable source combinations outside skills", () => {
    expect(RECORDING_PROFILES).toEqual([
      expect.objectContaining({
        id: "midscene-android",
        platform: "android",
        mode: "task-module",
        sources: ["midscene", "android-input", "checkpoint"],
      }),
      expect.objectContaining({
        id: "midscene-macos",
        platform: "macos",
        mode: "task-module",
        sources: ["midscene", "macos-input", "checkpoint"],
      }),
      expect.objectContaining({
        id: "midscene-ios",
        platform: "ios",
        mode: "task-module",
        sources: ["midscene", "wda", "checkpoint"],
      }),
      expect.objectContaining({
        id: "ios-wda",
        platform: "ios",
        mode: "proxy",
        sources: ["wda"],
      }),
    ]);
  });

  it("resolves only named public profiles", () => {
    expect(recordingProfile("midscene-android")?.sources).toEqual([
      "midscene",
      "android-input",
      "checkpoint",
    ]);
    expect(recordingProfile("midscene-ios")?.sources).toEqual([
      "midscene",
      "wda",
      "checkpoint",
    ]);
    expect(recordingProfile("custom-sources")).toBeUndefined();
  });
});
