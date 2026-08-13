export type LynxtronObservation = {
  syntaxErrorVisible: boolean | null;
  tooltipVisible: boolean | null;
  tooltipMessage: string | null;
};

export type LynxtronRunResult = {
  schemaVersion: 1;
  benchmark: string;
  mode: "original" | "replay";
  runId: string;
  status: "passed" | "failed";
  executionDurationMs: number | null;
  replayDiagnostics?: {
    strategy: "deterministic" | "hybrid";
    fallbackCount: number;
    fallbackDurationMs: number;
    checkpointPollCount?: number;
    checkpointWaitDurationMs?: number;
    checkpointTimeoutCount?: number;
  };
  expected?: {
    syntaxErrorVisible: boolean;
    tooltipVisible: boolean;
    tooltipMessage: string;
  };
  observed?: LynxtronObservation;
  steps?: Array<{
    id: string;
    kind: string;
    status: "passed" | "failed" | "skipped";
    expected?: unknown;
    observed?: unknown;
  }>;
  artifacts?: {
    recording?: string | null;
    screenshots?: string[];
    assertionDecision?: string;
    [key: string]: unknown;
  };
  assertionDecision?: string;
};

export type LynxtronAiReview = {
  schemaVersion: 1;
  benchmark: string;
  reviewer: "ai";
  decision: "passed" | "failed";
  reason: string;
};

export type LynxtronEvaluation = {
  schemaVersion: 1;
  benchmark: string;
  originalRunId: string;
  replayRunIds: string[];
  dimensions: {
    correctness: {
      passed: boolean;
      cliPassed: boolean;
      aiPassed: boolean;
      successfulRuns: number;
      totalRuns: number;
      failures: Array<{ runId: string; reason: string }>;
    };
    speed: {
      comparable: boolean;
      originalDurationMs: number | null;
      replayDurationMs: number[];
      replayMedianDurationMs: number | null;
      speedup: number | null;
      reductionPercent: number | null;
      replayDiagnostics: Array<{
        runId: string;
        strategy: "deterministic" | "hybrid";
        fallbackCount: number;
        fallbackDurationMs: number;
      }>;
    };
  };
};

export function evaluateLynxtronBenchmark(
  original: LynxtronRunResult,
  replays: LynxtronRunResult[],
  aiReview?: LynxtronAiReview,
): LynxtronEvaluation {
  if (original.mode !== "original") throw new Error("Original result must have mode=original");
  if (replays.length !== 5) throw new Error("Exactly five replay results are required");
  const failures: Array<{ runId: string; reason: string }> = [];

  for (const replay of replays) {
    if (replay.mode !== "replay") {
      failures.push({ runId: replay.runId, reason: "result mode is not replay" });
    } else if (replay.benchmark !== original.benchmark) {
      failures.push({ runId: replay.runId, reason: "benchmark id differs from original" });
    } else if (replay.status !== "passed") {
      failures.push({ runId: replay.runId, reason: "replay status is failed" });
    } else if (!replay.assertionDecision ||
      replay.artifacts?.assertionDecision !== replay.assertionDecision) {
      failures.push({ runId: replay.runId, reason: "missing or contradicted assertion decision record reference" });
    } else {
      const assertionFailure = assertionFailureReason(original, replay);
      if (assertionFailure) failures.push({ runId: replay.runId, reason: assertionFailure });
    }
  }

  const replayDurations = replays
    .filter((run) => run.status === "passed")
    .map((run) => run.executionDurationMs)
    .filter((duration): duration is number =>
      typeof duration === "number" && Number.isFinite(duration) && duration > 0,
    );
  const replayDiagnostics = replays.map((run) => normalizeReplayDiagnostics(run));
  const originalDuration = validDuration(original.executionDurationMs);
  const replayMedian = replayDurations.length ? median(replayDurations) : null;
  const cliPassed = original.status === "passed" && failures.length === 0;
  const aiPassed = aiReview?.benchmark === original.benchmark && aiReview.decision === "passed";
  const correctnessPassed = cliPassed && aiPassed;
  const comparable = correctnessPassed && originalDuration !== null &&
    replayMedian !== null && replayDurations.length === replays.length;
  const speedup = comparable ? originalDuration / replayMedian : null;

  return {
    schemaVersion: 1,
    benchmark: original.benchmark,
    originalRunId: original.runId,
    replayRunIds: replays.map((run) => run.runId),
    dimensions: {
      correctness: {
        passed: correctnessPassed,
        cliPassed,
        aiPassed,
        successfulRuns: replays.length - failures.length,
        totalRuns: replays.length,
        failures,
      },
      speed: {
        comparable,
        originalDurationMs: originalDuration,
        replayDurationMs: replayDurations,
        replayMedianDurationMs: replayMedian,
        speedup,
        reductionPercent: speedup === null ? null : (1 - 1 / speedup) * 100,
        replayDiagnostics,
      },
    },
  };
}

function normalizeReplayDiagnostics(run: LynxtronRunResult): {
  runId: string;
  strategy: "deterministic" | "hybrid";
  fallbackCount: number;
  fallbackDurationMs: number;
} {
  const diagnostics = run.replayDiagnostics;
  if (!diagnostics) {
    return {
      runId: run.runId,
      strategy: "deterministic",
      fallbackCount: 0,
      fallbackDurationMs: 0,
    };
  }
  return {
    runId: run.runId,
    strategy: diagnostics.strategy,
    fallbackCount: nonNegative(diagnostics.fallbackCount),
    fallbackDurationMs: nonNegative(diagnostics.fallbackDurationMs),
  };
}

function nonNegative(value: number): number {
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function validDuration(value: number | null): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function sameObservation(observed: LynxtronObservation, expected: NonNullable<LynxtronRunResult["expected"]>): boolean {
  return observed.syntaxErrorVisible === expected.syntaxErrorVisible &&
    observed.tooltipVisible === expected.tooltipVisible &&
    observed.tooltipMessage === expected.tooltipMessage;
}

function assertionFailureReason(
  original: LynxtronRunResult,
  replay: LynxtronRunResult,
): string | null {
  if (original.steps?.length) {
    if (!replay.steps?.length) return "replay has no structured step assertions";
    const oracle = original.steps.filter((step) => step.expected !== undefined);
    for (const expectedStep of oracle) {
      const actual = replay.steps.find((step) => step.id === expectedStep.id);
      if (!actual) return `missing assertion step: ${expectedStep.id}`;
      if (actual.status !== "passed") return `assertion step failed: ${expectedStep.id}`;
      if (!deepEqual(actual.expected, expectedStep.expected)) {
        return `expected value differs for step: ${expectedStep.id}`;
      }
      if (!deepEqual(actual.observed, expectedStep.expected)) {
        return `observed value does not match expected for step: ${expectedStep.id}`;
      }
    }
    return null;
  }
  if (!original.expected || !replay.expected || !replay.observed) {
    return "result has no supported structured assertions";
  }
  if (!sameObservation(replay.expected, original.expected)) return "expected values differ from original";
  if (!sameObservation(replay.observed, original.expected)) return "observed values do not exactly match expected";
  return null;
}

function deepEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}
