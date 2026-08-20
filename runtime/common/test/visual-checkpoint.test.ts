import { describe, expect, it, vi } from "vitest";
import { VisualCheckpointDriver } from "../src/visual-checkpoint.js";
import type { VisualCaptureSession, VisualCompareResult } from "../src/device.js";

describe("VisualCheckpointDriver", () => {
  it("rejects a negative state that also fits a loose positive threshold", async () => {
    const session = fakeSession({ positive: 0.0228, negative: 0 });
    const result = await new VisualCheckpointDriver(session).verify({
      id: "tooltip-visible",
      expected: {
        referenceId: "positive",
        comparator: { type: "pixelDiff", mismatchThreshold: 0.03 },
        contrast: { referenceId: "negative", minimumSeparationRatio: 0.01 },
      },
    });

    expect(result.status).toBe("mismatched");
    expect(result.differences[0]?.path).toBe("visual.contrast.separationRatio");
  });

  it("accepts a frame that is distinctly closer to the positive state", async () => {
    const session = fakeSession({ positive: 0.002, negative: 0.025 });
    const result = await new VisualCheckpointDriver(session).verify({
      id: "tooltip-visible",
      expected: {
        referenceId: "positive",
        comparator: { type: "pixelDiff", mismatchThreshold: 0.03 },
        contrast: { referenceId: "negative", minimumSeparationRatio: 0.01 },
      },
    });

    expect(result.status).toBe("matched");
    expect(session.capture).toHaveBeenCalledTimes(1);
    expect(session.compare).toHaveBeenCalledTimes(2);
  });
});

function fakeSession(ratios: { positive: number; negative: number }): VisualCaptureSession {
  const comparison = (referenceId: string): VisualCompareResult => {
    const differenceRatio = referenceId === "positive" ? ratios.positive : ratios.negative;
    return {
      matched: differenceRatio <= 0.03,
      differenceRatio,
      actualFrameId: "frame",
      referenceId,
      metrics: { captureDurationMs: 1, compareDurationMs: 1, totalDurationMs: 2 },
    };
  };
  return {
    capture: vi.fn(async () => ({
      frameId: "frame", sequence: 1, capturedAtMonotonicNs: "1",
      capturedAtWallTime: new Date(0).toISOString(), widthPx: 10, heightPx: 10,
      scaleFactor: 1, targetId: "target",
    })),
    registerReference: vi.fn(async () => ({ referenceId: "reference", widthPx: 10, heightPx: 10 })),
    compare: vi.fn(async ({ referenceId }) => comparison(referenceId)),
    waitStable: vi.fn(),
    close: vi.fn(async () => undefined),
  };
}
