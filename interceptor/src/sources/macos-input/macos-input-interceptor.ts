import { randomUUID } from "node:crypto";
import type { ComputerDevice } from "@byted-lynx/actonce-midscene-adapter";
import { decodeDataUrl } from "../../common/recording-writer.js";
import type { LogicalAction } from "../../common/midscene-action-hooks.js";
import type { CaptureCheckpoint } from "../../core/checkpoint.js";
import type {
  EventCorrelation,
  RecorderContext,
  RecorderInterceptor,
  SourceDescriptor,
  ArtifactReference,
} from "../../core/source-interceptor.js";

type PrimitiveGroup = Record<string, (...args: never[]) => Promise<unknown>>;

/** Captures concrete mouse, keyboard and scroll operations on the local Mac. */
export class MacOSInputInterceptor implements RecorderInterceptor {
  readonly source: SourceDescriptor = {
    type: "macos-input",
    instanceId: "midscene-computer-device",
  };

  private restore?: () => void;

  constructor(
    private readonly device: ComputerDevice,
    private readonly captureCheckpoint: CaptureCheckpoint,
    private readonly currentLogicalAction: () => LogicalAction | undefined,
    private readonly onScreenshot?: (evidence: { sequence: number; artifact: ArtifactReference }) => void,
  ) {}

  start(context: RecorderContext): void {
    this.restore = installMacOSInputSource(
      this.device,
      context,
      this.captureCheckpoint,
      this.currentLogicalAction,
      this.onScreenshot,
    );
  }

  stop(): void {
    this.restore?.();
    this.restore = undefined;
  }
}

export function installMacOSInputSource(
  device: ComputerDevice,
  context: RecorderContext,
  captureCheckpoint: CaptureCheckpoint,
  currentLogicalAction: () => LogicalAction | undefined,
  onScreenshot?: (evidence: { sequence: number; artifact: ArtifactReference }) => void,
): () => void {
  const originals: Array<() => void> = [];
  const originalScreenshot = device.screenshotBase64.bind(device);

  const replace = (group: PrimitiveGroup, operation: string) => {
    const original = group[operation];
    if (typeof original !== "function") return;
    group[operation] = (async (...args: never[]) => {
      const primitiveId = randomUUID();
      const logical = currentLogicalAction();
      const standaloneActionId = logical ? null : randomUUID();
      const traceId = logical?.traceId ?? standaloneActionId ?? randomUUID();
      const logicalActionId = logical?.actionId ?? standaloneActionId ?? undefined;
      const correlation: EventCorrelation = {
        traceId,
        spanId: primitiveId,
        parentSpanId: logical?.spanId,
        logicalActionId,
      };
      const before = standaloneActionId
        ? await captureCheckpoint("before-action", standaloneActionId, {
            ...correlation,
            spanId: undefined,
            parentSpanId: primitiveId,
          })
        : null;
      context.emit({
        kind: "device.primitive.started",
        lifecycle: "started",
        origin: "midscene-device-adapter",
        primitiveId,
        logicalActionId,
        operation,
        arguments: args,
        beforeCaptureId: before?.captureId ?? logical?.beforeCaptureId,
        correlation,
      });
      try {
        const result = await original(...args);
        const after = standaloneActionId
          ? await captureCheckpoint("after-action", standaloneActionId, {
              ...correlation,
              spanId: undefined,
              parentSpanId: primitiveId,
            })
          : null;
        context.emit({
          kind: "device.primitive.completed",
          lifecycle: "completed",
          origin: "midscene-device-adapter",
          primitiveId,
          logicalActionId,
          operation,
          beforeCaptureId: before?.captureId ?? logical?.beforeCaptureId,
          afterCaptureId: after?.captureId ?? null,
          result: result ?? null,
          correlation,
        });
        return result;
      } catch (error) {
        context.emit({
          kind: "device.primitive.failed",
          lifecycle: "failed",
          origin: "midscene-device-adapter",
          primitiveId,
          logicalActionId,
          operation,
          beforeCaptureId: before?.captureId ?? logical?.beforeCaptureId,
          error: { message: errorMessage(error) },
          correlation,
        });
        throw error;
      }
    }) as PrimitiveGroup[string];
    originals.push(() => {
      group[operation] = original;
    });
  };

  const input = device.inputPrimitives;
  for (const operation of [
    "tap",
    "doubleClick",
    "rightClick",
    "hover",
    "dragAndDrop",
  ]) {
    replace(input.pointer as unknown as PrimitiveGroup, operation);
  }
  for (const operation of ["typeText", "keyboardPress", "clearInput"]) {
    replace(input.keyboard as unknown as PrimitiveGroup, operation);
  }
  replace(input.scroll as unknown as PrimitiveGroup, "scroll");

  device.screenshotBase64 = async () => {
    const image = await originalScreenshot();
    const decoded = decodeDataUrl(image);
    const artifact = await context.artifact(decoded.bytes, decoded.mediaType);
    const logical = currentLogicalAction();
    const receipt = context.emit({
      kind: "observation.screenshot",
      lifecycle: "instant",
      origin: "midscene-device-adapter",
      artifact,
      correlation: logical
        ? {
            traceId: logical.traceId,
            parentSpanId: logical.spanId,
            logicalActionId: logical.actionId,
          }
        : undefined,
    });
    onScreenshot?.({ sequence: receipt.sequence, artifact });
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
