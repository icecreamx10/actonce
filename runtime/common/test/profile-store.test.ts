import { describe, expect, it } from "vitest";
import { ProfileStore } from "../src/index.js";
import type { SegmentProfile } from "../src/index.js";

const baseProfile = (overrides: Partial<SegmentProfile> = {}): SegmentProfile => ({
  segmentId: "step",
  runs: 1,
  attempts: 2,
  deterministicFailures: 0,
  guard: {
    precondition: { captureDurationMs: 10, settleDelayMs: 5, pollCount: 0, timeoutCount: 0 },
    postcondition: { captureDurationMs: 20, settleDelayMs: 5, pollCount: 1, timeoutCount: 0 },
  },
  fallback: { count: 0, durationMs: 0, outcomes: { completed: 0, declined: 0, failed: 0 } },
  outcome: "matched",
  matchedCleanly: true,
  ...overrides,
});

describe("ProfileStore", () => {
  it("returns an empty store when the file is missing (ENOENT)", async () => {
    const store = await ProfileStore.load({
      path: "/tmp/missing.json",
      recordingId: "rec",
      readFile: async () => {
        const error = new Error("no such file") as Error & { code: string };
        error.code = "ENOENT";
        throw error;
      },
    });
    expect(store.get("anything")).toBeUndefined();
    expect(store.snapshot().segments).toEqual({});
  });

  it("accumulates EWMA, hotness, stability and the rolling window", async () => {
    let clock = 0;
    const store = await ProfileStore.load({
      path: "/tmp/s.json",
      recordingId: "rec",
      window: 3,
      ewmaAlpha: 0.5,
      now: () => (clock += 1000),
      readFile: async () => { const e = new Error() as Error & { code: string }; e.code = "ENOENT"; throw e; },
    });

    store.record(baseProfile({ outcome: "matched" }));
    let record = store.get("step")!;
    expect(record.sampleCount).toBe(1);
    expect(record.deoptRateEwma).toBe(0); // first sample, no deopt
    expect(record.hotness).toBe(1);
    expect(record.guardMsEwma).toBe(40); // 10+5+20+5
    expect(record.stability).toBe(1);

    store.record(baseProfile({
      outcome: "recovered",
      fallback: { count: 1, durationMs: 12, outcomes: { completed: 1, declined: 0, failed: 0 } },
    }));
    record = store.get("step")!;
    expect(record.sampleCount).toBe(2);
    expect(record.deoptCount).toBe(1);
    // alpha*1 + (1-alpha)*0 = 0.5
    expect(record.deoptRateEwma).toBe(0.5);
    expect(record.hotness).toBe(0.5);
    expect(record.fallbackOutcomes).toEqual({ completed: 1, declined: 0, failed: 0 });
    expect(record.recentOutcomes).toEqual(["matched", "recovered"]);
    expect(record.stability).toBeCloseTo(0.5);

    store.record(baseProfile({ outcome: "matched" }));
    store.record(baseProfile({ outcome: "matched" }));
    record = store.get("step")!;
    // window is 3, so only the last three outcomes are retained
    expect(record.recentOutcomes).toEqual(["recovered", "matched", "matched"]);
    expect(record.stability).toBeCloseTo(2 / 3);
  });

  it("carries corrective refs (kinds + evidence) without raw values", async () => {
    const store = await ProfileStore.load({
      path: "/tmp/s.json",
      recordingId: "rec",
      now: () => 0,
      readFile: async () => { const e = new Error() as Error & { code: string }; e.code = "ENOENT"; throw e; },
    });
    store.record(
      baseProfile({ outcome: "recovered", fallback: { count: 1, durationMs: 1, outcomes: { completed: 1, declined: 0, failed: 0 } } }),
      [{
        segmentId: "step",
        phase: "postcondition",
        attempt: 1,
        actions: [{ kind: "tap", target: "Save" }],
        evidenceRefs: ["artifacts/step/frame-12.png"],
      }],
    );
    expect(store.get("step")!.lastCorrectiveRefs).toEqual([
      "artifacts/step/frame-12.png",
      "tap",
    ]);
  });

  it("read-merge-writes so a concurrent disk segment is preserved", async () => {
    let written = "";
    const onDisk = {
      schemaVersion: 1,
      recordingId: "rec",
      segments: {
        other: {
          recordingId: "rec",
          segmentId: "other",
          sampleCount: 3,
          deoptCount: 0,
          deterministicFailures: 0,
          deoptRateEwma: 0,
          guardMsEwma: 5,
          recentOutcomes: ["matched"],
          fallbackOutcomes: { completed: 0, declined: 0, failed: 0 },
          hotness: 1,
          stability: 1,
          firstSeenAt: "1970-01-01T00:00:00.000Z",
          updatedAt: "1970-01-01T00:00:00.000Z",
        },
      },
      updatedAt: "1970-01-01T00:00:00.000Z",
    };
    const store = await ProfileStore.load({
      path: "/tmp/s.json",
      recordingId: "rec",
      now: () => 0,
      readFile: async () => JSON.stringify(onDisk),
      writeFile: async (_p, data) => { written = data; },
    });
    store.record(baseProfile({ segmentId: "step", outcome: "matched" }));
    await store.save();

    const parsed = JSON.parse(written);
    expect(Object.keys(parsed.segments).sort()).toEqual(["other", "step"]);
    expect(parsed.segments.other.sampleCount).toBe(3);
    expect(parsed.segments.step.sampleCount).toBe(1);
    expect(written.endsWith("\n")).toBe(true);
  });
});
