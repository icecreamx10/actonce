import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import type { MacCaptureBackend } from "../src/capture-protocol.js";
import { MacCaptureClient } from "../src/capture-client.js";
import { MacCaptureService } from "../src/capture-service.js";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { while (cleanup.length) await cleanup.pop()!(); });

describe("MacCaptureService", () => {
  it("shares window frames and decoded references through one socket service", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "actonce-capture-test-"));
    const png = await sharp({ create: { width: 20, height: 10, channels: 4, background: "#ff0000" } }).png().toBuffer();
    const referencePath = resolve(directory, "reference.png");
    await writeFile(referencePath, png);
    const backend: MacCaptureBackend = {
      targets: async () => [{ targetId: "macos-window-7", windowId: 7, pid: 9, bundleId: "com.example", processName: "Example", title: "Example", bounds: { x: 0, y: 0, width: 20, height: 10 } }],
      capture: async () => ({ png, widthPx: 20, heightPx: 10, scaleFactor: 1 }),
      close: async () => {},
    };
    const socketPath = resolve(directory, "capture.sock");
    const service = await MacCaptureService.start({ socketPath, backend });
    cleanup.push(async () => { await service.close(); await rm(directory, { recursive: true, force: true }); });
    const client = await MacCaptureClient.connect(socketPath);
    cleanup.push(() => client.close());
    expect(await client.health()).toEqual({ ok: true, protocolVersion: 1 });
    const [target] = await client.targets();
    const visual = await client.openVisualSession({ target });
    const frame = await visual.capture();
    const reference = await visual.registerReference({ path: referencePath });
    const comparison = await visual.compare({ frameId: frame.frameId, referenceId: reference.referenceId, comparator: { type: "pixelDiff", mismatchThreshold: 0 } });
    expect(comparison.matched).toBe(true);
    const stable = await visual.waitStable({ timeoutMs: 500, consecutiveFrames: 2, minimumObservationMs: 0 });
    expect(stable.status).toBe("stable");
    await visual.close();
  });
});
