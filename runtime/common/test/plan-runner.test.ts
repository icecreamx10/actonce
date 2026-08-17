import { describe, expect, it, vi } from "vitest";
import { ReplayFlow, runReplayPlan } from "../src/index.js";
import type { ReplayPlanFile, SerializablePrimitive } from "../src/index.js";

type Expectation = { state: string };
type Actual = { state: string };

const matched = (state: string) => ({ status: "matched" as const, actual: { state }, differences: [] });
const mismatched = (actual: string, expected: string) => ({
  status: "mismatched" as const,
  actual: { state: actual },
  differences: [{ path: "state", expected, actual, message: "state differs" }],
});

function planOf(segmentCount: number): ReplayPlanFile<Expectation> {
  return {
    schemaVersion: 1,
    recordingId: "maze",
    version: 1,
    platform: "android",
    segments: Array.from({ length: segmentCount }, (_, index) => ({
      id: `step-${index + 1}`,
      precondition: { id: `cp-${index}`, state: `state-${index}`, expected: { state: `state-${index}` } },
      action: { operation: "tap", arguments: [{ x: index, y: index }] },
      postcondition: { id: `cp-${index + 1}`, state: `state-${index + 1}`, expected: { state: `state-${index + 1}` } },
    })),
  };
}

describe("runReplayPlan", () => {
  it("passes silently when every checkpoint is reached", async () => {
    // 4 checkpoints across 3 segments: pre-0, then post-1/post-2/post-3.
    const plan = planOf(3);
    const verify = vi.fn()
      .mockResolvedValueOnce(matched("state-0")) // step-1 precondition
      .mockResolvedValueOnce(matched("state-1")) // step-1 postcondition
      .mockResolvedValueOnce(matched("state-1")) // step-2 precondition
      .mockResolvedValueOnce(matched("state-2")) // step-2 postcondition
      .mockResolvedValueOnce(matched("state-2")) // step-3 precondition
      .mockResolvedValueOnce(matched("state-3")); // step-3 postcondition
    const flow = new ReplayFlow<Expectation, Actual>({ checkpoints: { verify } });
    const replay = vi.fn();

    const result = await runReplayPlan(flow, plan, replay as (a: SerializablePrimitive) => void);

    expect(result).toEqual({ status: "passed", recordingId: "maze", version: 1, segmentsRun: 3 });
    expect(replay).toHaveBeenCalledTimes(3);
  });

  it("names the exact checkpoint that failed, with its state contract", async () => {
    // Run reaches state-2, then step-3's postcondition (checkpoint 3) never matches.
    const plan = planOf(3);
    const verify = vi.fn()
      .mockResolvedValueOnce(matched("state-0"))
      .mockResolvedValueOnce(matched("state-1"))
      .mockResolvedValueOnce(matched("state-1"))
      .mockResolvedValueOnce(matched("state-2"))
      .mockResolvedValueOnce(matched("state-2"))
      .mockResolvedValue(mismatched("state-2", "state-3")); // checkpoint 3 (step-3.post)
    const flow = new ReplayFlow<Expectation, Actual>({ checkpoints: { verify } });

    const result = await runReplayPlan(flow, plan, () => {});

    expect(result.status).toBe("failed");
    if (result.status !== "failed") throw new Error("expected failure");
    // The head-line field is the checkpoint not reached, with its state contract.
    expect(result.failedCheckpoint).toMatchObject({
      segmentId: "step-3",
      checkpointId: "cp-3",
      phase: "postcondition",
      reason: "mismatched",
      state: "state-3",
      expected: { state: "state-3" },
    });
    expect(result.failedCheckpoint.differences[0]).toMatchObject({ path: "state" });
    expect(result.segmentsRun).toBe(2); // two clean segments before the failure
  });

  it("stops at the first unreached checkpoint and does not run later segments", async () => {
    const plan = planOf(3);
    const verify = vi.fn()
      .mockResolvedValueOnce(matched("state-0"))
      .mockResolvedValue(mismatched("stuck", "state-1")); // step-1 postcondition already fails
    const flow = new ReplayFlow<Expectation, Actual>({ checkpoints: { verify } });
    const replay = vi.fn();

    const result = await runReplayPlan(flow, plan, replay as (a: SerializablePrimitive) => void);

    expect(result.status).toBe("failed");
    if (result.status !== "failed") throw new Error("expected failure");
    expect(result.failedCheckpoint.segmentId).toBe("step-1");
    expect(replay).toHaveBeenCalledTimes(1); // later segments never execute
  });

  it("resumes from a named segment and verifies its precondition first", async () => {
    const plan = planOf(3);
    const verify = vi.fn()
      .mockResolvedValueOnce(matched("state-1"))
      .mockResolvedValueOnce(matched("state-2"))
      .mockResolvedValueOnce(matched("state-2"))
      .mockResolvedValueOnce(matched("state-3"));
    const flow = new ReplayFlow<Expectation, Actual>({ checkpoints: { verify } });
    const replay = vi.fn();

    const result = await runReplayPlan(
      flow,
      plan,
      replay as (action: SerializablePrimitive) => void,
      { fromSegmentId: "step-2" },
    );

    expect(result).toEqual({ status: "passed", recordingId: "maze", version: 1, segmentsRun: 2 });
    expect(replay.mock.calls.map(([action]) => action.operation)).toEqual(["tap", "tap"]);
    expect(verify).toHaveBeenCalledTimes(4);
  });

  it("rejects an unknown resume segment before running the plan", async () => {
    const plan = planOf(2);
    const flow = new ReplayFlow<Expectation, Actual>({
      checkpoints: { verify: vi.fn() },
    });
    const replay = vi.fn();

    await expect(runReplayPlan(flow, plan, replay, {
      fromSegmentId: "missing",
    })).rejects.toThrow("unknown fromSegmentId: missing");
    expect(replay).not.toHaveBeenCalled();
  });
});
