import type { VisualCaptureSession, VisualComparator, VisualCompareResult, VisualFrame, VisualRegion } from "./device.js";
import type { CheckpointDriver, CheckpointResult, CheckpointSpec, CheckpointVerificationContext } from "./types.js";
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
export declare class VisualCheckpointDriver implements CheckpointDriver<VisualCheckpointExpectation, VisualCheckpointActual> {
    private readonly session;
    private readonly now;
    constructor(session: VisualCaptureSession, now?: () => number);
    verify(spec: CheckpointSpec<VisualCheckpointExpectation>, context?: CheckpointVerificationContext): Promise<CheckpointResult<VisualCheckpointActual>>;
}
//# sourceMappingURL=visual-checkpoint.d.ts.map