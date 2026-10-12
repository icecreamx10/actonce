import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ANDROID_AFTER_ACTION_FOLLOWUP_DELAY_MS,
  createAndroidCheckpointCapture,
} from "../interceptor/src/android/recording-android-device.js";
import type { RecorderContext, SourceEvent } from "../interceptor/src/core/source-interceptor.js";

function fixture() {
  const events: SourceEvent[] = [];
  const source = vi.fn().mockResolvedValueOnce("before-render").mockResolvedValue("after-render");
  const screenshotBase64 = vi.fn().mockResolvedValue("data:image/png;base64,AQ==");
  const artifact = { sha256: "test", size: 1, path: "artifacts/test", mediaType: "image/png", complete: true };
  const context: RecorderContext = {
    source: { type: "checkpoint", instanceId: "test" },
    monotonicNs: () => String(process.hrtime.bigint()),
    artifact: vi.fn().mockResolvedValue(artifact),
    storeArtifact: vi.fn().mockReturnValue(artifact),
    markIncomplete: vi.fn(),
    emit(event) {
      events.push(event);
      return { sequence: events.length, sourceSequence: events.length };
    },
  };
  const device = { screenshotBase64, size: vi.fn().mockResolvedValue({ width: 411, height: 914 }) };
  const capture = createAndroidCheckpointCapture(
    device as unknown as Parameters<typeof createAndroidCheckpointCapture>[0],
    { source }, context,
  );
  return { capture, events, source, context };
}

afterEach(() => vi.useRealTimers());

describe("Android action-relative raw follow-up", () => {
  it("preserves the immediate sample and adds a correlated, separately timed follow-up", async () => {
    vi.useFakeTimers();
    const { capture, events, source } = fixture();
    const result = capture("after-action", "action-1", { traceId: "trace-1" });
    await vi.advanceTimersByTimeAsync(ANDROID_AFTER_ACTION_FOLLOWUP_DELAY_MS - 1);
    expect(events).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    const last = await result;
    expect(events).toHaveLength(2);
    expect(source).toHaveBeenCalledTimes(2);
    expect(events[0].sampling).toEqual({ ordinal: 0, trigger: "action-hook" });
    expect(events[1]).toMatchObject({
      kind: "checkpoint.captured", phase: "after-action", actionId: "action-1",
      correlation: { traceId: "trace-1", logicalActionId: "action-1" },
      sampling: { ordinal: 1, followsCaptureId: events[0].captureId,
        followsSequence: 1, scheduledDelayMs: 250, stability: "not-evaluated" },
    });
    expect(last).toEqual({ captureId: events[1].captureId, sequence: 2 });
  });

  it.each(["before-action", "manual-observation"] as const)("does not delay or duplicate %s", async (phase) => {
    const { capture, events, source } = fixture();
    await capture(phase, "action-1");
    expect(events).toHaveLength(1);
    expect(source).toHaveBeenCalledTimes(1);
  });

  it("preserves the first sample and reports failure if follow-up collection fails", async () => {
    vi.useFakeTimers();
    const { capture, events, source, context } = fixture();
    source.mockReset().mockResolvedValueOnce("first").mockRejectedValueOnce(new Error("source unavailable"));
    const result = capture("after-action", "action-1");
    const rejected = expect(result).rejects.toThrow("source unavailable");
    await vi.advanceTimersByTimeAsync(ANDROID_AFTER_ACTION_FOLLOWUP_DELAY_MS);
    await rejected;
    expect(events.map((event) => event.kind)).toEqual(["checkpoint.captured", "checkpoint.failed"]);
    expect(events[1]).toMatchObject({ phase: "after-action", sampling: { ordinal: 1, followsSequence: 1 } });
    expect(context.markIncomplete).toHaveBeenCalledOnce();
  });
});
