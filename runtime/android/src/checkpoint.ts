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

export type AndroidVisualExpectation = {
  referencePath: string;
  region?: { left: number; top: number; width: number; height: number };
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
  constructor(private readonly android: AndroidSession) {}
  async verify(
    spec: CheckpointSpec<AndroidCheckpointExpectation>,
    context?: CheckpointVerificationContext,
  ): Promise<CheckpointResult<AndroidCheckpointActual>> {
    const actual: AndroidCheckpointActual = { captureErrors: [] };
    if (context?.signal.aborted)
      actual.captureErrors.push("checkpoint deadline exceeded before capture");
    if (!actual.captureErrors.length && spec.expected.source)
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
): Promise<AndroidVisualComparison> {
  const { default: sharp } = await import("sharp");
  const width = integer(expected.resizeWidth ?? 256);
  const threshold = byte(expected.pixelThreshold ?? 16);
  const reference = expected.region
    ? sharp(expected.referencePath).extract(expected.region)
    : sharp(expected.referencePath);
  const actual = expected.region
    ? sharp(Buffer.from(actualBase64, "base64")).extract(expected.region)
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
  };
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
