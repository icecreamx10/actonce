import type {
  CheckpointDifference,
  CheckpointDriver,
  CheckpointResult,
  CheckpointSpec,
  CheckpointVerificationContext,
  FallbackDriver,
  FallbackPolicy,
  ReplayEvent,
} from "@byted-lynx/actonce-replay";
import { ReplayFlow } from "@byted-lynx/actonce-replay";
import type { AndroidSession } from "./session.js";
import type { AndroidNodeSelector } from "./types.js";
import { readFile } from "node:fs/promises";

export type AndroidVisualRegion = { left: number; top: number; width: number; height: number };

export type AndroidVisualExpectation = {
  referencePath: string;
  region?: AndroidVisualRegion;
  /** Agent-selected landmark, in physical screenshot pixels. Translation only. */
  anchor?: { selector: AndroidNodeSelector; referenceSourcePath: string };
  resizeWidth?: number;
  pixelThreshold?: number;
  maxDifferenceRatio?: number;
};
export type AndroidVisualComparison = {
  referencePath: string;
  differenceRatio: number;
  meanAbsoluteDifference: number;
  width: number;
  height: number;
  referenceRegion?: AndroidVisualRegion;
  actualRegion?: AndroidVisualRegion;
};
export type AndroidCheckpointExpectation = {
  source?: { includes?: string[]; excludes?: string[] };
  visual?: AndroidVisualExpectation;
  captureScreenshot?: boolean;
};
export type AndroidCheckpointActual = {
  source?: string;
  screenshotBase64?: string;
  visual?: AndroidVisualComparison;
  captureErrors: string[];
};
export type AndroidReplayFlowOptions = {
  policy?: FallbackPolicy;
  fallback?: FallbackDriver<
    AndroidCheckpointExpectation,
    AndroidCheckpointActual
  >;
  emit?: (event: ReplayEvent<AndroidCheckpointActual>) => void | Promise<void>;
};

export function createAndroidReplayFlow(
  android: AndroidSession,
  options: AndroidReplayFlowOptions = {},
) {
  return new ReplayFlow({
    checkpoints: new AndroidCheckpointDriver(android),
    policy: options.policy,
    fallback: options.fallback,
    emit: options.emit,
  });
}
export class AndroidCheckpointDriver
  implements
    CheckpointDriver<AndroidCheckpointExpectation, AndroidCheckpointActual>
{
  private lastCheckpointId?: string;
  constructor(private readonly android: AndroidSession) {}
  async verify(
    spec: CheckpointSpec<AndroidCheckpointExpectation>,
    context?: CheckpointVerificationContext,
  ): Promise<CheckpointResult<AndroidCheckpointActual>> {
    // Stability samples need fresh evidence; distinct adjacent contracts may reuse it.
    if (this.lastCheckpointId === spec.id) this.android.invalidateObservation();
    this.lastCheckpointId = spec.id;
    const actual: AndroidCheckpointActual = { captureErrors: [] };
    if (context?.signal.aborted)
      actual.captureErrors.push("checkpoint deadline exceeded before capture");
    if (!actual.captureErrors.length && (spec.expected.source || spec.expected.visual?.anchor))
      try {
        actual.source = await this.android.source();
      } catch (error) {
        actual.captureErrors.push(`source: ${message(error)}`);
      }
    if (
      !actual.captureErrors.length &&
      (spec.expected.captureScreenshot || spec.expected.visual)
    )
      try {
        actual.screenshotBase64 = await this.android.screenshot();
        if (
          context?.signal.aborted ||
          Date.now() > (context?.deadlineMs ?? Infinity)
        )
          actual.captureErrors.push(
            "checkpoint deadline exceeded during screenshot capture",
          );
        else if (spec.expected.visual)
          actual.visual = await compareAndroidVisualScreenshot(
            actual.screenshotBase64,
            spec.expected.visual,
            actual.source,
          );
      } catch (error) {
        actual.captureErrors.push(`screenshot: ${message(error)}`);
      }
    const differences = compareAndroidCheckpoint(spec.expected, actual);
    const result: CheckpointResult<AndroidCheckpointActual> = {
      status: actual.captureErrors.length
        ? "unknown"
        : differences.length
          ? "mismatched"
          : "matched",
      actual,
      differences,
    };
    if (result.status !== "matched") this.android.invalidateObservation();
    return result;
  }
}
export function compareAndroidCheckpoint(
  expected: AndroidCheckpointExpectation,
  actual: AndroidCheckpointActual,
): CheckpointDifference[] {
  const differences: CheckpointDifference[] = [];
  for (const value of expected.source?.includes ?? [])
    if (!actual.source?.includes(value))
      differences.push({
        path: "source",
        expected: `includes ${value}`,
        actual: actual.source,
        message: `Android UI tree does not include ${JSON.stringify(value)}`,
      });
  for (const value of expected.source?.excludes ?? [])
    if (actual.source?.includes(value))
      differences.push({
        path: "source",
        expected: `excludes ${value}`,
        actual: actual.source,
        message: `Android UI tree unexpectedly includes ${JSON.stringify(value)}`,
      });
  if (expected.visual) {
    if (!actual.visual)
      differences.push({
        path: "visual",
        expected: expected.visual,
        message: "Visual checkpoint was not compared",
      });
    else if (
      actual.visual.differenceRatio >
      (expected.visual.maxDifferenceRatio ?? 0.03)
    )
      differences.push({
        path: "visual.differenceRatio",
        expected: { maximum: expected.visual.maxDifferenceRatio ?? 0.03 },
        actual: actual.visual,
        message: `Screenshot difference ratio ${actual.visual.differenceRatio.toFixed(4)} exceeds ${expected.visual.maxDifferenceRatio ?? 0.03}`,
      });
  }
  return differences;
}
export async function compareAndroidVisualScreenshot(
  actualBase64: string,
  expected: AndroidVisualExpectation,
  actualSource?: string,
): Promise<AndroidVisualComparison> {
  const { default: sharp } = await import("sharp");
  const width = integer(expected.resizeWidth ?? 256);
  const threshold = byte(expected.pixelThreshold ?? 16);
  const actualRegion = expected.anchor
    ? resolveAndroidAnchoredRegion(
        expected,
        await readFile(expected.anchor.referenceSourcePath, "utf8"),
        actualSource,
      )
    : expected.region;
  const reference = expected.region
    ? sharp(expected.referencePath).extract(expected.region)
    : sharp(expected.referencePath);
  const actual = actualRegion
    ? sharp(Buffer.from(actualBase64, "base64")).extract(actualRegion)
    : sharp(Buffer.from(actualBase64, "base64"));
  const metadata = await reference.clone().metadata();
  if (!metadata.width || !metadata.height)
    throw new Error("Visual reference has no dimensions");
  const height = Math.max(
    1,
    Math.round((width * metadata.height) / metadata.width),
  );
  const [left, right] = await Promise.all([
    reference
      .resize(width, height, { fit: "fill" })
      .greyscale()
      .raw()
      .toBuffer(),
    actual.resize(width, height, { fit: "fill" }).greyscale().raw().toBuffer(),
  ]);
  if (!left.length || left.length !== right.length)
    throw new Error("Visual checkpoint produced incompatible pixel buffers");
  let differing = 0,
    absolute = 0;
  for (let index = 0; index < left.length; index += 1) {
    const delta = Math.abs(left[index] - right[index]);
    absolute += delta;
    if (delta > threshold) differing += 1;
  }
  return {
    referencePath: expected.referencePath,
    differenceRatio: differing / left.length,
    meanAbsoluteDifference: absolute / left.length,
    width,
    height,
    referenceRegion: expected.region,
    actualRegion,
  };
}

/** Resolve a proven landmark without searching the image for a favorable match. */
export function resolveAndroidAnchoredRegion(
  expected: AndroidVisualExpectation,
  referenceSource: string,
  actualSource?: string,
): AndroidVisualRegion {
  if (!expected.anchor || !expected.region)
    throw new TypeError("visual anchor requires an explicit reference region");
  const selector = expected.anchor.selector;
  if (!Object.values(selector).some(value => typeof value === "string" && value.length > 0))
    throw new TypeError("visual anchor selector must not be empty");
  const reference = uniqueAnchorBounds(referenceSource, selector);
  const actual = uniqueAnchorBounds(actualSource, selector);
  if (reference.width !== actual.width || reference.height !== actual.height)
    throw new Error("visual anchor size changed; translation-only alignment refused");
  const region = {
    ...expected.region,
    left: expected.region.left + actual.left - reference.left,
    top: expected.region.top + actual.top - reference.top,
  };
  if (!Number.isInteger(region.left) || !Number.isInteger(region.top) || region.left < 0 || region.top < 0
      || !Number.isInteger(region.width) || region.width <= 0 || !Number.isInteger(region.height) || region.height <= 0)
    throw new Error("visual anchor resolved an invalid crop");
  return region;
}

function uniqueAnchorBounds(source: string | undefined, selector: AndroidNodeSelector): AndroidVisualRegion {
  if (!source) throw new Error("visual anchor requires native source evidence");
  const matches: Record<string, unknown>[] = [];
  const visit = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) { value.forEach(visit); return; }
    const node = value as Record<string, unknown>;
    if (typeof node.class === "string"
        && (selector.type === undefined || node.class === selector.type)
        && (selector.text === undefined || node.text === selector.text)
        && (selector.contentDescription === undefined || node["content-desc"] === selector.contentDescription)
        && (selector.resourceId === undefined || node["resource-id"] === selector.resourceId)) matches.push(node);
    Object.values(node).forEach(visit);
  };
  visit(JSON.parse(source));
  if (matches.length !== 1) throw new Error(`visual anchor requires exactly one native node, found ${matches.length}`);
  const node = matches[0]!;
  if (node.enabled === "false" || node["visible-to-user"] === "false")
    throw new Error("visual anchor is disabled or not visible");
  const bounds = typeof node.bounds === "string" && node.bounds.match(/^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$/);
  if (!bounds) throw new Error("visual anchor has invalid physical bounds");
  const left = Number(bounds[1]), top = Number(bounds[2]);
  const width = Number(bounds[3]) - left, height = Number(bounds[4]) - top;
  if (width <= 0 || height <= 0) throw new Error("visual anchor has empty bounds");
  return { left, top, width, height };
}
function integer(value: number): number {
  if (!Number.isInteger(value) || value <= 0)
    throw new TypeError("visual resizeWidth must be positive");
  return value;
}
function byte(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 255)
    throw new TypeError("visual pixelThreshold must be 0..255");
  return value;
}
function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
