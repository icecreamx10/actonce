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
import type { CaptureCheckpoint } from "../core/checkpoint.js";
import type { RecorderContext } from "../core/source-interceptor.js";
import {
  MacOSInputInterceptor,
  installMacOSInputSource,
} from "../sources/macos-input/macos-input-interceptor.js";
import {
  MacOSAXInterceptor,
  type MacOSAXProvider,
} from "../sources/macos-ax/macos-ax-interceptor.js";
import { MidsceneInterceptor } from "../sources/midscene/midscene-interceptor.js";

type RecorderOptions = Pick<RecordingWriterOptions, "rootDir" | "recordingId"> & {
  axProvider?: MacOSAXProvider;
};
type DisplayInfo = Awaited<ReturnType<typeof ComputerDevice.listDisplays>>[number];

export function resolveSelectedDisplayId(
  requestedDisplayId: string | undefined,
  displays: DisplayInfo[],
): string | null {
  if (requestedDisplayId !== undefined && requestedDisplayId !== "") {
    return requestedDisplayId;
  }
  return displays.find((display) => display.primary)?.id ?? displays[0]?.id ?? null;
}

export type RecordedComputer = {
  agent: ComputerAgent<ComputerDevice>;
  device: ComputerDevice;
  writer: RecordingWriter;
  close(): Promise<void>;
};

/** Compose Midscene and concrete macOS input sources into one recording session. */
export async function agentForRecordedComputer(
  agentOptions: ComputerAgentOpt = {},
  recorderOptions: RecorderOptions = {},
): Promise<RecordedComputer> {
  const { axProvider, ...writerOptions } = recorderOptions;
  const device = new ComputerDevice(agentOptions);
  const displays = await ComputerDevice.listDisplays();
  const requestedDisplayId =
    agentOptions.displayId === undefined || agentOptions.displayId === ""
      ? null
      : agentOptions.displayId;
  const selectedDisplayId = resolveSelectedDisplayId(
    agentOptions.displayId,
    displays,
  );
  const writer = await RecordingWriter.create({
    ...writerOptions,
    platform: "macos",
    recorder: "composable-interceptor-session",
    metadata: {
      hostPlatform: process.platform,
      requestedDisplayId,
      selectedDisplayId,
      displaySelection:
        requestedDisplayId === null ? "primary-default" : "explicit",
      displays,
    },
  });
  const environmentContext = writer.source({
    type: "macos-input",
    instanceId: "computer-environment",
  });
  try {
    await device.connect();
  } catch (error) {
    writer.markIncomplete(`computer connection failed: ${errorMessage(error)}`);
    environmentContext.emit({
      kind: "capture.environment.failed",
      lifecycle: "failed",
      origin: "midscene-device-adapter",
      error: { message: errorMessage(error) },
    });
    await writer.close();
    throw new Error(
      `${errorMessage(error)}\nActOnce failure recording: ${writer.recordingDir}`,
    );
  }

  const checkpointContext = writer.source({
    type: "checkpoint",
    instanceId: "macos-checkpoint",
  });
  const ax = axProvider ? new MacOSAXInterceptor(axProvider) : undefined;
  if (ax) await writer.attach(ax);
  const captureCheckpoint = createMacOSCheckpointCapture(
    device,
    checkpointContext,
    ax,
  );
  const agent = new ComputerAgent(device, agentOptions);
  const actionTarget = device as ComputerDevice & MidsceneHookableInterface;
  const observationScreenshots: Array<{
    sequence: number;
    artifact: import("../core/source-interceptor.js").ArtifactReference;
  }> = [];
  const midscene = new MidsceneInterceptor(
    agent,
    actionTarget,
    captureCheckpoint,
    {
      peekScreenshots: () => [...observationScreenshots],
      consumeScreenshots: () => { observationScreenshots.length = 0; },
    },
  );
  const input = new MacOSInputInterceptor(
    device,
    captureCheckpoint,
    () => midscene.current(),
    (evidence) => { observationScreenshots.push(evidence); },
  );
  await writer.attach(midscene);
  await writer.attach(input);

  return {
    agent,
    device,
    writer,
    async close() {
      await writer.close();
      await device.destroy();
    },
  };
}

export function createMacOSCheckpointCapture(
  device: ComputerDevice,
  context: RecorderContext,
  ax?: MacOSAXInterceptor,
): CaptureCheckpoint {
  // Bind before the input interceptor decorates screenshotBase64.
  const originalScreenshot = device.screenshotBase64.bind(device);
  return async (phase, actionId, correlation) => {
    const captureId = randomUUID();
    const startedMonotonicNs = context.monotonicNs();
    try {
      const [image, viewport, axSnapshot] = await Promise.all([
        originalScreenshot(),
        device.size(),
        ax?.captureSnapshot(phase, {
          ...correlation,
          captureId,
          logicalActionId: correlation?.logicalActionId ?? actionId ?? undefined,
        }),
      ]);
      const decoded = decodeDataUrl(image);
      const artifact = await context.artifact(decoded.bytes, decoded.mediaType);
      const receipt = context.emit({
        kind: "checkpoint.captured",
        lifecycle: "instant",
        origin: "recorder",
        captureId,
        actionId,
        phase,
        evidence: {
          screenshot: artifact,
          deviceMetadata: { platform: "macos", viewport },
          nativeUi: axSnapshot
            ? {
                status: "available",
                source: "macos-ax",
                artifact: axSnapshot.artifact,
              }
            : {
                status: "unavailable",
                reason:
                  "No macOS AX snapshot provider is attached to this recording session.",
              },
        },
        coherence: {
          status: "unknown",
          reason: "single-frame prototype capture",
        },
        timing: {
          startedMonotonicNs,
          completedMonotonicNs: context.monotonicNs(),
        },
        correlation: {
          ...correlation,
          captureId,
          logicalActionId: correlation?.logicalActionId ?? actionId ?? undefined,
        },
      });
      return { captureId, sequence: receipt.sequence };
    } catch (error) {
      context.markIncomplete(
        `checkpoint ${captureId} failed: ${errorMessage(error)}`,
      );
      const receipt = context.emit({
        kind: "checkpoint.failed",
        lifecycle: "failed",
        origin: "recorder",
        captureId,
        actionId,
        phase,
        error: { message: errorMessage(error) },
        correlation: { ...correlation, captureId },
      });
      throw Object.assign(
        error instanceof Error ? error : new Error(String(error)),
        { eventSequence: receipt.sequence },
      );
    }
  };
}

/** Backward-compatible installer used by low-level tests and custom integrations. */
export function installComputerRecorder(
  device: ComputerDevice,
  writer: RecordingWriter,
): () => void {
  const checkpoint = createMacOSCheckpointCapture(
    device,
    writer.source({ type: "checkpoint", instanceId: "macos-checkpoint" }),
  );
  const actionHooks = installMidsceneActionHooks(
    device as ComputerDevice & MidsceneHookableInterface,
    writer.source({ type: "midscene", instanceId: "midscene-actions" }),
    checkpoint,
  );
  const restoreInput = installMacOSInputSource(
    device,
    writer.source({
      type: "macos-input",
      instanceId: "midscene-computer-device",
    }),
    checkpoint,
    () => actionHooks.current(),
  );
  return () => {
    restoreInput();
    actionHooks.restore();
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
