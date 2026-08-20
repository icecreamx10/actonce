import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReplayFlow } from "../runtime/common/src/index.js";
import { RecorderSession } from "../interceptor/src/core/recorder-session.js";
import { createReplayEventRecorder } from "../interceptor/src/common/replay-event-recorder.js";

const cleanup: string[] = [];
afterEach(async () => {
  while (cleanup.length) await rm(cleanup.pop()!, { recursive: true, force: true });
});

describe("replay recorder timeline", () => {
  it("orders replay actions and checkpoints in the shared recording session", async () => {
    const rootDir = await mkdtemp(resolve(tmpdir(), "actonce-replay-recorder-"));
    cleanup.push(rootDir);
    const recorder = await RecorderSession.create({
      platform: "macos",
      recorder: "replay-contract-test",
      rootDir,
      recordingId: "recording",
    });
    let state = "ready";
    const deterministic = vi.fn(() => { state = "done"; });
    const flow = new ReplayFlow<{ state: string }, { state: string }>({
      checkpoints: {
        verify: async (spec) => ({
          status: state === spec.expected.state ? "matched" : "mismatched",
          actual: { state },
          differences: [],
        }),
      },
      emit: createReplayEventRecorder(recorder),
    });

    await flow.segment({
      id: "edit",
      precondition: { id: "ready", expected: { state: "ready" } },
      deterministic,
      postcondition: { id: "done", expected: { state: "done" } },
    });
    await recorder.close();

    const events = (await readFile(resolve(rootDir, "recording/events.ndjson"), "utf8"))
      .trim().split("\n").map((line) => JSON.parse(line));
    expect(deterministic).toHaveBeenCalledOnce();
    expect(events.map((event) => event.kind)).toEqual([
      "replay.segment.started",
      "replay.checkpoint.checked",
      "replay.deterministic.started",
      "replay.deterministic.completed",
      "replay.checkpoint.checked",
      "replay.segment.completed",
    ]);
    expect(events.map((event) => event.sequence)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(events.every((event) => event.source.instanceId === "replay-checkpoint")).toBe(true);
    expect(events[1]).toMatchObject({
      phase: "precondition",
      checkpointId: "ready",
      checkpoint: { status: "matched", actual: { state: "ready" } },
    });
    expect(events[4]).toMatchObject({
      phase: "postcondition",
      checkpointId: "done",
      checkpoint: { status: "matched", actual: { state: "done" } },
    });
    expect(BigInt(events[0].timing.observedMonotonicNs)).toBeGreaterThan(0n);
    expect(BigInt(events[0].timing.ingestedMonotonicNs)).toBeGreaterThan(0n);
  });
});
