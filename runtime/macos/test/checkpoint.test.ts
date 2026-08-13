import { afterEach, describe, expect, it } from "vitest";
import sharp from "sharp";
import {
  compareMacCheckpoint,
  compareVisualScreenshot,
  type MacCheckpointActual,
  type MacCheckpointExpectation,
} from "../src/checkpoint.js";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { recursive: true })));
});

const expected: MacCheckpointExpectation = {
  source: { includes: ["main.js"], excludes: ["Welcome to Lynxtron Fiddle"] },
  elements: [
    {
      id: "editor",
      locator: { name: "main.js" },
      displayed: true,
      enabled: true,
      text: { includes: "probe" },
    },
    {
      id: "welcome",
      locator: { name: "Welcome to Lynxtron Fiddle" },
      exists: false,
    },
  ],
  apps: [{ bundleId: "com.example.Lynxtron", state: 4 }],
};

describe("compareMacCheckpoint", () => {
  it("accepts matching AX, element, and app evidence", () => {
    const actual: MacCheckpointActual = {
      source: "<main.js>probe</main.js>",
      elements: [
        { id: "editor", exists: true, displayed: true, enabled: true, text: "probe text" },
        { id: "welcome", exists: false },
      ],
      apps: [{ bundleId: "com.example.Lynxtron", state: 4 }],
      captureErrors: [],
    };
    expect(compareMacCheckpoint(expected, actual)).toEqual([]);
  });

  it("returns precise paths for mismatched evidence", () => {
    const actual: MacCheckpointActual = {
      source: "Welcome to Lynxtron Fiddle",
      elements: [
        { id: "editor", exists: true, displayed: false, enabled: true, text: "default" },
        { id: "welcome", exists: true },
      ],
      apps: [{ bundleId: "com.example.Lynxtron", state: 2 }],
      captureErrors: [],
    };
    expect(compareMacCheckpoint(expected, actual).map((entry) => entry.path)).toEqual(
      expect.arrayContaining([
        "source",
        "elements.editor.displayed",
        "elements.editor.text",
        "elements.welcome.exists",
        "apps.com.example.Lynxtron.state",
      ]),
    );
  });

  it("compares live screenshots with a recorded visual checkpoint", async () => {
    const root = await mkdtemp(join(tmpdir(), "actonce-visual-checkpoint-"));
    temporaryRoots.push(root);
    const referencePath = join(root, "reference.png");
    const reference = await sharp({
      create: { width: 32, height: 24, channels: 3, background: { r: 20, g: 30, b: 40 } },
    }).png().toBuffer();
    await writeFile(referencePath, reference);
    const same = await compareVisualScreenshot(reference.toString("base64"), {
      referencePath,
      resizeWidth: 16,
      maxDifferenceRatio: 0,
    });
    const changed = await sharp({
      create: { width: 32, height: 24, channels: 3, background: { r: 240, g: 240, b: 240 } },
    }).png().toBuffer();
    const different = await compareVisualScreenshot(changed.toString("base64"), {
      referencePath,
      resizeWidth: 16,
      maxDifferenceRatio: 0.1,
    });

    expect(same.differenceRatio).toBe(0);
    expect(different.differenceRatio).toBe(1);
    expect(compareMacCheckpoint(
      { visual: { referencePath, maxDifferenceRatio: 0.1 } },
      { elements: [], apps: [], captureErrors: [], visual: different },
    ).map((entry) => entry.path)).toContain("visual.differenceRatio");
  });
});
