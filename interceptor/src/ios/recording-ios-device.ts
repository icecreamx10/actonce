import { randomUUID } from "node:crypto";
import { IOSAgent, IOSDevice } from "@byted-lynx/actonce-midscene-adapter";
import {
  RecordingWriter,
  decodeDataUrl,
  type RecordingWriterOptions,
} from "../common/recording-writer.js";
import type { MidsceneHookableInterface } from "../common/midscene-action-hooks.js";
import type { CaptureCheckpoint } from "../core/checkpoint.js";
import type {
  EventCorrelation,
  RecorderContext,
} from "../core/source-interceptor.js";
import { MidsceneInterceptor } from "../sources/midscene/midscene-interceptor.js";
import {
  WdaInterceptor,
  type WdaInterceptorOptions,
} from "../sources/wda/wda-interceptor.js";

type IOSDeviceOptions = NonNullable<ConstructorParameters<typeof IOSDevice>[0]>;
type IOSAgentOptions = NonNullable<ConstructorParameters<typeof IOSAgent>[1]>;
type RecorderOptions = Pick<RecordingWriterOptions, "rootDir" | "recordingId"> &
  Pick<WdaInterceptorOptions, "listenHost" | "listenPort" | "upstreamHost" | "upstreamPort">;

export type RecordedIOS = {
  agent: IOSAgent;
  device: IOSDevice;
  writer: RecordingWriter;
  proxy: { host: string; port: number };
  close(): Promise<void>;
};

/** Fixed midscene-ios profile: Midscene semantics + WDA + iOS checkpoints. */
export async function agentForRecordedIOS(
  deviceOptions: IOSDeviceOptions = {},
  agentOptions: IOSAgentOptions = {},
  recorderOptions: RecorderOptions = {},
): Promise<RecordedIOS> {
  const listenHost = recorderOptions.listenHost ?? "127.0.0.1";
  const listenPort = recorderOptions.listenPort ?? 8200;
  const upstreamHost = recorderOptions.upstreamHost ?? "127.0.0.1";
  const upstreamPort = recorderOptions.upstreamPort ?? 8100;
  const writer = await RecordingWriter.create({
    platform: "ios",
    recorder: "midscene-ios-profile",
    rootDir: recorderOptions.rootDir,
    recordingId: recorderOptions.recordingId,
    metadata: {
      profile: "midscene-ios",
      proxy: { listenHost, listenPort, upstreamHost, upstreamPort },
    },
  });

  let midscene: MidsceneInterceptor | undefined;
  let transportCorrelation: EventCorrelation | undefined;
  const wda = new WdaInterceptor({
    listenHost,
    listenPort,
    upstreamHost,
    upstreamPort,
    currentCorrelation: () => {
      if (transportCorrelation) return transportCorrelation;
      const logical = midscene?.current();
      return logical
        ? {
            traceId: logical.traceId,
            spanId: logical.spanId,
            logicalActionId: logical.actionId,
          }
        : undefined;
    },
  });
  await writer.attach(wda);
  const address = wda.address();
  if (!address) {
    writer.markIncomplete("WDA proxy started without a resolved address");
    await writer.close();
    throw new Error("ActOnce could not resolve the WDA proxy address");
  }

  const device = new IOSDevice({
    ...deviceOptions,
    wdaHost: address.host,
    wdaPort: address.port,
  });
  try {
    await device.connect();
  } catch (error) {
    writer.markIncomplete(`iOS connection failed: ${errorMessage(error)}`);
    await writer.close();
    throw new Error(
      `${errorMessage(error)}\nActOnce failure recording: ${writer.recordingDir}`,
    );
  }

  const checkpointContext = writer.source({
    type: "checkpoint",
    instanceId: "ios-checkpoint",
  });
  const observationScreenshots: Array<{
    sequence: number;
    artifact: import("../core/source-interceptor.js").ArtifactReference;
  }> = [];
  const captureCheckpoint = createIOSCheckpointCapture(
    device,
    checkpointContext,
    (correlation) => {
      transportCorrelation = correlation;
    },
    (evidence) => { observationScreenshots.push(evidence); },
  );
  const agent = new IOSAgent(device, agentOptions);
  midscene = new MidsceneInterceptor(
    agent,
    device as IOSDevice & MidsceneHookableInterface,
    captureCheckpoint,
    {
      peekScreenshots: () => [...observationScreenshots],
      consumeScreenshots: () => { observationScreenshots.length = 0; },
    },
  );
  await writer.attach(midscene);

  let closed = false;
  return {
    agent,
    device,
    writer,
    proxy: address,
    async close() {
      if (closed) return;
      closed = true;
      try {
        await device.destroy();
      } catch (error) {
        writer.markIncomplete(`iOS device cleanup failed: ${errorMessage(error)}`);
      } finally {
        await writer.close();
      }
    },
  };
}

export function createIOSCheckpointCapture(
  device: IOSDevice,
  context: RecorderContext,
  setTransportCorrelation: (correlation: EventCorrelation | undefined) => void,
  onScreenshot?: (evidence: {
    sequence: number;
    artifact: import("../core/source-interceptor.js").ArtifactReference;
  }) => void,
): CaptureCheckpoint {
  return async (phase, actionId, correlation) => {
    const captureId = randomUUID();
    const startedMonotonicNs = context.monotonicNs();
    const checkpointCorrelation = {
      ...correlation,
      captureId,
      logicalActionId: correlation?.logicalActionId ?? actionId ?? undefined,
    };
    setTransportCorrelation(checkpointCorrelation);
    try {
      const [image, viewport, nativeUi] = await Promise.all([
        device.screenshotBase64(),
        device.size(),
        captureWdaSource(device),
      ]);
      const decoded = decodeDataUrl(image);
      const screenshot = await context.artifact(decoded.bytes, decoded.mediaType);
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
          deviceMetadata: { platform: "ios", viewport },
          nativeUi: {
            status: "available",
            source: "wda-accessibility-tree",
            artifact: nativeUiArtifact,
          },
        },
        coherence: {
          status: "bounded",
          reason: "screenshot and native UI were captured concurrently through WDA",
        },
        timing: {
          startedMonotonicNs,
          completedMonotonicNs: context.monotonicNs(),
        },
        correlation: checkpointCorrelation,
      });
      onScreenshot?.({ sequence: receipt.sequence, artifact: screenshot });
      return { captureId, sequence: receipt.sequence };
    } catch (error) {
      context.markIncomplete(
        `iOS checkpoint ${captureId} failed: ${errorMessage(error)}`,
      );
      const receipt = context.emit({
        kind: "checkpoint.failed",
        lifecycle: "failed",
        origin: "recorder",
        captureId,
        actionId,
        phase,
        error: { message: errorMessage(error) },
        correlation: checkpointCorrelation,
      });
      throw Object.assign(
        error instanceof Error ? error : new Error(String(error)),
        { eventSequence: receipt.sequence },
      );
    } finally {
      setTransportCorrelation(undefined);
    }
  };
}

async function captureWdaSource(device: IOSDevice): Promise<unknown> {
  const response = await device.runWdaRequest<unknown>("GET", "/source");
  if (response && typeof response === "object" && "value" in response) {
    return (response as { value: unknown }).value;
  }
  return response;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
