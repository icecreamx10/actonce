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
  /**
   * Marks this checkpoint as a frozen state contract == a segment boundary.
   * Defaults to true for segment pre/postconditions. An important checkpoint is
   * the sole acceptance oracle; only it decides whether a step succeeded. Its
   * `expected` assertion is immutable across recompilations (the *what*); how the
   * app reaches it (the deterministic action) is replaceable (the *how*).
   */
  important?: boolean;
  /**
   * Optional human label for the app state this checkpoint asserts arrival at,
   * e.g. "settings.about". Surfaced in the executor's checkpoint-centric result
   * so a failure names *which* state was not reached, and becomes the StateNode
   * id in the state-graph extension (design §11).
   */
  state?: string;
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
  verify(
    spec: CheckpointSpec<TExpectation>,
    context?: CheckpointVerificationContext,
  ): Promise<CheckpointResult<TActual>>;
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
 * (skills/synthesize-device-replay/SKILL.md).
 */
export type CorrectiveAction = {
  kind: string;        // normalized: "tap" | "type" | "scroll" | "key" | ...
  target?: string;     // normalized selector/description; never raw secrets
  atMonotonicNs?: string;
};

/** The captured demonstration of one script-level agent fallback. */
export type CorrectiveDemonstration = {
  segmentId: string;
  phase: "precondition" | "postcondition";
  attempt: number;
  actions: CorrectiveAction[];
  evidenceRefs?: string[]; // artifact path / sha references only, never bytes
  summary?: string;        // sanitized recap, NOT raw model reasoning
};

export type FallbackResult = {
  status: "completed" | "declined" | "failed";
  actionCount?: number;
  reason?: string;
  corrective?: CorrectiveDemonstration;
};

export type SegmentOutcome =
  | "matched"              // postcondition matched cleanly, no deopt
  | "recovered"            // matched only after fallback
  | "deterministic-failed" // deterministic() threw (and did not recover)
  | "fallback-failed"      // fallback ran but postcondition never matched
  | "mismatched";          // failed closed (policy disabled / no fallback)

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
  guard: { precondition: SegmentGuardCost; postcondition: SegmentGuardCost };
  fallback: { count: number; durationMs: number; outcomes: SegmentFallbackOutcomes };
  outcome: SegmentOutcome;   // final outcome of the most recent run
  matchedCleanly: boolean;   // postcondition matched with zero deopts
};

export type ReplayDiagnostics = {
  strategy: "deterministic" | "hybrid";
  deterministicRetryCount: number;
  deterministicRetryDurationMs: number;
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
  deterministicRetry?: {
    action: () => Promise<void> | void;
    maxAttempts?: number;
  };
  postcondition: CheckpointSpec<TExpectation>;
  fallback?: ReplayFallback;
  idempotency?: SegmentIdempotency;
};

export type ReplayEvent<TActual = unknown> = {
  kind:
    | "replay.segment.started"
    | "replay.checkpoint.checked"
    | "replay.checkpoint.settle.started"
    | "replay.checkpoint.settle.completed"
    | "replay.checkpoint.settle.timed-out"
    | "replay.deterministic.started"
    | "replay.deterministic.completed"
    | "replay.deterministic.failed"
    | "replay.deterministic.retry.started"
    | "replay.deterministic.retry.completed"
    | "replay.deterministic.retry.failed"
    | "replay.fallback.started"
    | "replay.fallback.completed"
    | "replay.segment.completed"
    | "replay.segment.failed";
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
  error?: { name: string; message: string };
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
