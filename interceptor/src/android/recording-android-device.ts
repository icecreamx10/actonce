import { randomUUID } from "node:crypto";
import {
  AndroidAgent,
  AndroidDevice,
  getConnectedDevices,
} from "@midscene/android";
import {
  RecordingWriter,
  decodeDataUrl,
  type RecordingWriterOptions,
} from "../common/recording-writer.js";
import type { MidsceneHookableInterface } from "../common/midscene-action-hooks.js";
import type { CaptureCheckpoint } from "../core/checkpoint.js";
import type { RecorderContext } from "../core/source-interceptor.js";
import { MidsceneInterceptor } from "../sources/midscene/midscene-interceptor.js";

type DeviceOptions = NonNullable<
  ConstructorParameters<typeof AndroidDevice>[1]
> & { serial?: string };
type AgentOptions = NonNullable<ConstructorParameters<typeof AndroidAgent>[1]>;
type RecorderOptions = Pick<RecordingWriterOptions, "rootDir" | "recordingId">;
export type RecordedAndroid = {
  agent: AndroidAgent;
  device: AndroidDevice;
  writer: RecordingWriter;
  serial: string;
  close(): Promise<void>;
};

/** Fixed midscene-android profile: Midscene semantics + normalized actions + screenshot/UI-tree checkpoints. */
export async function agentForRecordedAndroid(
  deviceOptions: DeviceOptions = {},
  agentOptions: AgentOptions = {},
  recorderOptions: RecorderOptions = {},
): Promise<RecordedAndroid> {
  const devices = await getConnectedDevices(deviceOptions);
  const serial =
    deviceOptions.serial ??
    process.env.ACTONCE_ANDROID_SERIAL ??
    devices[0]?.udid;
  if (!serial || !devices.some((item) => item.udid === serial))
    throw new Error(`Android device ${serial ?? "<none>"} is not connected`);
  const writer = await RecordingWriter.create({
    platform: "android",
    recorder: "midscene-android-profile",
    rootDir: recorderOptions.rootDir,
    recordingId: recorderOptions.recordingId,
    metadata: {
      profile: "midscene-android",
      serial,
      displayId: deviceOptions.displayId ?? 0,
    },
  });
  const device = new AndroidDevice(serial, {
    ...deviceOptions,
    imeStrategy: deviceOptions.imeStrategy ?? "always-yadb",
    keyboardDismissStrategy:
      deviceOptions.keyboardDismissStrategy ?? "back-first",
  });
  try {
    await device.connect();
  } catch (error) {
    writer.markIncomplete(`Android connection failed: ${message(error)}`);
    await writer.close();
    throw new Error(
      `${message(error)}\nActOnce failure recording: ${writer.recordingDir}`,
    );
  }

  const checkpointContext = writer.source({
    type: "checkpoint",
    instanceId: "android-checkpoint",
  });
  const observationScreenshots: Array<{
    sequence: number;
    artifact: import("../core/source-interceptor.js").ArtifactReference;
  }> = [];
  const captureCheckpoint = createAndroidCheckpointCapture(
    device,
    checkpointContext,
    (evidence) => observationScreenshots.push(evidence),
  );
  const agent = new AndroidAgent(device, agentOptions);
  const midscene = new MidsceneInterceptor(
    agent,
    device as AndroidDevice & MidsceneHookableInterface,
    captureCheckpoint,
    {
      peekScreenshots: () => [...observationScreenshots],
      consumeScreenshots: () => {
        observationScreenshots.length = 0;
      },
    },
  );
  await writer.attach(midscene);
  let closed = false;
  return {
    agent,
    device,
    writer,
    serial,
    async close() {
      if (closed) return;
      closed = true;
      try {
        await device.destroy();
      } catch (error) {
        writer.markIncomplete(
          `Android device cleanup failed: ${message(error)}`,
        );
      } finally {
        await writer.close();
      }
    },
  };
}

export function createAndroidCheckpointCapture(
  device: AndroidDevice,
  context: RecorderContext,
  onScreenshot?: (evidence: {
    sequence: number;
    artifact: import("../core/source-interceptor.js").ArtifactReference;
  }) => void,
): CaptureCheckpoint {
  return async (phase, actionId, correlation) => {
    const captureId = randomUUID();
    const startedMonotonicNs = context.monotonicNs();
    try {
      const [image, viewport, nativeUi] = await Promise.all([
        device.screenshotBase64(),
        device.size(),
        device.getUITree(),
      ]);
      const decoded = decodeDataUrl(image);
      const screenshot = await context.artifact(
        decoded.bytes,
        decoded.mediaType,
      );
      const nativeUiArtifact = context.storeArtifact(
        Buffer.from(JSON.stringify(nativeUi), "utf8"),
        "application/json",
      );
      const receipt = context.emit({
        kind: "checkpoint.captured",
        lifecycle: "instant",
        origin: "recorder",
        captureId,
        actionId,
        phase,
        evidence: {
          screenshot,
          deviceMetadata: { platform: "android", viewport },
          nativeUi: {
            status: "available",
            source: "android-uiautomator-tree",
            artifact: nativeUiArtifact,
          },
        },
        coherence: {
          status: "bounded",
          reason:
            "screenshot and native UI were captured concurrently through one AndroidDevice",
        },
        timing: {
          startedMonotonicNs,
          completedMonotonicNs: context.monotonicNs(),
        },
        correlation: {
          ...correlation,
          captureId,
          logicalActionId:
            correlation?.logicalActionId ?? actionId ?? undefined,
        },
      });
      onScreenshot?.({ sequence: receipt.sequence, artifact: screenshot });
      return { captureId, sequence: receipt.sequence };
    } catch (error) {
      context.markIncomplete(
        `Android checkpoint ${captureId} failed: ${message(error)}`,
      );
      const receipt = context.emit({
        kind: "checkpoint.failed",
        lifecycle: "failed",
        origin: "recorder",
        captureId,
        actionId,
        phase,
        error: { message: message(error) },
        correlation,
      });
      throw Object.assign(
        error instanceof Error ? error : new Error(String(error)),
        { eventSequence: receipt.sequence },
      );
    }
  };
}
function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
