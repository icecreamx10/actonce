import type { ComputerAgent, ComputerDevice } from "@midscene/computer";
import type { CaptureCheckpoint } from "../../core/checkpoint.js";
import type {
  RecorderContext,
  RecorderInterceptor,
  SourceDescriptor,
} from "../../core/source-interceptor.js";
import {
  installMidsceneActionHooks,
  type LogicalAction,
  type MidsceneActionHookController,
  type MidsceneHookableInterface,
} from "../../common/midscene-action-hooks.js";
import { MidsceneDumpNormalizer } from "./dump-normalizer.js";
import type { ObservationScreenshotEvidence } from "./dump-normalizer.js";

type ObservableAgent = Pick<
  ComputerAgent<ComputerDevice>,
  "addProgressListener" | "addDumpUpdateListener"
>;

export type MidsceneObservationEvidence = {
  peekScreenshots(): ObservationScreenshotEvidence[];
  consumeScreenshots(): void;
};

/** Captures Midscene semantics, observations, dumps, and logical action spans. */
export class MidsceneInterceptor implements RecorderInterceptor {
  readonly source: SourceDescriptor = {
    type: "midscene",
    instanceId: "midscene-agent",
  };

  private context?: RecorderContext;
  private actionHooks?: MidsceneActionHookController;
  private removeProgressListener?: () => void;
  private removeDumpListener?: () => void;
  private readonly dumpNormalizer = new MidsceneDumpNormalizer();

  constructor(
    private readonly agent: ObservableAgent,
    private readonly actionTarget: MidsceneHookableInterface,
    private readonly captureCheckpoint: CaptureCheckpoint,
    private readonly observationEvidence?: MidsceneObservationEvidence,
  ) {}

  start(context: RecorderContext): void {
    this.context = context;
    this.actionHooks = installMidsceneActionHooks(
      this.actionTarget,
      context,
      this.captureCheckpoint,
    );
    this.removeProgressListener = this.agent.addProgressListener((event) => {
      context.emit({
        kind: "midscene.progress",
        lifecycle: "instant",
        origin: "midscene-agent-hook",
        progress: event,
      });
    });
    this.removeDumpListener = this.agent.addDumpUpdateListener(
      (dump, executionDump) => {
        const artifact = context.storeArtifact(
          Buffer.from(dump, "utf8"),
          "application/json",
        );
        context.emit({
          kind: "midscene.execution-dump.updated",
          lifecycle: "instant",
          origin: "midscene-agent-hook",
          executionId: executionDump?.id ?? null,
          artifact,
          correlation: this.currentCorrelation(),
        });
        const normalized = this.dumpNormalizer.events(
          dump,
          artifact,
          this.observationEvidence?.peekScreenshots(),
        );
        for (const event of normalized) {
          context.emit(event);
        }
        if (normalized.length) this.observationEvidence?.consumeScreenshots();
      },
    );
  }

  current(): LogicalAction | undefined {
    return this.actionHooks?.current();
  }

  stop(): void {
    this.removeProgressListener?.();
    this.removeDumpListener?.();
    this.actionHooks?.restore();
    this.context = undefined;
  }

  private currentCorrelation() {
    const logical = this.current();
    return logical
      ? {
          traceId: logical.traceId,
          parentSpanId: logical.spanId,
          logicalActionId: logical.actionId,
        }
      : undefined;
  }
}
