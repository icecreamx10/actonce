export type CheckpointStatus = "matched" | "mismatched" | "unknown";
export type FallbackPolicy = "disabled" | "recover";
export type SegmentIdempotency = "safe" | "observe-before-retry" | "never-retry";
export type CheckpointDifference = {
    path: string;
    expected?: unknown;
    actual?: unknown;
    message: string;
};
export type CheckpointSpec<TExpectation> = {
    id: string;
    expected: TExpectation;
    settle?: CheckpointSettlePolicy;
};
export type CheckpointSettlePolicy = {
    timeoutMs: number;
    intervalMs?: number;
    consecutiveMatches?: number;
};
export type CheckpointResult<TActual> = {
    status: CheckpointStatus;
    actual: TActual;
    differences: CheckpointDifference[];
};
export interface CheckpointDriver<TExpectation, TActual> {
    verify(spec: CheckpointSpec<TExpectation>, context?: CheckpointVerificationContext): Promise<CheckpointResult<TActual>>;
}
export type CheckpointVerificationContext = {
    deadlineMs: number;
    signal: AbortSignal;
};
export type FallbackRequest<TExpectation, TActual> = {
    segmentId: string;
    phase: "precondition" | "postcondition";
    goal: string;
    expected: CheckpointSpec<TExpectation>;
    actual: TActual;
    differences: CheckpointDifference[];
    idempotency: SegmentIdempotency;
    attempt: number;
    constraints: {
        maxActions?: number;
        timeoutMs?: number;
        allowedApps?: string[];
        forbiddenActions?: string[];
        observationOnly: boolean;
    };
};
export type FallbackResult = {
    status: "completed" | "declined" | "failed";
    actionCount?: number;
    reason?: string;
};
export type ReplayDiagnostics = {
    strategy: "deterministic" | "hybrid";
    fallbackCount: number;
    fallbackDurationMs: number;
    checkpointPollCount: number;
    checkpointCaptureDurationMs: number;
    checkpointSettleDelayMs: number;
    /** @deprecated Use checkpointCaptureDurationMs and checkpointSettleDelayMs. */
    checkpointWaitDurationMs: number;
    checkpointTimeoutCount: number;
};
export interface FallbackDriver<TExpectation, TActual> {
    recover(request: FallbackRequest<TExpectation, TActual>): Promise<FallbackResult>;
}
export type ReplayFallback = {
    goal: string;
    maxAttempts?: number;
    maxActions?: number;
    timeoutMs?: number;
    allowedApps?: string[];
    forbiddenActions?: string[];
};
export type ReplaySegment<TExpectation> = {
    id: string;
    precondition: CheckpointSpec<TExpectation>;
    deterministic: () => Promise<void> | void;
    postcondition: CheckpointSpec<TExpectation>;
    fallback?: ReplayFallback;
    idempotency?: SegmentIdempotency;
};
export type ReplayEvent<TActual = unknown> = {
    kind: "replay.segment.started" | "replay.checkpoint.checked" | "replay.checkpoint.settle.started" | "replay.checkpoint.settle.completed" | "replay.checkpoint.settle.timed-out" | "replay.deterministic.started" | "replay.deterministic.completed" | "replay.deterministic.failed" | "replay.fallback.started" | "replay.fallback.completed" | "replay.segment.completed" | "replay.segment.failed";
    segmentId: string;
    phase?: "precondition" | "deterministic" | "postcondition";
    checkpointId?: string;
    checkpoint?: CheckpointResult<TActual>;
    checkCount?: number;
    attempt?: number;
    fallbackResult?: FallbackResult;
    durationMs?: number;
    captureDurationMs?: number;
    settleDelayMs?: number;
    error?: {
        name: string;
        message: string;
    };
    monotonicNs: string;
};
export type ReplayFlowOptions<TExpectation, TActual> = {
    checkpoints: CheckpointDriver<TExpectation, TActual>;
    policy?: FallbackPolicy;
    fallback?: FallbackDriver<TExpectation, TActual>;
    emit?: (event: ReplayEvent<TActual>) => void | Promise<void>;
    now?: () => number;
    delay?: (durationMs: number) => Promise<void>;
};
//# sourceMappingURL=types.d.ts.map