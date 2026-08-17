import type {
  CheckpointDifference, CheckpointDriver, CheckpointResult, CheckpointSpec,
  CheckpointVerificationContext, CorrectiveDemonstration, FallbackDriver, FallbackPolicy,
  ReplayEvent, SegmentProfile,
} from "@byted-lynx/actonce-replay";
import { ReplayFlow } from "@byted-lynx/actonce-replay";
import type { IOSSession } from "./session.js";

export type IOSTextExpectation = { equals?: string; includes?: string; matches?: string };
export type IOSVisualExpectation = {
  referencePath: string;
  region?: { left: number; top: number; width: number; height: number };
  resizeWidth?: number;
  pixelThreshold?: number;
  maxDifferenceRatio?: number;
};
export type IOSVisualComparison = {
  referencePath: string; differenceRatio: number; meanAbsoluteDifference: number; width: number; height: number;
};
export type IOSCheckpointExpectation = {
  source?: { includes?: string[]; excludes?: string[] };
  visual?: IOSVisualExpectation;
  captureScreenshot?: boolean;
};
export type IOSCheckpointActual = {
  source?: string; screenshotBase64?: string; visual?: IOSVisualComparison; captureErrors: string[];
};
export type IOSReplayFlowOptions = {
  policy?: FallbackPolicy;
  fallback?: FallbackDriver<IOSCheckpointExpectation, IOSCheckpointActual>;
  emit?: (event: ReplayEvent<IOSCheckpointActual>) => void | Promise<void>;
  onSegmentProfiled?: (
    profile: SegmentProfile,
    correctives: CorrectiveDemonstration[],
  ) => void | Promise<void>;
};

export function createIOSReplayFlow(ios: IOSSession, options: IOSReplayFlowOptions = {}) {
  return new ReplayFlow({
    checkpoints: new IOSCheckpointDriver(ios), policy: options.policy,
    fallback: options.fallback, emit: options.emit,
    onSegmentProfiled: options.onSegmentProfiled,
  });
}

export class IOSCheckpointDriver implements CheckpointDriver<IOSCheckpointExpectation, IOSCheckpointActual> {
  constructor(private readonly ios: IOSSession) {}
  async verify(spec: CheckpointSpec<IOSCheckpointExpectation>, context?: CheckpointVerificationContext): Promise<CheckpointResult<IOSCheckpointActual>> {
    const actual: IOSCheckpointActual = { captureErrors: [] };
    if (context?.signal.aborted) actual.captureErrors.push("checkpoint deadline exceeded before capture");
    if (!actual.captureErrors.length && spec.expected.source) {
      try { actual.source = await this.ios.source(); } catch (error) { actual.captureErrors.push(`source: ${message(error)}`); }
    }
    if (!actual.captureErrors.length && (spec.expected.captureScreenshot || spec.expected.visual)) {
      try {
        actual.screenshotBase64 = await this.ios.screenshot();
        if (context?.signal.aborted || Date.now() > (context?.deadlineMs ?? Infinity)) {
          actual.captureErrors.push("checkpoint deadline exceeded during screenshot capture");
        } else if (spec.expected.visual) {
          actual.visual = await compareIOSVisualScreenshot(actual.screenshotBase64, spec.expected.visual);
        }
      } catch (error) { actual.captureErrors.push(`screenshot: ${message(error)}`); }
    }
    const differences = compareIOSCheckpoint(spec.expected, actual);
    const result: CheckpointResult<IOSCheckpointActual> = { status: actual.captureErrors.length ? "unknown" : differences.length ? "mismatched" : "matched", actual, differences };
    if (result.status !== "matched") this.ios.invalidateObservation();
    return result;
  }
}

export function compareIOSCheckpoint(expected: IOSCheckpointExpectation, actual: IOSCheckpointActual): CheckpointDifference[] {
  const differences: CheckpointDifference[] = [];
  for (const value of expected.source?.includes ?? []) if (!actual.source?.includes(value)) differences.push({ path: "source", expected: `includes ${value}`, actual: actual.source, message: `WDA source does not include ${JSON.stringify(value)}` });
  for (const value of expected.source?.excludes ?? []) if (actual.source?.includes(value)) differences.push({ path: "source", expected: `excludes ${value}`, actual: actual.source, message: `WDA source unexpectedly includes ${JSON.stringify(value)}` });
  if (expected.visual) {
    if (!actual.visual) differences.push({ path: "visual", expected: expected.visual, message: "Visual checkpoint was not compared" });
    else if (actual.visual.differenceRatio > (expected.visual.maxDifferenceRatio ?? 0.03)) differences.push({ path: "visual.differenceRatio", expected: { maximum: expected.visual.maxDifferenceRatio ?? 0.03 }, actual: actual.visual, message: `Screenshot difference ratio ${actual.visual.differenceRatio.toFixed(4)} exceeds ${expected.visual.maxDifferenceRatio ?? 0.03}` });
  }
  return differences;
}

export async function compareIOSVisualScreenshot(actualBase64: string, expected: IOSVisualExpectation): Promise<IOSVisualComparison> {
  const { default: sharp } = await import("sharp");
  const width = positiveInteger(expected.resizeWidth ?? 256, "visual resizeWidth");
  const threshold = byte(expected.pixelThreshold ?? 16, "visual pixelThreshold");
  const reference = expected.region ? sharp(expected.referencePath).extract(expected.region) : sharp(expected.referencePath);
  const actual = expected.region ? sharp(Buffer.from(actualBase64, "base64")).extract(expected.region) : sharp(Buffer.from(actualBase64, "base64"));
  const metadata = await reference.clone().metadata();
  if (!metadata.width || !metadata.height) throw new Error("Visual reference has no dimensions");
  const height = Math.max(1, Math.round(width * metadata.height / metadata.width));
  const [left, right] = await Promise.all([reference.resize(width, height, { fit: "fill" }).greyscale().raw().toBuffer(), actual.resize(width, height, { fit: "fill" }).greyscale().raw().toBuffer()]);
  if (!left.length || left.length !== right.length) throw new Error("Visual checkpoint produced incompatible pixel buffers");
  let differing = 0, absolute = 0;
  for (let index = 0; index < left.length; index += 1) { const delta = Math.abs(left[index] - right[index]); absolute += delta; if (delta > threshold) differing += 1; }
  return { referencePath: expected.referencePath, differenceRatio: differing / left.length, meanAbsoluteDifference: absolute / left.length, width, height };
}
function positiveInteger(value: number, label: string): number { if (!Number.isInteger(value) || value <= 0) throw new TypeError(`${label} must be positive`); return value; }
function byte(value: number, label: string): number { if (!Number.isInteger(value) || value < 0 || value > 255) throw new TypeError(`${label} must be 0..255`); return value; }
function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
