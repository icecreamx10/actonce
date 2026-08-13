import { describe, expect, it } from "vitest";
import {
  compileMacObservationPlan,
  validateMacObservationDecisions,
} from "../src/observation-compiler.js";

describe("macOS observation compiler", () => {
  const events = [
    { kind: "benchmark.step.completed", sequence: 8, stepId: "settle", stepKind: "wait", durationMs: 500 },
    { kind: "benchmark.step.started", sequence: 10 },
    {
      kind: "observation.screenshot",
      sequence: 11,
      artifact: { path: "artifacts/shot", mediaType: "image/png", complete: true },
    },
    {
      kind: "observation.completed",
      sequence: 12,
      taskId: "tooltip",
      operation: "Query",
      prompt: "read tooltip",
      result: { visible: true, message: "Expression expected." },
    },
  ];
  const facts = new Map([["tooltip", { domIncluded: false, hasScreenshotContext: true }]]);

  it("preserves screenshot-only observations as visual", () => {
    const plan = compileMacObservationPlan(events, facts);
    expect(plan.observations[0]).toMatchObject({
      observationTaskId: "tooltip",
      recordedMode: "visual",
      allowedEvaluatorModalities: ["visual"],
      evidence: { screenshots: [{ sequence: 11, artifact: "artifacts/shot" }], domIncluded: false },
      recommendedSettle: {
        timeoutMs: 500,
        intervalMs: 50,
        consecutiveMatches: 2,
        replacesWaitStepId: "settle",
      },
    });
  });

  it("rejects AX for a screenshot-only observation", () => {
    const plan = compileMacObservationPlan(events, facts);
    expect(() => validateMacObservationDecisions(plan, {
      decisions: [{
        observationTaskId: "tooltip",
        recordedMode: "visual",
        compiledEvaluator: "macos-ax",
        evidence: [{ sequence: 11, artifact: "artifacts/shot" }],
      }],
    })).toThrow("cannot use native-ui evaluator");
  });

  it("accepts a visual evaluator that cites recorded evidence", () => {
    const plan = compileMacObservationPlan(events, facts);
    expect(() => validateMacObservationDecisions(plan, {
      decisions: [{
        observationTaskId: "tooltip",
        recordedMode: "visual",
        compiledEvaluator: "apple-vision-ocr",
        evidence: [{ sequence: 11, artifact: "artifacts/shot" }],
      }],
    })).not.toThrow();
  });

  it("accepts deterministic recorded screenshot region comparison", () => {
    const plan = compileMacObservationPlan(events, facts);
    expect(() => validateMacObservationDecisions(plan, {
      decisions: [{
        observationTaskId: "tooltip",
        recordedMode: "visual",
        compiledEvaluator: "recorded-screenshot-region-comparison",
        evidence: [{ sequence: 11, artifact: "artifacts/shot" }],
      }],
    })).not.toThrow();
  });

  it("prefers explicit recorder evidence over adjacency inference", () => {
    const plan = compileMacObservationPlan([{
      kind: "observation.completed",
      sequence: 20,
      taskId: "explicit",
      operation: "Boolean",
      result: true,
      evidenceSource: "screenshot",
      evidence: {
        domIncluded: false,
        screenshots: [{
          sequence: 17,
          artifact: { path: "artifacts/explicit", mediaType: "image/png", complete: true },
        }],
      },
    }]);

    expect(plan.observations[0]).toMatchObject({
      recordedMode: "visual",
      evidence: {
        screenshots: [{ sequence: 17, artifact: "artifacts/explicit" }],
        domIncluded: false,
      },
    });
  });
});
