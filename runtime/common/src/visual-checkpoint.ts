import type {
  VisualCaptureSession,
  VisualComparator,
  VisualCompareResult,
  VisualFrame,
  VisualRegion,
} from "./device.js";
import type {
  CheckpointDifference,
  CheckpointDriver,
  CheckpointResult,
  CheckpointSpec,
  CheckpointVerificationContext,
} from "./types.js";

export type VisualCheckpointExpectation = {
  referenceId: string;
  region?: VisualRegion;
  comparator: VisualComparator;
  /**
   * An observed frame must be closer to the positive reference than to this
   * recorded negative state. This prevents a small but semantically important
   * transition (for example, a tooltip appearing) from being swallowed by a
   * whole-window pixel-difference threshold.
   */
  contrast?: {
    referenceId: string;
    minimumSeparationRatio: number;
    comparator?: VisualComparator;
  };
  persistCapture?: boolean;
};

export type VisualCheckpointActual = {
  frame?: VisualFrame;
  positive?: VisualCompareResult;
  negative?: VisualCompareResult;
  captureErrors: string[];
  metrics: {
    captureDurationMs: number;
    compareDurationMs: number;
    totalDurationMs: number;
    captureCount: number;
    compareCount: number;
  };
};

/** A screenshot-only checkpoint driver for recordings without tree evidence. */
export class VisualCheckpointDriver
implements CheckpointDriver<VisualCheckpointExpectation, VisualCheckpointActual> {
  constructor(
    private readonly session: VisualCaptureSession,
    private readonly now: () => number = () => performance.now(),
  ) {}

  async verify(
    spec: CheckpointSpec<VisualCheckpointExpectation>,
    context?: CheckpointVerificationContext,
  ): Promise<CheckpointResult<VisualCheckpointActual>> {
    const now = this.now;
    const started = now();
    const actual: VisualCheckpointActual = {
      captureErrors: [],
      metrics: {
        captureDurationMs: 0,
        compareDurationMs: 0,
        totalDurationMs: 0,
        captureCount: 0,
        compareCount: 0,
      },
    };
    const differences: CheckpointDifference[] = [];
    if (expired(context, now())) {
      actual.captureErrors.push("checkpoint deadline exceeded before capture");
      return finish("unknown");
    }

    try {
      const captureStarted = now();
      actual.frame = await this.session.capture({
        region: spec.expected.region,
        persist: spec.expected.persistCapture,
      });
      actual.metrics.captureDurationMs += Math.max(0, now() - captureStarted);
      actual.metrics.captureCount += 1;
    } catch (error) {
      actual.captureErrors.push(`visual: ${message(error)}`);
      return finish("unknown");
    }
    if (expired(context, now())) {
      actual.captureErrors.push("checkpoint deadline exceeded during screenshot capture");
      return finish("unknown");
    }

    try {
      const compareStarted = now();
      actual.positive = await this.session.compare({
        frameId: actual.frame.frameId,
        referenceId: spec.expected.referenceId,
        region: spec.expected.region,
        comparator: spec.expected.comparator,
      });
      actual.metrics.compareCount += 1;
      if (spec.expected.contrast) {
        actual.negative = await this.session.compare({
          frameId: actual.frame.frameId,
          referenceId: spec.expected.contrast.referenceId,
          region: spec.expected.region,
          comparator: spec.expected.contrast.comparator ?? spec.expected.comparator,
        });
        actual.metrics.compareCount += 1;
      }
      actual.metrics.compareDurationMs += Math.max(0, now() - compareStarted);
    } catch (error) {
      actual.captureErrors.push(`visual compare: ${message(error)}`);
      return finish("unknown");
    }

    if (!actual.positive.matched) {
      differences.push({
        path: "visual.positive",
        expected: { referenceId: spec.expected.referenceId },
        actual: actual.positive,
        message: "Screenshot does not match the recorded positive state",
      });
    }
    const contrast = spec.expected.contrast;
    if (contrast) {
      const positiveRatio = actual.positive.differenceRatio;
      const negativeRatio = actual.negative?.differenceRatio;
      if (positiveRatio === undefined || negativeRatio === undefined) {
        actual.captureErrors.push("contrastive comparison did not report difference ratios");
        return finish("unknown");
      }
      const separation = negativeRatio - positiveRatio;
      if (separation < contrast.minimumSeparationRatio) {
        differences.push({
          path: "visual.contrast.separationRatio",
          expected: { minimum: contrast.minimumSeparationRatio },
          actual: { separation, positiveRatio, negativeRatio },
          message: "Screenshot is not sufficiently closer to the positive state than the recorded negative state",
        });
      }
    }
    return finish(differences.length ? "mismatched" : "matched");

    function finish(
      status: CheckpointResult<VisualCheckpointActual>["status"],
    ): CheckpointResult<VisualCheckpointActual> {
      actual.metrics.totalDurationMs = Math.max(0, now() - started);
      return {
        status,
        actual,
        differences: status === "unknown"
          ? actual.captureErrors.map((error, index) => ({
              path: `captureErrors.${index}`,
              actual: error,
              message: error,
            }))
          : differences,
      };
    }
  }
}

function expired(context: CheckpointVerificationContext | undefined, now: number): boolean {
  return context?.signal.aborted === true || now > (context?.deadlineMs ?? Infinity);
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
