import { describe, expect, it, vi } from "vitest";
import {
  canonicalTreeHash,
  type SemanticNode,
  type TreeObservationSession,
  type TreeSnapshot,
  type VisualCaptureSession,
} from "@byted-lynx/actonce-replay";
import {
  CDP_TREE_SOURCE,
  createCdpReplayFlow,
} from "../src/index.js";

describe("CDP replay checkpoint chain", () => {
  it("keeps ReplayFlow as the scheduler and captures one visual checkpoint after semantic settle", async () => {
    let state = "loading";
    let sequence = 0;
    let now = 0;
    const captureTree = vi.fn(async () => snapshot(++sequence, state));
    const tree = {
      source: CDP_TREE_SOURCE,
      capture: captureTree,
      query: async () => [],
      close: async () => {},
    } satisfies TreeObservationSession;
    const visualCapture = vi.fn(async () => ({
      frameId: "frame-ready",
      sequence: 1,
      capturedAtMonotonicNs: "1",
      capturedAtWallTime: "now",
      widthPx: 20,
      heightPx: 10,
      scaleFactor: 1,
      targetId: "window",
    }));
    const visual = {
      capture: visualCapture,
      registerReference: async () => ({ referenceId: "ready-reference", widthPx: 20, heightPx: 10 }),
      compare: async ({ frameId, referenceId }) => ({
        matched: true,
        actualFrameId: frameId,
        referenceId,
        metrics: { captureDurationMs: 1, compareDurationMs: 1, totalDurationMs: 2 },
      }),
      waitStable: async () => ({
        status: "stable" as const,
        finalFrame: await visualCapture(),
        frameCount: 1,
        settleDelayMs: 0,
        metrics: { captureDurationMs: 1, compareDurationMs: 0, settleDelayMs: 0, totalDurationMs: 1 },
      }),
      close: async () => {},
    } satisfies VisualCaptureSession;
    const flow = createCdpReplayFlow({
      tree,
      visual,
      now: () => now,
      delay: async (durationMs) => { now += durationMs; },
    });
    const action = vi.fn(() => { state = "ready"; });

    await flow.segment({
      id: "open-card",
      precondition: {
        id: "loading",
        expected: { tree: { projection: [{ selector: { testId: "state" }, properties: { text: "loading" } }] } },
      },
      deterministic: action,
      postcondition: {
        id: "card-ready",
        expected: {
          tree: { projection: [{ selector: { testId: "state" }, properties: { text: "ready" } }] },
          visual: {
            referenceId: "ready-reference",
            comparator: { type: "pixelDiff", mismatchThreshold: 0.01 },
          },
        },
        settle: { timeoutMs: 100, intervalMs: 1 },
      },
    });

    expect(action).toHaveBeenCalledOnce();
    expect(visualCapture).toHaveBeenCalledOnce();
    expect(captureTree).toHaveBeenCalledTimes(4);
    expect(flow.diagnostics()).toMatchObject({ checkpointPollCount: 1, checkpointTimeoutCount: 0 });
  });
});

function snapshot(sequence: number, text: string): TreeSnapshot {
  const root: SemanticNode = {
    role: "document",
    states: {},
    children: [{
      role: "div",
      text,
      testId: "state",
      states: {},
      children: [],
    }],
  };
  return {
    snapshotId: `snapshot-${sequence}`,
    source: CDP_TREE_SOURCE,
    targetId: "window",
    sequence,
    capturedAtMonotonicNs: String(sequence),
    captureDurationMs: 1,
    root,
    canonicalHash: canonicalTreeHash(root),
  };
}
