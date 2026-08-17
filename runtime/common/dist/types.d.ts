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
/**
 * A single normalized action the agent took while recovering a segment.
 * Carries only the action kind and a normalized target — never raw values,
 * clipboard contents, screenshot bytes, or model reasoning
 * (skills/compile-device-recording/SKILL.md:46).
 */
export type CorrectiveAction = {
    kind: string;
    target?: string;
    atMonotonicNs?: string;
};
/**
 * The captured demonstration of one agent fallback ("deopt result"). Threaded
 * through the event stream and to onSegmentProfiled so offline tooling can
 * reason about how a segment was recovered without re-running the agent.
 */
export type CorrectiveDemonstration = {
    segmentId: string;
    phase: "precondition" | "postcondition";
    attempt: number;
    actions: CorrectiveAction[];
    evidenceRefs?: string[];
    summary?: string;
};
export type FallbackResult = {
    status: "completed" | "declined" | "failed";
    actionCount?: number;
    reason?: string;
    corrective?: CorrectiveDemonstration;
};
export type SegmentOutcome = "matched" | "recovered" | "deterministic-failed" | "fallback-failed" | "mismatched";
export type SegmentGuardCost = {
    captureDurationMs: number;
    settleDelayMs: number;
    pollCount: number;
    timeoutCount: number;
};
export type SegmentFallbackOutcomes = {
    completed: number;
    declined: number;
    failed: number;
};
export type SegmentProfile = {
    segmentId: string;
    runs: number;
    attempts: number;
    deterministicFailures: number;
    guard: {
        precondition: SegmentGuardCost;
        postcondition: SegmentGuardCost;
    };
    fallback: {
        count: number;
        durationMs: number;
        outcomes: SegmentFallbackOutcomes;
    };
    outcome: SegmentOutcome;
    matchedCleanly: boolean;
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
    /** Per-segment attribution, empty when no segment ran (e.g. bare checkpoints). */
    segments: SegmentProfile[];
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
    /**
     * Called after each segment resolves (both on success and before a failure
     * rethrows), with the finalized per-segment profile and any non-empty
     * corrective demonstrations captured during fallback. Injected so the flow
     * never touches a store or `fs` directly; runtime/common stays Midscene-free.
     */
    onSegmentProfiled?: (profile: SegmentProfile, correctives: CorrectiveDemonstration[]) => void | Promise<void>;
};
//# sourceMappingURL=types.d.ts.map