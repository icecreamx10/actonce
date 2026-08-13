import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RecordingWriter } from "../interceptor/src/common/recording-writer.js";
import type {
  RecorderContext,
  RecorderInterceptor,
} from "../interceptor/src/core/source-interceptor.js";
import { MacOSAXInterceptor } from "../interceptor/src/sources/macos-ax/macos-ax-interceptor.js";
import { MidsceneDumpNormalizer } from "../interceptor/src/sources/midscene/dump-normalizer.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((path) => rm(path, { recursive: true })),
  );
});

describe("composable recorder session", () => {
  it("totally orders sources while retaining source order and causal fields", async () => {
    const { session, recordingDir } = await createSession();
    const midscene = session.source({
      type: "midscene",
      instanceId: "agent",
      version: "1.0",
    });
    const ax = session.source({ type: "macos-ax", instanceId: "local" });

    midscene.emit({
      kind: "logical.action.started",
      observedMonotonicNs: "100",
      correlation: { traceId: "trace", spanId: "logical" },
    });
    ax.emit({
      kind: "ax.notification.received",
      observedMonotonicNs: "110",
      correlation: {
        traceId: "trace",
        spanId: "ax-event",
        parentSpanId: "logical",
      },
    });
    midscene.emit({
      kind: "logical.action.completed",
      observedMonotonicNs: "120",
      correlation: { traceId: "trace", spanId: "logical" },
    });
    await session.close();

    const events = await readEvents(recordingDir);
    expect(events.map((event) => event.sequence)).toEqual([0, 1, 2]);
    expect(events.map((event) => event.sourceSequence)).toEqual([0, 0, 1]);
    expect(events[1].correlation.parentSpanId).toBe("logical");
    expect(events[1].timing.observedMonotonicNs).toBe("110");
    expect(BigInt(events[1].timing.ingestedMonotonicNs)).toBeGreaterThan(0n);

    const manifest = JSON.parse(
      await readFile(join(recordingDir, "manifest.json"), "utf8"),
    );
    expect(manifest.sources).toEqual([
      { type: "midscene", instanceId: "agent", version: "1.0", eventCount: 2 },
      { type: "macos-ax", instanceId: "local", eventCount: 1 },
    ]);
  });

  it("owns interceptor lifecycle and lets sources emit while stopping", async () => {
    const { session, recordingDir } = await createSession();
    const stopped: string[] = [];
    const makeInterceptor = (instanceId: string): RecorderInterceptor => {
      let context: RecorderContext;
      return {
        source: { type: "test", instanceId },
        start(value) {
          context = value;
          context.emit({ kind: "source.started" });
        },
        stop() {
          context.emit({ kind: "source.stopped" });
          stopped.push(instanceId);
        },
      };
    };
    await session.attach(makeInterceptor("first"));
    await session.attach(makeInterceptor("second"));
    await session.close();

    expect(stopped).toEqual(["second", "first"]);
    expect((await readEvents(recordingDir)).map((event) => event.kind)).toEqual([
      "source.started",
      "source.started",
      "source.stopped",
      "source.stopped",
    ]);
  });

  it("records AX notifications and snapshots as an independent source", async () => {
    const { session, recordingDir } = await createSession();
    let notify: ((event: { name: string; pid: number }) => void) | undefined;
    const ax = new MacOSAXInterceptor({
      start(listener) {
        notify = listener;
      },
      async snapshot() {
        return { role: "AXWindow", title: "Fiddle" };
      },
    });
    await session.attach(ax);
    notify?.({ name: "AXFocusedUIElementChanged", pid: 42 });
    await ax.captureSnapshot("after-action", {
      traceId: "trace",
      parentSpanId: "tap",
    });
    await session.close();

    const events = await readEvents(recordingDir);
    expect(events.map((event) => event.kind)).toEqual([
      "ax.notification.received",
      "ax.snapshot.captured",
    ]);
    expect(events[1].source.type).toBe("macos-ax");
    expect(events[1].correlation.parentSpanId).toBe("tap");
  });
});

describe("Midscene dump normalization", () => {
  it("promotes completed Assert, Boolean and Query results exactly once", () => {
    const normalizer = new MidsceneDumpNormalizer();
    const artifact = {
      sha256: "a".repeat(64),
      size: 1,
      path: `artifacts/aa/${"a".repeat(64)}`,
      mediaType: "application/json",
      complete: true,
    };
    const dump = JSON.stringify({
      executions: [
        {
          id: "execution",
          tasks: [
            {
              taskId: "query-task",
              status: "finished",
              subType: "Query",
              param: { dataDemand: "read diagnostic", domIncluded: false },
              uiContext: {
                screenshot: {
                  id: "midscene-shot",
                  capturedAt: 123,
                  mimeType: "image/png",
                },
              },
              output: { visible: true, message: "Expression expected." },
            },
          ],
        },
      ],
    });

    const first = normalizer.events(dump, artifact, [{ sequence: 7, artifact }]);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({
      kind: "observation.completed",
      operation: "Query",
      result: { visible: true, message: "Expression expected." },
      sourceDumpArtifact: artifact,
      evidenceSource: "screenshot",
      evidence: {
        domIncluded: false,
        screenshots: [{ sequence: 7, artifact }],
        screenshotContext: { id: "midscene-shot", capturedAt: 123, mediaType: "image/png" },
      },
    });
    expect(normalizer.events(dump, artifact)).toEqual([]);
  });
});

async function createSession() {
  const rootDir = await mkdtemp(join(tmpdir(), "actonce-session-test-"));
  temporaryRoots.push(rootDir);
  const session = await RecordingWriter.create({
    platform: "macos",
    recorder: "test",
    rootDir,
    recordingId: "recording",
  });
  return { session, recordingDir: join(rootDir, "recording") };
}

async function readEvents(recordingDir: string): Promise<any[]> {
  return (await readFile(join(recordingDir, "events.ndjson"), "utf8"))
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}
