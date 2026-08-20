import { describe, expect, it } from "vitest";
import {
  canonicalTreeHash,
  waitForTreeThenVisual,
  type SemanticNode,
  type TreeObservationSession,
  type TreeSnapshot,
  type VisualCaptureSession,
} from "../src/index.js";

const root = (text: string): SemanticNode => ({
  role: "document",
  states: {},
  attributes: { z: "last", a: "first" },
  children: [{ role: "text", text, states: {}, children: [] }],
});

function snapshot(sequence: number, text: string): TreeSnapshot {
  const node = root(text);
  return {
    snapshotId: `snapshot-${sequence}`,
    source: {
      id: "test",
      kind: "cdp",
      schemaVersion: "1",
      capabilities: { fullTree: true, query: true, bounds: false, stableNodeId: false, subscriptions: false },
    },
    targetId: "target",
    sequence,
    capturedAtMonotonicNs: String(sequence),
    captureDurationMs: 1,
    root: node,
    canonicalHash: canonicalTreeHash(node),
  };
}

describe("tree-first visual checkpoints", () => {
  it("does not capture a screenshot until the tree matches twice", async () => {
    const snapshots = [snapshot(1, "loading"), snapshot(2, "ready"), snapshot(3, "ready"), snapshot(4, "ready")];
    let visualCaptures = 0;
    const tree = {
      source: snapshots[0].source,
      capture: async () => snapshots.shift()!,
      query: async () => [],
      close: async () => {},
    } satisfies TreeObservationSession;
    let visual: VisualCaptureSession;
    visual = {
      capture: async () => {
        visualCaptures += 1;
        return { frameId: "frame", sequence: 1, capturedAtMonotonicNs: "1", capturedAtWallTime: "now", widthPx: 1, heightPx: 1, scaleFactor: 1, targetId: "target" };
      },
      registerReference: async () => ({ referenceId: "reference", widthPx: 1, heightPx: 1 }),
      compare: async () => ({ matched: true, actualFrameId: "frame", referenceId: "reference", metrics: { captureDurationMs: 0, compareDurationMs: 0, totalDurationMs: 0 } }),
      waitStable: async () => ({
        status: "stable" as const,
        finalFrame: await visual.capture(),
        frameCount: 1,
        settleDelayMs: 0,
        metrics: {
          captureDurationMs: 0,
          compareDurationMs: 0,
          settleDelayMs: 0,
          totalDurationMs: 0,
        },
      }),
      close: async () => {},
    } satisfies VisualCaptureSession;
    const result = await waitForTreeThenVisual({
      tree,
      matchTree: (actual) => actual.root.children[0]?.text === "ready" ? [] : [{ path: "text", expected: "ready", actual: actual.root.children[0]?.text, message: "not ready" }],
      visual: { session: visual, referenceId: "reference", comparator: { type: "pixelDiff", mismatchThreshold: 0.01 } },
      timeoutMs: 100,
      intervalMs: 1,
    });
    expect(result.status).toBe("matched");
    expect(result.metrics.treeCaptureCount).toBe(4);
    expect(visualCaptures).toBe(1);
  });

  it("hashes canonical attributes independent of insertion order", () => {
    const left = root("ready");
    const right = root("ready");
    right.attributes = { a: "first", z: "last" };
    expect(canonicalTreeHash(left)).toBe(canonicalTreeHash(right));
  });

  it("preserves consecutive semantic matching when no visual source is configured", async () => {
    const snapshots = [snapshot(1, "loading"), snapshot(2, "ready"), snapshot(3, "ready")];
    const tree = {
      source: snapshots[0].source,
      capture: async () => snapshots.shift()!,
      query: async () => [],
      close: async () => {},
    } satisfies TreeObservationSession;
    const result = await waitForTreeThenVisual({
      tree,
      matchTree: (actual) => actual.root.children[0]?.text === "ready" ? [] : [{
        path: "text",
        expected: "ready",
        actual: actual.root.children[0]?.text,
        message: "not ready",
      }],
      timeoutMs: 100,
      intervalMs: 1,
      consecutiveTreeMatches: 2,
    });
    expect(result.status).toBe("matched");
    expect(result.metrics.treeCaptureCount).toBe(3);
    expect(result.metrics.screenshotCaptureCount).toBe(0);
  });
});
