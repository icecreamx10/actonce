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

const originals = (first = 12_000, second = 10_000) => [
  result("original", "original-1", first),
  result("original", "original-2", second),
];

describe("Lynxtron benchmark evaluation", () => {
  it("reports exact 2+2 correctness and median-to-median speedup", () => {
    const evaluation = evaluateLynxtronBenchmark(
      originals(),
      [result("replay", "replay-1", 2_200), result("replay", "replay-2", 1_800)],
      passedReview,
    );
    expect(evaluation.dimensions.correctness).toMatchObject({
      passed: true,
      successfulRuns: 4,
      totalRuns: 4,
    });
    expect(evaluation.dimensions.speed).toMatchObject({
      comparable: true,
      originalDurationMs: [12_000, 10_000],
      originalMedianDurationMs: 11_000,
      replayMedianDurationMs: 2_000,
      speedup: 5.5,
    });
    expect(evaluation.dimensions.speed.reductionPercent).toBeCloseTo(81.818, 2);
  });

  it("rejects either replay when its observation differs from the oracle", () => {
    const evaluation = evaluateLynxtronBenchmark(
      originals(),
      [
        result("replay", "replay-1", 100, { observed: { ...expected, tooltipVisible: false } }),
        result("replay", "replay-2", 100),
      ],
      passedReview,
    );
    expect(evaluation.dimensions.correctness.passed).toBe(false);
    expect(evaluation.dimensions.correctness.failures[0].reason).toContain("exactly match");
    expect(evaluation.dimensions.speed.comparable).toBe(false);
  });

  it("rejects either original when its live observation differs", () => {
    const badOriginal = result("original", "original-2", 10_000, {
      observed: { ...expected, tooltipVisible: false },
    });
    const evaluation = evaluateLynxtronBenchmark(
      [originals()[0], badOriginal],
      [result("replay", "replay-1", 100), result("replay", "replay-2", 100)],
      passedReview,
    );
    expect(evaluation.dimensions.correctness.passed).toBe(false);
    expect(evaluation.dimensions.correctness.failures[0].reason).toContain("original observation mismatch");
  });

  it("does not compare speed when any measured duration is missing", () => {
    const evaluation = evaluateLynxtronBenchmark(
      originals(),
      [
        result("replay", "replay-1", 100, { executionDurationMs: null }),
        result("replay", "replay-2", 100),
      ],
      passedReview,
    );
    expect(evaluation.dimensions.correctness.passed).toBe(true);
    expect(evaluation.dimensions.speed.comparable).toBe(false);
  });

  it("compares correct hybrid replay with fallback overhead included", () => {
    const evaluation = evaluateLynxtronBenchmark(
      originals(),
      [
        result("replay", "replay-1", 4_000, {
          replayDiagnostics: { strategy: "hybrid", fallbackCount: 1, fallbackDurationMs: 2_000 },
        }),
        result("replay", "replay-2", 2_000),
      ],
      passedReview,
    );
    expect(evaluation.dimensions.speed).toMatchObject({
      comparable: true,
      replayMedianDurationMs: 3_000,
      replayDiagnostics: expect.arrayContaining([{
        runId: "replay-1",
        strategy: "hybrid",
        fallbackCount: 1,
        fallbackDurationMs: 2_000,
      }]),
    });
    expect(evaluation.dimensions.speed.speedup).toBeCloseTo(11_000 / 3_000);
  });

  it("withholds performance until the final AI evidence review passes", () => {
    const evaluation = evaluateLynxtronBenchmark(
      originals(),
      [result("replay", "replay-1", 2_000), result("replay", "replay-2", 2_000)],
    );
    expect(evaluation.dimensions.correctness.cliPassed).toBe(true);
    expect(evaluation.dimensions.correctness.aiPassed).toBe(false);
    expect(evaluation.dimensions.correctness.passed).toBe(false);
    expect(evaluation.dimensions.speed.comparable).toBe(false);
  });

  it("requires exactly two originals and two replays", () => {
    expect(() => evaluateLynxtronBenchmark(
      [originals()[0]],
      [result("replay", "replay-1", 100), result("replay", "replay-2", 100)],
    )).toThrow(/Exactly two original/);
    expect(() => evaluateLynxtronBenchmark(
      originals(),
      [result("replay", "replay-1", 100)],
    )).toThrow(/Exactly two replay/);
  });
});
