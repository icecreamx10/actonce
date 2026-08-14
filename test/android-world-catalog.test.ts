import { describe, expect, it } from "vitest";
import {
  MIDSCENE_ANDROID_WORLD_CASES,
  MIDSCENE_ANDROID_WORLD_REPORT,
  selectMidsceneAndroidWorldCases,
} from "../benchmark/android/android-world/catalog.js";

describe("Midscene AndroidWorld catalog", () => {
  it("matches the published Pass@1 and Pass@3 counts", () => {
    expect(MIDSCENE_ANDROID_WORLD_CASES).toHaveLength(116);
    expect(selectMidsceneAndroidWorldCases("pass@1")).toHaveLength(108);
    expect(selectMidsceneAndroidWorldCases("pass@3")).toHaveLength(113);
    expect(MIDSCENE_ANDROID_WORLD_REPORT.publishedCounts.passAt3).toBe(113);
  });

  it("preserves retry history and persistent failures", () => {
    expect(MIDSCENE_ANDROID_WORLD_CASES.find((entry) => entry.task === "OsmAndTrack")?.rounds)
      .toEqual(["NOT_RUN", "PASS", "NOT_RUN"]);
    expect(MIDSCENE_ANDROID_WORLD_CASES.find((entry) => entry.task === "SystemBrightnessMax")?.firstPassRound)
      .toBe(1);
    expect(MIDSCENE_ANDROID_WORLD_CASES.filter((entry) => entry.finalStatus === "FAIL").map((entry) => entry.task))
      .toEqual(["MarkorTranscribeVideo", "RecipeDeleteDuplicateRecipes2", "RecipeDeleteDuplicateRecipes3"]);
  });
});
