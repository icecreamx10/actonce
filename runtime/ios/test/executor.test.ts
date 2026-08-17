import { describe, expect, it } from "vitest";
import type { ReplayPlanFile } from "@byted-lynx/actonce-replay";
import { executeIOSPlan } from "../src/executor.js";
import type { IOSCheckpointExpectation } from "../src/checkpoint.js";
import type { IOSSession } from "../src/session.js";

// A minimal fake IOSSession: `source()` returns whatever the current script step
// produced, `device.tap` records the compiled action, `close()` is a no-op.
function fakeSession(sources: string[]): { session: IOSSession; taps: unknown[]; closed: () => boolean } {
  const taps: unknown[] = [];
  let index = 0;
  let closed = false;
  const session = {
    device: {
      tap: async (point: unknown) => { taps.push(point); },
    },
    source: async () => sources[Math.min(index, sources.length - 1)],
    // each replayed primitive advances to the next observed screen
    invalidateObservation: () => { index += 1; },
    close: async () => { closed = true; },
  } as unknown as IOSSession;
  return { session, taps, closed: () => closed };
}

const plan: ReplayPlanFile<IOSCheckpointExpectation> = {
  schemaVersion: 1,
  recordingId: "ios-settings-about",
  version: 1,
  platform: "ios",
  segments: [
    {
      id: "open-general",
      precondition: { id: "settings-root", state: "settings.root", expected: { source: { includes: ["settings.general"] } } },
      action: { operation: "tap", arguments: [{ x: 218, y: 328 }] },
      postcondition: { id: "general-visible", state: "settings.general", expected: { source: { includes: ["About"] } } },
    },
    {
      id: "open-about",
      precondition: { id: "general-ready", state: "settings.general", expected: { source: { includes: ["About"] } } },
      action: { operation: "tap", arguments: [{ x: 218, y: 404 }] },
      postcondition: { id: "about-visible", state: "settings.about", expected: { source: { includes: ["ProductModelName"] } } },
    },
  ],
};

describe("executeIOSPlan", () => {
  it("executes a compiled plan and passes when every checkpoint is reached", async () => {
    // screens observed after each invalidateObservation tick
    const { session, taps, closed } = fakeSession([
      "settings.general root",   // precondition open-general
      "About page",              // postcondition open-general + precondition open-about
      "ProductModelName About",  // postcondition open-about
    ]);
    const report = await executeIOSPlan(plan, { connect: async () => session });

    expect(report.result.status).toBe("passed");
    expect(report.result).toMatchObject({ recordingId: "ios-settings-about", version: 1, segmentsRun: 2 });
    expect(taps).toEqual([{ x: 218, y: 328 }, { x: 218, y: 404 }]);
    expect(closed()).toBe(true); // session closed in finally
  });

  it("returns a checkpoint-centric failure naming the unreached state", async () => {
    // second screen never reaches "About": open-general postcondition fails
    const { session, closed } = fakeSession([
      "settings.general root",
      "still on general root",
    ]);
    const report = await executeIOSPlan(plan, { connect: async () => session });

    expect(report.result.status).toBe("failed");
    if (report.result.status !== "failed") throw new Error("expected failure");
    expect(report.result.failedCheckpoint).toMatchObject({
      segmentId: "open-general",
      checkpointId: "general-visible",
      phase: "postcondition",
      state: "settings.general",
      reason: "mismatched",
    });
    expect(report.result.failedCheckpoint.expected).toEqual({ source: { includes: ["About"] } });
    expect(closed()).toBe(true);
  });

  it("resumes from a named segment without replaying earlier actions", async () => {
    const { session, taps, closed } = fakeSession([
      "About page",
      "ProductModelName About",
    ]);

    const report = await executeIOSPlan(plan, {
      connect: async () => session,
      fromSegmentId: "open-about",
    });

    expect(report.result).toEqual({
      status: "passed",
      recordingId: "ios-settings-about",
      version: 1,
      segmentsRun: 1,
    });
    expect(taps).toEqual([{ x: 218, y: 404 }]);
    expect(closed()).toBe(true);
  });
});
