import type { CheckpointResult, CheckpointSpec, ReplayDiagnostics, ReplayFlowOptions, ReplaySegment } from "./types.js";
export declare class ReplayFlow<TExpectation, TActual> {
    private readonly options;
    private readonly policy;
    private fallbackCount;
    private fallbackDurationMs;
    private checkpointPollCount;
    private checkpointCaptureDurationMs;
    private checkpointSettleDelayMs;
    private checkpointWaitDurationMs;
    private checkpointTimeoutCount;
    private readonly segmentProfiles;
    constructor(options: ReplayFlowOptions<TExpectation, TActual>);
    diagnostics(): ReplayDiagnostics;
    private profileFor;
    checkpoint(segmentId: string, phase: "precondition" | "postcondition", spec: CheckpointSpec<TExpectation>, context?: {
        deadlineMs: number;
        signal: AbortSignal;
    }): Promise<CheckpointResult<TActual>>;
    /**
     * Wait for a standalone checkpoint using the same settle scheduler and
     * diagnostics as segment pre/postconditions. This is useful for externally
     * driven E2E actions whose execution remains outside ActOnce.
     */
    waitForCheckpoint(segmentId: string, phase: "precondition" | "postcondition", spec: CheckpointSpec<TExpectation>): Promise<CheckpointResult<TActual>>;
    segment(segment: ReplaySegment<TExpectation>): Promise<void>;
    private ensure;
    private settleCheckpoint;
    private completeSettle;
    private emit;
}
//# sourceMappingURL=flow.d.ts.map