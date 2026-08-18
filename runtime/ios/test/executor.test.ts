import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { executeIOSPlan, loadIOSPlan } from "../src/executor.js";
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
    screenshot: async () => "",
    // each replayed primitive advances to the next observed screen
    invalidateObservation: () => { index += 1; },
    close: async () => { closed = true; },
  } as unknown as IOSSession;
  return { session, taps, closed: () => closed };
}

const planPath = resolve(
  import.meta.dirname,
  "../../../benchmark/ios/settings-about.plan.json",
);
const plan = await loadIOSPlan(planPath);

describe("executeIOSPlan", () => {
  it("executes the checked-in Settings replay plan", async () => {
    // screens observed after each invalidateObservation tick
    const { session, taps, closed } = fakeSession([
      "com.apple.settings.general 通用",
      "About 关于本机",
      "关于本机 SW_VERSION_SPECIFIER ProductModelName iPhone 17 Pro",
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
      "com.apple.settings.general 通用",
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
    expect(report.result.failedCheckpoint.expected).toEqual({
      source: { includes: ["About", "关于本机"] },
    });
    expect(closed()).toBe(true);
  });

  it("resumes from a named segment without replaying earlier actions", async () => {
    const { session, taps, closed } = fakeSession([
      "About 关于本机",
      "关于本机 SW_VERSION_SPECIFIER ProductModelName iPhone 17 Pro",
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
