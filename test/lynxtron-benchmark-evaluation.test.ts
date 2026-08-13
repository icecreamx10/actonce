import { describe, expect, it } from "vitest";
import {
  evaluateLynxtronBenchmark,
  type LynxtronRunResult,
} from "../benchmark/macos/lynxtron-fiddle/evaluation.js";

const expected = {
  syntaxErrorVisible: true,
  tooltipVisible: true,
  tooltipMessage: "Expression expected.",
};
const passedReview = {
  schemaVersion: 1 as const,
  benchmark: "lynxtron-fiddle-js-diagnostic-hover",
  reviewer: "ai" as const,
  decision: "passed" as const,
  reason: "The replay screenshots show the same diagnostic and tooltip.",
};

function result(
  mode: "original" | "replay",
  runId: string,
  duration: number,
  overrides: Partial<LynxtronRunResult> = {},
): LynxtronRunResult {
  return {
    schemaVersion: 1,
    benchmark: "lynxtron-fiddle-js-diagnostic-hover",
    mode,
    runId,
    status: "passed",
    executionDurationMs: duration,
    expected,
    observed: expected,
    ...(mode === "replay" ? {
      assertionDecision: "assertion-decision.json",
      artifacts: { assertionDecision: "assertion-decision.json" },
    } : {}),
    ...overrides,
  };
}

describe("Lynxtron benchmark evaluation", () => {
  it("reports exact correctness and median replay speedup", () => {
    const evaluation = evaluateLynxtronBenchmark(
      result("original", "original-1", 12_000),
      [
        result("replay", "replay-1", 2_200),
        result("replay", "replay-2", 2_000),
        result("replay", "replay-3", 1_800),
        result("replay", "replay-4", 2_100),
        result("replay", "replay-5", 1_900),
      ],
      passedReview,
    );
    expect(evaluation.dimensions.correctness).toMatchObject({
      passed: true,
      successfulRuns: 5,
      totalRuns: 5,
    });
    expect(evaluation.dimensions.speed).toMatchObject({
      comparable: true,
      originalDurationMs: 12_000,
      replayMedianDurationMs: 2_000,
      speedup: 6,
    });
    expect(evaluation.dimensions.speed.reductionPercent).toBeCloseTo(83.333, 2);
  });

  it("rejects a replay whose observation differs from the fixed oracle", () => {
    const evaluation = evaluateLynxtronBenchmark(
      result("original", "original-1", 12_000),
      [
        result("replay", "replay-1", 100, { observed: { ...expected, tooltipVisible: false } }),
        result("replay", "replay-2", 100),
        result("replay", "replay-3", 100),
        result("replay", "replay-4", 100),
        result("replay", "replay-5", 100),
      ],
      passedReview,
    );
    expect(evaluation.dimensions.correctness.passed).toBe(false);
    expect(evaluation.dimensions.correctness.failures[0].reason).toContain("exactly match");
    expect(evaluation.dimensions.speed.comparable).toBe(false);
    expect(evaluation.dimensions.speed.speedup).toBeNull();
  });

  it("does not compare speed when a measured duration is missing", () => {
    const evaluation = evaluateLynxtronBenchmark(
      result("original", "original-1", 12_000),
      [
        result("replay", "replay-1", 100, { executionDurationMs: null }),
        result("replay", "replay-2", 100),
        result("replay", "replay-3", 100),
        result("replay", "replay-4", 100),
        result("replay", "replay-5", 100),
      ],
      passedReview,
    );
    expect(evaluation.dimensions.correctness.passed).toBe(true);
    expect(evaluation.dimensions.speed.comparable).toBe(false);
  });

  it("compares correct hybrid replay with fallback overhead included", () => {
    const evaluation = evaluateLynxtronBenchmark(
      result("original", "original-1", 12_000),
      [
        result("replay", "replay-1", 4_000, {
          replayDiagnostics: { strategy: "hybrid", fallbackCount: 1, fallbackDurationMs: 2_000 },
        }),
        result("replay", "replay-2", 2_000),
        result("replay", "replay-3", 2_100),
        result("replay", "replay-4", 2_200),
        result("replay", "replay-5", 2_300),
      ],
      passedReview,
    );
    expect(evaluation.dimensions.correctness.passed).toBe(true);
    expect(evaluation.dimensions.speed).toMatchObject({
      comparable: true,
      replayMedianDurationMs: 2_200,
      replayDiagnostics: expect.arrayContaining([
        {
          runId: "replay-1",
          strategy: "hybrid",
          fallbackCount: 1,
          fallbackDurationMs: 2_000,
        },
      ]),
    });
    expect(evaluation.dimensions.speed.speedup).toBeCloseTo(12_000 / 2_200);
  });

  it("withholds performance until the final AI evidence review passes", () => {
    const evaluation = evaluateLynxtronBenchmark(
      result("original", "original-1", 12_000),
      [
        result("replay", "replay-1", 2_000),
        result("replay", "replay-2", 2_000),
        result("replay", "replay-3", 2_000),
        result("replay", "replay-4", 2_000),
        result("replay", "replay-5", 2_000),
      ],
    );
    expect(evaluation.dimensions.correctness.cliPassed).toBe(true);
    expect(evaluation.dimensions.correctness.aiPassed).toBe(false);
    expect(evaluation.dimensions.correctness.passed).toBe(false);
    expect(evaluation.dimensions.speed.comparable).toBe(false);
  });
});
