import { randomUUID } from "node:crypto";
import {
  ComputerAgent,
  ComputerDevice,
  type ComputerAgentOpt,
} from "@midscene/computer";
import {
  RecordingWriter,
  decodeDataUrl,
  type RecordingWriterOptions,
} from "../common/recording-writer.js";
import {
  installMidsceneActionHooks,
  type MidsceneHookableInterface,
} from "../common/midscene-action-hooks.js";

type RecorderOptions = Pick<RecordingWriterOptions, "rootDir" | "recordingId">;
type PrimitiveGroup = Record<string, (...args: never[]) => Promise<unknown>>;

export type RecordedComputer = {
  agent: ComputerAgent<ComputerDevice>;
  device: ComputerDevice;
  writer: RecordingWriter;
  close(): Promise<void>;
};

/**
 * Construct Midscene's normal local ComputerDevice and decorate its lowest
 * public input primitives. Midscene planning remains untouched; every concrete
 * device operation crosses this recorder boundary.
 */
export async function agentForRecordedComputer(
  agentOptions: ComputerAgentOpt = {},
  recorderOptions: RecorderOptions = {},
): Promise<RecordedComputer> {
  const device = new ComputerDevice(agentOptions);
  const displays = await ComputerDevice.listDisplays();
  const writer = await RecordingWriter.create({
    ...recorderOptions,
    platform: "macos",
    recorder: "midscene-computer-device-adapter",
    metadata: { hostPlatform: process.platform, displays },
  });
  try {
    await device.connect();
  } catch (error) {
    writer.markIncomplete(`computer connection failed: ${errorMessage(error)}`);
    writer.append({
      kind: "capture.environment.failed",
      origin: "midscene-device-adapter",
      error: { message: errorMessage(error) },
    });
    await writer.close();
    throw new Error(
      `${errorMessage(error)}\nActOnce failure recording: ${writer.recordingDir}`,
    );
  }
  const restore = installComputerRecorder(device, writer);
  const agent = new ComputerAgent(device, agentOptions);
  const removeProgressListener = agent.addProgressListener((event) => {
    writer.append({
      kind: "midscene.progress",
      origin: "midscene-agent-hook",
      progress: event,
    });
  });
  const removeDumpListener = agent.addDumpUpdateListener((dump, executionDump) => {
    const artifact = writer.storeArtifact(
      Buffer.from(dump, "utf8"),
      "application/json",
    );
    writer.append({
      kind: "midscene.execution-dump.updated",
      origin: "midscene-agent-hook",
      executionId: executionDump?.id ?? null,
      artifact,
    });
  });

  return {
    agent,
    device,
    writer,
    async close() {
      removeProgressListener();
      removeDumpListener();
      restore();
      await device.destroy();
      await writer.close();
    },
  };
}

export function installComputerRecorder(
  device: ComputerDevice,
  writer: RecordingWriter,
): () => void {
  const originals: Array<() => void> = [];
  const originalScreenshot = device.screenshotBase64.bind(device);

  const captureCheckpoint = async (
    phase: "before-action" | "after-action" | "manual-observation",
    actionId: string | null,
  ) => {
    const captureId = randomUUID();
    const startedMonotonicNs = writer.monotonicNs();
    try {
      const [image, viewport] = await Promise.all([
        originalScreenshot(),
        device.size(),
      ]);
      const decoded = decodeDataUrl(image);
      const artifact = await writer.artifact(decoded.bytes, decoded.mediaType);
      const sequence = writer.append({
        kind: "checkpoint.captured",
        origin: "recorder",
        captureId,
        actionId,
        phase,
        evidence: {
          screenshot: artifact,
          deviceMetadata: { platform: "macos", viewport },
          nativeUi: {
            status: "unavailable",
            reason: "The Midscene Computer device API exposes pixels and input primitives, but no macOS AX tree.",
          },
        },
        coherence: { status: "unknown", reason: "single-frame prototype capture" },
        timing: { startedMonotonicNs, completedMonotonicNs: writer.monotonicNs() },
      });
      return { captureId, sequence };
    } catch (error) {
      writer.markIncomplete(`checkpoint ${captureId} failed: ${errorMessage(error)}`);
      writer.append({
        kind: "checkpoint.failed",
        origin: "recorder",
        captureId,
        actionId,
        phase,
        error: { message: errorMessage(error) },
      });
      throw error;
    }
  };

  const logicalHooks = installMidsceneActionHooks(
    device as ComputerDevice & MidsceneHookableInterface,
    writer,
    captureCheckpoint,
  );
  originals.push(() => {
    logicalHooks.restore();
  });

  const replace = (
    group: PrimitiveGroup,
    operation: string,
  ) => {
    const original = group[operation];
    if (typeof original !== "function") return;
    group[operation] = (async (...args: never[]) => {
      const primitiveId = randomUUID();
      const logical = logicalHooks.current();
      const standaloneActionId = logical ? null : randomUUID();
      const before = standaloneActionId
        ? await captureCheckpoint("before-action", standaloneActionId)
        : null;
      writer.append({
        kind: "device.primitive.started",
        origin: "midscene-device-adapter",
        primitiveId,
        logicalActionId: logical?.actionId ?? standaloneActionId,
        operation,
        arguments: args,
        beforeCaptureId: before?.captureId ?? logical?.beforeCaptureId,
      });
      try {
        const result = await original(...args);
        const after = standaloneActionId
          ? await captureCheckpoint("after-action", standaloneActionId)
          : null;
        writer.append({
          kind: "device.primitive.completed",
          origin: "midscene-device-adapter",
          primitiveId,
          logicalActionId: logical?.actionId ?? standaloneActionId,
          operation,
          beforeCaptureId: before?.captureId ?? logical?.beforeCaptureId,
          afterCaptureId: after?.captureId ?? null,
          result: result ?? null,
        });
        return result;
      } catch (error) {
        writer.append({
          kind: "device.primitive.failed",
          origin: "midscene-device-adapter",
          primitiveId,
          logicalActionId: logical?.actionId ?? standaloneActionId,
          operation,
          beforeCaptureId: before?.captureId ?? logical?.beforeCaptureId,
          error: { message: errorMessage(error) },
        });
        throw error;
      }
    }) as PrimitiveGroup[string];
    originals.push(() => {
      group[operation] = original;
    });
  };

  const input = device.inputPrimitives;
  for (const operation of ["tap", "doubleClick", "rightClick", "hover", "dragAndDrop"]) {
    replace(input.pointer as unknown as PrimitiveGroup, operation);
  }
  for (const operation of ["typeText", "keyboardPress", "clearInput"]) {
    replace(input.keyboard as unknown as PrimitiveGroup, operation);
  }
  replace(input.scroll as unknown as PrimitiveGroup, "scroll");

  device.screenshotBase64 = async () => {
    const image = await originalScreenshot();
    const decoded = decodeDataUrl(image);
    const artifact = await writer.artifact(decoded.bytes, decoded.mediaType);
    writer.append({
      kind: "observation.screenshot",
      origin: "midscene-device-adapter",
      artifact,
    });
    return image;
  };
  originals.push(() => {
    device.screenshotBase64 = originalScreenshot;
  });

  return () => {
    for (const restore of originals.reverse()) restore();
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
