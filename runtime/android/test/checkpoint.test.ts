import { describe, expect, it, vi } from "vitest";
import { AndroidCheckpointDriver, compareAndroidCheckpoint } from "../src/checkpoint.js";
import { compareAndroidVisualScreenshot, resolveAndroidAnchoredRegion } from "../src/checkpoint.js";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { AndroidSession } from "../src/session.js";
import { replayAndroidPrimitive } from "../src/primitives.js";

const selector = { type: "android.widget.Button", text: "Down" };
function source(top: number, count = 1, width = 20) {
  return JSON.stringify({ hierarchy: { node: Array.from({ length: count }, () => ({
    class: selector.type, text: selector.text, enabled: "true",
    bounds: `[10,${top}][${10 + width},${top + 10}]`,
  })) } });
}

describe("content-anchored visual checkpoints", () => {
  const expected = { referencePath: "reference.png", region: { left: 10, top: 60, width: 20, height: 20 },
    anchor: { selector, referenceSourcePath: "source.json" } };

  it("translates only the original crop using a unique same-size landmark", () => {
    expect(resolveAndroidAnchoredRegion(expected, source(100), source(45)))
      .toEqual({ left: 10, top: 5, width: 20, height: 20 });
  });

  it("fails closed for missing, duplicate, resized, invalid and unavailable anchors", () => {
    for (const live of [source(45, 0), source(45, 2), source(45, 1, 21), source(0), undefined])
      expect(() => resolveAndroidAnchoredRegion(expected, source(100), live)).toThrow();
    expect(() => resolveAndroidAnchoredRegion(expected, source(100, 2), source(45))).toThrow();
    expect(() => resolveAndroidAnchoredRegion({ ...expected, region: undefined }, source(100), source(45))).toThrow();
    expect(() => resolveAndroidAnchoredRegion({ ...expected, anchor: { ...expected.anchor, selector: {} } }, source(100), source(45))).toThrow();
  });

  it("accepts translated positive pixels but rejects a changed state without loosening thresholds", async () => {
    const root = await mkdtemp(join(tmpdir(), "actonce-anchor-"));
    const referencePath = join(root, "reference.png"), referenceSourcePath = join(root, "source.json");
    const image = async (top: number, wrong = false) => sharp({ create: { width: 80, height: 150, channels: 3, background: "white" } })
      .composite([{ input: await sharp({ create: { width: 10, height: 10, channels: 3, background: "black" } }).png().toBuffer(),
        left: wrong ? 20 : 10, top }]).png().toBuffer();
    await writeFile(referencePath, await image(60));
    await writeFile(referenceSourcePath, source(100));
    const spec = { ...expected, referencePath, anchor: { selector, referenceSourcePath }, resizeWidth: 80, pixelThreshold: 16, maxDifferenceRatio: 0.03 };
    const positive = await compareAndroidVisualScreenshot((await image(5)).toString("base64"), spec, source(45));
    const negative = await compareAndroidVisualScreenshot((await image(5, true)).toString("base64"), spec, source(45));
    expect(positive.differenceRatio).toBe(0);
    expect(positive.height).toBe(80);
    expect(positive.actualRegion?.top).toBe(5);
    expect(negative.differenceRatio).toBeGreaterThan(0.03);
    const sourceCapture = vi.fn(async () => source(45));
    const driver = new AndroidCheckpointDriver({ source: sourceCapture, screenshot: async () => (await image(5)).toString("base64"), invalidateObservation: vi.fn() } as never);
    expect((await driver.verify({ id: "anchored", expected: { visual: spec } })).status).toBe("matched");
    expect(sourceCapture).toHaveBeenCalledOnce();
  });
});

describe("visual crop aspect ratio", () => {
  it("uses the crop aspect instead of the original portrait frame", async () => {
    const directory = await mkdtemp(join(tmpdir(), "actonce-crop-aspect-"));
    const referencePath = join(directory, "reference.png");
    const image = await sharp({ create: { width: 120, height: 360, channels: 3, background: "white" } }).png().toBuffer();
    await writeFile(referencePath, image);
    const region = { left: 10, top: 20, width: 100, height: 20 };
    const cropped = await compareAndroidVisualScreenshot(image.toString("base64"), { referencePath, region, resizeWidth: 50 });
    expect(cropped).toMatchObject({ width: 50, height: 10, differenceRatio: 0, referenceRegion: region });
    const whole = await compareAndroidVisualScreenshot(image.toString("base64"), { referencePath, resizeWidth: 50 });
    expect(whole).toMatchObject({ width: 50, height: 150, differenceRatio: 0 });
  });
});

describe("compareAndroidCheckpoint", () => {
  it("checks required and forbidden UI-tree values", () => {
    expect(
      compareAndroidCheckpoint(
        {
          source: {
            includes: ["Checkout", "Rebecca Winter"],
            excludes: ["Login"],
          },
        },
        { source: "Checkout Rebecca Winter", captureErrors: [] },
      ),
    ).toEqual([]);
  });

  it("reports missing values", () => {
    expect(
      compareAndroidCheckpoint(
        { source: { includes: ["Checkout"] } },
        { source: "Products", captureErrors: [] },
      )[0]?.path,
    ).toBe("source");
  });

  it("invalidates a mismatched source so settle polling captures again", async () => {
    const invalidateObservation = vi.fn();
    const driver = new AndroidCheckpointDriver({ source: async () => "Products", invalidateObservation } as never);
    const result = await driver.verify({ id: "product", expected: { source: { includes: ["Add to cart"] } } });
    expect(result.status).toBe("mismatched");
    expect(invalidateObservation).toHaveBeenCalledOnce();
  });
});

describe("checkpoint observation freshness", () => {
  function fixture() {
    const capture = vi.fn()
      .mockResolvedValueOnce("ready")
      .mockResolvedValueOnce("moving")
      .mockResolvedValueOnce("ready");
    const tap = vi.fn(async () => {});
    const android: AndroidSession = Reflect.construct(AndroidSession, [
      { source: capture, tap }, "host-only-fake",
    ]);
    return { android, capture, tap, driver: new AndroidCheckpointDriver(android) };
  }
  const checkpoint = (id: string) => ({
    id, expected: { source: { includes: ["ready"] } },
  });

  it("refreshes repeated checkpoint IDs even with separately constructed specs", async () => {
    const { driver, capture } = fixture();
    expect((await driver.verify(checkpoint("stable"))).status).toBe("matched");
    expect((await driver.verify(checkpoint("stable"))).status).toBe("mismatched");
    expect(capture).toHaveBeenCalledTimes(2);
    expect((await driver.verify(checkpoint("stable"))).status).toBe("matched");
    expect(capture).toHaveBeenCalledTimes(3);
  });

  it("reuses matched post evidence for distinct adjacent pre until a primitive invalidates", async () => {
    const { android, driver, capture, tap } = fixture();
    expect((await driver.verify(checkpoint("post"))).status).toBe("matched");
    expect((await driver.verify(checkpoint("next-pre"))).status).toBe("matched");
    expect(capture).toHaveBeenCalledTimes(1);
    await replayAndroidPrimitive(android, { operation: "tap", arguments: [{ x: 1, y: 1 }] });
    expect(tap).toHaveBeenCalledOnce();
    expect((await driver.verify(checkpoint("after-primitive"))).status).toBe("mismatched");
    expect(capture).toHaveBeenCalledTimes(2);
    expect((await driver.verify(checkpoint("retry"))).status).toBe("matched");
    expect(capture).toHaveBeenCalledTimes(3);
  });
});
