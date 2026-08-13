import { describe, expect, it, vi } from "vitest";
import { CheckpointMismatchError, FallbackFailedError, ReplayFlow } from "../src/index.js";

type Expectation = { state: string };
type Actual = { state: string };

const matched = (state: string) => ({
  status: "matched" as const,
  actual: { state },
  differences: [],
});

const mismatched = (actual: string, expected: string) => ({
  status: "mismatched" as const,
  actual: { state: actual },
  differences: [{ path: "state", expected, actual, message: "state differs" }],
});

describe("ReplayFlow", () => {
  it("runs a deterministic segment between matching checkpoints", async () => {
    const deterministic = vi.fn();
    const verify = vi.fn()
      .mockResolvedValueOnce(matched("ready"))
      .mockResolvedValueOnce(matched("done"));
    const flow = new ReplayFlow<Expectation, Actual>({ checkpoints: { verify } });

    await flow.segment({
      id: "edit",
      precondition: { id: "ready", expected: { state: "ready" } },
      deterministic,
      postcondition: { id: "done", expected: { state: "done" } },
    });

    expect(deterministic).toHaveBeenCalledOnce();
    expect(verify).toHaveBeenCalledTimes(2);
  });

  it("recovers only the mismatched postcondition and resumes", async () => {
    const events: string[] = [];
    const verify = vi.fn()
      .mockResolvedValueOnce(matched("ready"))
      .mockResolvedValueOnce(mismatched("unchanged", "done"))
      .mockResolvedValueOnce(matched("done"));
    const recover = vi.fn().mockResolvedValue({ status: "completed", actionCount: 1 });
    const flow = new ReplayFlow<Expectation, Actual>({
      checkpoints: { verify },
      policy: "recover",
      fallback: { recover },
      emit: (event) => {
        events.push(event.kind);
      },
    });

    await flow.segment({
      id: "edit",
      precondition: { id: "ready", expected: { state: "ready" } },
      deterministic: vi.fn(),
      postcondition: { id: "done", expected: { state: "done" } },
      fallback: { goal: "Make the editor contain the expected text" },
    });

    expect(recover).toHaveBeenCalledOnce();
    expect(recover.mock.calls[0][0]).toMatchObject({
      segmentId: "edit",
      phase: "postcondition",
      attempt: 1,
      constraints: { observationOnly: false },
    });
    expect(events).toContain("replay.fallback.started");
    expect(events.at(-1)).toBe("replay.segment.completed");
    expect(flow.diagnostics()).toMatchObject({
      strategy: "hybrid",
      fallbackCount: 1,
    });
    expect(flow.diagnostics().fallbackDurationMs).toBeGreaterThanOrEqual(0);
  });

  it("observes and recovers after the deterministic driver throws", async () => {
    const events: string[] = [];
    const verify = vi.fn()
      .mockResolvedValueOnce(matched("ready"))
      .mockResolvedValueOnce(mismatched("unchanged", "done"))
      .mockResolvedValueOnce(matched("done"));
    const recover = vi.fn().mockResolvedValue({ status: "completed", actionCount: 1 });
    const flow = new ReplayFlow<Expectation, Actual>({
      checkpoints: { verify },
      policy: "recover",
      fallback: { recover },
      emit: (event) => {
        events.push(event.kind);
      },
    });

    await flow.segment({
      id: "edit",
      precondition: { id: "ready", expected: { state: "ready" } },
      deterministic: () => {
        throw new Error("stale locator");
      },
      postcondition: { id: "done", expected: { state: "done" } },
      fallback: { goal: "Complete the edit" },
    });

    expect(events).toContain("replay.deterministic.failed");
    expect(recover).toHaveBeenCalledOnce();
    expect(recover.mock.calls[0][0].differences[0]).toMatchObject({
      path: "deterministic",
      message: expect.stringContaining("stale locator"),
    });
    expect(events.at(-1)).toBe("replay.segment.completed");
  });

  it("reports zero fallback diagnostics in deterministic mode", () => {
    const flow = new ReplayFlow<Expectation, Actual>({
      checkpoints: { verify: async () => matched("ready") },
    });
    expect(flow.diagnostics()).toEqual({
      strategy: "deterministic",
      fallbackCount: 0,
      fallbackDurationMs: 0,
      checkpointPollCount: 0,
      checkpointCaptureDurationMs: 0,
      checkpointSettleDelayMs: 0,
      checkpointWaitDurationMs: 0,
      checkpointTimeoutCount: 0,
    });
  });

  it("separates checkpoint capture time from settle delay", async () => {
    let now = 0;
    const verify = vi.fn(async () => {
      now += 25;
      return verify.mock.calls.length < 3 ? mismatched("loading", "done") : matched("done");
    });
    const flow = new ReplayFlow<Expectation, Actual>({
      checkpoints: { verify },
      now: () => now,
      delay: async (durationMs) => { now += durationMs; },
    });
    await flow.checkpoint("segment", "postcondition", {
      id: "captured",
      expected: { state: "done" },
    });
    await flow.checkpoint("segment", "postcondition", {
      id: "captured-again",
      expected: { state: "done" },
    });
    expect(flow.diagnostics()).toMatchObject({
      checkpointCaptureDurationMs: 50,
      checkpointSettleDelayMs: 0,
      checkpointWaitDurationMs: 50,
    });
  });

  it("advances as soon as a polled checkpoint matches", async () => {
    let now = 0;
    const verify = vi.fn()
      .mockResolvedValueOnce(matched("ready"))
      .mockResolvedValueOnce(mismatched("loading", "done"))
      .mockResolvedValueOnce(mismatched("loading", "done"))
      .mockResolvedValueOnce(matched("done"));
    const recover = vi.fn();
    const flow = new ReplayFlow<Expectation, Actual>({
      checkpoints: { verify },
      policy: "recover",
      fallback: { recover },
      now: () => now,
      delay: async (durationMs) => { now += durationMs; },
    });

    await flow.segment({
      id: "edit",
      precondition: { id: "ready", expected: { state: "ready" } },
      deterministic: vi.fn(),
      postcondition: {
        id: "done",
        expected: { state: "done" },
        settle: { timeoutMs: 1_000, intervalMs: 100 },
      },
      fallback: { goal: "Recover" },
    });

    expect(recover).not.toHaveBeenCalled();
    expect(now).toBe(200);
    expect(flow.diagnostics()).toMatchObject({
      checkpointPollCount: 2,
      checkpointCaptureDurationMs: 0,
      checkpointSettleDelayMs: 200,
      checkpointWaitDurationMs: 200,
      checkpointTimeoutCount: 0,
    });
  });

  it("uses the existing fallback only after checkpoint polling times out", async () => {
    let now = 0;
    const verify = vi.fn()
      .mockResolvedValueOnce(matched("ready"))
      .mockResolvedValueOnce(mismatched("loading", "done"))
      .mockResolvedValueOnce(mismatched("loading", "done"))
      .mockResolvedValueOnce(mismatched("loading", "done"))
      .mockResolvedValueOnce(matched("done"));
    const recover = vi.fn().mockResolvedValue({ status: "completed" });
    const events: string[] = [];
    const flow = new ReplayFlow<Expectation, Actual>({
      checkpoints: { verify },
      policy: "recover",
      fallback: { recover },
      now: () => now,
      delay: async (durationMs) => { now += durationMs; },
      emit: (event) => { events.push(event.kind); },
    });

    await flow.segment({
      id: "edit",
      precondition: { id: "ready", expected: { state: "ready" } },
      deterministic: vi.fn(),
      postcondition: {
        id: "done",
        expected: { state: "done" },
        settle: { timeoutMs: 200, intervalMs: 100 },
      },
      fallback: { goal: "Recover" },
    });

    expect(recover).toHaveBeenCalledOnce();
    expect(events.indexOf("replay.checkpoint.settle.timed-out"))
      .toBeLessThan(events.indexOf("replay.fallback.started"));
    expect(flow.diagnostics()).toMatchObject({
      checkpointPollCount: 2,
      checkpointTimeoutCount: 1,
      fallbackCount: 1,
    });
  });

  it("requires a second frame when consecutiveMatches is two", async () => {
    let now = 0;
    const verify = vi.fn()
      .mockResolvedValueOnce(matched("ready"))
      .mockResolvedValueOnce(matched("done"))
      .mockResolvedValueOnce(matched("done"));
    const flow = new ReplayFlow<Expectation, Actual>({
      checkpoints: { verify },
      now: () => now,
      delay: async (durationMs) => { now += durationMs; },
    });

    await flow.segment({
      id: "animated",
      precondition: { id: "ready", expected: { state: "ready" } },
      deterministic: vi.fn(),
      postcondition: {
        id: "done",
        expected: { state: "done" },
        settle: { timeoutMs: 500, intervalMs: 50, consecutiveMatches: 2 },
      },
    });

    expect(verify).toHaveBeenCalledTimes(3);
    expect(now).toBe(50);
  });

  it("fails closed when fallback is disabled", async () => {
    const flow = new ReplayFlow<Expectation, Actual>({
      checkpoints: { verify: async () => mismatched("wrong", "ready") },
    });
    await expect(flow.segment({
      id: "edit",
      precondition: { id: "ready", expected: { state: "ready" } },
      deterministic: vi.fn(),
      postcondition: { id: "done", expected: { state: "done" } },
      fallback: { goal: "Recover" },
    })).rejects.toBeInstanceOf(CheckpointMismatchError);
  });

  it("marks never-retry postcondition fallback as observation-only", async () => {
    const verify = vi.fn()
      .mockResolvedValueOnce(matched("ready"))
      .mockResolvedValue(mismatched("unknown", "submitted"));
    const recover = vi.fn().mockResolvedValue({ status: "completed" });
    const flow = new ReplayFlow<Expectation, Actual>({
      checkpoints: { verify },
      policy: "recover",
      fallback: { recover },
    });

    await expect(flow.segment({
      id: "submit",
      precondition: { id: "ready", expected: { state: "ready" } },
      deterministic: vi.fn(),
      postcondition: { id: "submitted", expected: { state: "submitted" } },
      fallback: { goal: "Determine whether submission completed", maxAttempts: 1 },
      idempotency: "never-retry",
    })).rejects.toBeInstanceOf(FallbackFailedError);

    expect(recover.mock.calls[0][0].constraints.observationOnly).toBe(true);
  });
});
