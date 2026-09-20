import { createInterface } from "node:readline";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { serveExternalCdpCheckpoints } from "../src/external-checkpoint-service.js";

describe("external CDP checkpoint service", () => {
  it("handshakes without requiring an application DOM", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const service = serveExternalCdpCheckpoints(input, output);
    const messages = createInterface({ input: output });
    const response = nextResponse(messages, "ping-1");
    input.write(`${JSON.stringify({ id: "ping-1", method: "ping" })}\n`);
    expect(await response).toMatchObject({
      result: { ready: true, protocolVersion: 1 },
    });
    input.end();
    await service;
  });

  it("rejects the old session and returns after two equal accepted trees", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const service = serveExternalCdpCheckpoints(input, output);
    const snapshots = [
      { sessionId: 1, root: element("old") },
      { sessionId: 2, root: element("loading") },
      { sessionId: 2, root: element("ready", 3) },
      { sessionId: 2, root: element("ready", 99) },
    ];

    const result = new Promise<Record<string, unknown>>((resolveResult, rejectResult) => {
      createInterface({ input: output }).on("line", (line) => {
        const message = JSON.parse(line) as Record<string, unknown>;
        if (message.event === "capture") {
          const snapshot = snapshots.shift();
          if (!snapshot) return rejectResult(new Error("unexpected capture"));
          input.write(`${JSON.stringify({
            method: "capture.result",
            params: { captureId: message.captureId, snapshot },
          })}\n`);
        } else if (message.id === "wait-1") {
          resolveResult(message);
        }
      });
    });

    input.write(`${JSON.stringify({
      id: "wait-1",
      method: "waitForStableCdpTree",
      params: { timeoutMs: 1_000, intervalMs: 1, stableCaptures: 2, rejectSessionIds: [1] },
    })}\n`);
    const response = await result;
    expect(response.error).toBeUndefined();
    expect(snapshots).toHaveLength(0);
    const checkpoint = (response.result as { checkpoint: { actual: { sessionId: string; captureCount: number } } }).checkpoint;
    expect(checkpoint.actual).toMatchObject({ sessionId: "2", captureCount: 4 });
    input.end();
    await service;
  });

  it("fails closed when only stale sessions are captured", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const service = serveExternalCdpCheckpoints(input, output);
    const response = new Promise<Record<string, unknown>>((resolveResult) => {
      createInterface({ input: output }).on("line", (line) => {
        const message = JSON.parse(line) as Record<string, unknown>;
        if (message.event === "capture") {
          input.write(`${JSON.stringify({
            method: "capture.result",
            params: { captureId: message.captureId, snapshot: { sessionId: "old", root: element("old") } },
          })}\n`);
        } else if (message.id === "wait-2") resolveResult(message);
      });
    });
    input.write(`${JSON.stringify({
      id: "wait-2",
      method: "waitForStableCdpTree",
      params: { timeoutMs: 30, intervalMs: 2, rejectSessionIds: ["old"] },
    })}\n`);
    expect(await response).toMatchObject({ error: { code: "CHECKPOINT_TIMEOUT" } });
    input.end();
    await service;
  });

  it("treats the first accepted DOM round-trip as connection readiness", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const service = serveExternalCdpCheckpoints(input, output);
    const snapshots = [
      { sessionId: "old", root: element("old") },
      { sessionId: "connected", root: element("ready") },
    ];
    const messages = createInterface({ input: output });
    messages.on("line", (line) => {
      const message = JSON.parse(line) as Record<string, unknown>;
      if (message.event !== "capture") return;
      input.write(`${JSON.stringify({
        method: "capture.result",
        params: { captureId: message.captureId, snapshot: snapshots.shift() },
      })}\n`);
    });
    const response = nextResponse(messages, "ready-1");
    input.write(`${JSON.stringify({
      id: "ready-1",
      method: "waitForCdpReady",
      params: { timeoutMs: 1_000, intervalMs: 1, rejectSessionIds: ["old"] },
    })}\n`);
    expect(await response).toMatchObject({
      result: { checkpoint: { actual: { sessionId: "connected", captureCount: 2 } } },
    });
    input.end();
    await service;
  });

  it("records the post-sleep stable tree as an anchor and waits for it during replay", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const service = serveExternalCdpCheckpoints(input, output);
    const snapshots = [
      { sessionId: "record", root: element("ready", 10) },
    ];
    const messages = createInterface({ input: output });
    messages.on("line", (line) => {
      const message = JSON.parse(line) as Record<string, unknown>;
      if (message.event !== "capture") return;
      const snapshot = snapshots.shift();
      if (!snapshot) throw new Error("unexpected capture");
      input.write(`${JSON.stringify({
        method: "capture.result",
        params: { captureId: message.captureId, snapshot },
      })}\n`);
    });

    const recorded = nextResponse(messages, "record-anchor");
    input.write(`${JSON.stringify({
      id: "record-anchor",
      method: "recordStableCdpAnchor",
      params: { timeoutMs: 1_000, intervalMs: 1, stableCaptures: 2 },
    })}\n`);
    const recordResponse = await recorded;
    const anchor = (recordResponse.result as { anchor: Record<string, unknown> }).anchor;
    expect(anchor).toMatchObject({ version: 1, source: "cdp-dom" });

    snapshots.push(
      { sessionId: "replay", root: element("loading", 20) },
      { sessionId: "replay", root: element("ready", 21) },
      { sessionId: "replay", root: element("ready", 22) },
    );
    const replayed = nextResponse(messages, "wait-anchor");
    input.write(`${JSON.stringify({
      id: "wait-anchor",
      method: "waitForCdpAnchor",
      params: { anchor, timeoutMs: 1_000, intervalMs: 1, consecutiveMatches: 2 },
    })}\n`);
    const replayResponse = await replayed;
    expect(replayResponse.error).toBeUndefined();
    expect((replayResponse.result as { checkpoint: { actual: { sessionId: string; captureCount: number } } }).checkpoint.actual)
      .toMatchObject({ sessionId: "replay", captureCount: 3 });

    input.end();
    await service;
  });
});

function nextResponse(lines: ReturnType<typeof createInterface>, id: string): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    const listener = (line: string) => {
      const message = JSON.parse(line) as Record<string, unknown>;
      if (message.id !== id || message.event === "capture") return;
      lines.off("line", listener);
      resolve(message);
    };
    lines.on("line", listener);
  });
}

function element(text: string, nodeId = 1) {
  return {
    nodeId,
    backendNodeId: nodeId,
    nodeType: 1,
    nodeName: "view",
    localName: "view",
    attributes: ["data-testid", "root"],
    children: [{ nodeId: nodeId + 1, backendNodeId: nodeId + 1, nodeType: 3, nodeName: "#text", nodeValue: text }],
  };
}
