import { describe, expect, it, vi } from "vitest";
import { ReplayFlow, type ReplayEvent } from "../src/index.js";

type Expectation = { state: string };
type Actual = { state: string };

/**
 * Characterizes the contract used by compiled ActOnce replays before the
 * checkpoint implementation is replaced. Keep this test implementation-free:
 * the same assertions must pass for every checkpoint backend.
 */
describe("compiled replay contract", () => {
  it("executes recorded actions once and gates every boundary with checkpoints", async () => {
    let state = "welcome";
    let now = 0;
    const actions = {
      openEditor: vi.fn(() => { state = "editor"; }),
      introduceDiagnostic: vi.fn(() => { state = "syntax-error"; }),
    };
    const events: ReplayEvent<Actual>[] = [];
    const flow = new ReplayFlow<Expectation, Actual>({
      checkpoints: {
        verify: async (spec) => ({
          status: state === spec.expected.state ? "matched" : "mismatched",
          actual: { state },
          differences: state === spec.expected.state ? [] : [{
            path: "state",
            expected: spec.expected.state,
            actual: state,
            message: "state differs",
          }],
        }),
      },
      now: () => now,
      delay: async (durationMs) => { now += durationMs; },
      emit: (event) => { events.push(event); },
    });

    await flow.segment({
      id: "open-editor",
      precondition: { id: "welcome", expected: { state: "welcome" } },
      deterministic: actions.openEditor,
      postcondition: {
        id: "editor-ready",
        expected: { state: "editor" },
        settle: { timeoutMs: 100, intervalMs: 10, consecutiveMatches: 2 },
      },
    });
    await flow.segment({
      id: "introduce-diagnostic",
      precondition: { id: "editor-ready", expected: { state: "editor" } },
      deterministic: actions.introduceDiagnostic,
      postcondition: { id: "diagnostic-visible", expected: { state: "syntax-error" } },
    });

    expect(actions.openEditor).toHaveBeenCalledOnce();
    expect(actions.introduceDiagnostic).toHaveBeenCalledOnce();
    expect(events.filter((event) => event.kind === "replay.segment.completed").map((event) => event.segmentId))
      .toEqual(["open-editor", "introduce-diagnostic"]);
    expect(events.filter((event) => event.kind === "replay.deterministic.started").map((event) => event.segmentId))
      .toEqual(["open-editor", "introduce-diagnostic"]);
    expect(flow.diagnostics()).toMatchObject({
      strategy: "deterministic",
      fallbackCount: 0,
      checkpointPollCount: 1,
      checkpointTimeoutCount: 0,
    });
  });
});
