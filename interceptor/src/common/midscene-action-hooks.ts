import { randomUUID } from "node:crypto";
import type { CaptureCheckpoint } from "../core/checkpoint.js";
import type { RecorderContext } from "../core/source-interceptor.js";

export type MidsceneHookableInterface = {
  beforeInvokeAction?: (actionName: string, param: unknown) => Promise<void>;
  afterInvokeAction?: (actionName: string, param: unknown) => Promise<void>;
};

export type LogicalAction = {
  actionId: string;
  actionName: string;
  beforeCaptureId: string;
  traceId: string;
  spanId: string;
};

export type MidsceneActionHookController = {
  current(): LogicalAction | undefined;
  restore(): void;
};

/** Adds logical action boundaries while preserving hooks already on the device. */
export function installMidsceneActionHooks(
  target: MidsceneHookableInterface,
  context: RecorderContext,
  captureCheckpoint: CaptureCheckpoint,
): MidsceneActionHookController {
  const originalBefore = target.beforeInvokeAction?.bind(target);
  const originalAfter = target.afterInvokeAction?.bind(target);
  let active: LogicalAction | undefined;

  const abandon = (reason: string) => {
    if (!active) return;
    context.emit({
      kind: "logical.action.outcome-unknown",
      lifecycle: "failed",
      origin: "midscene-action-hook",
      actionId: active.actionId,
      operation: active.actionName,
      beforeCaptureId: active.beforeCaptureId,
      reason,
      correlation: {
        traceId: active.traceId,
        spanId: active.spanId,
        logicalActionId: active.actionId,
      },
    });
    active = undefined;
  };

  target.beforeInvokeAction = async (actionName, rawParam) => {
    // Midscene has no action-error hook. A still-open action here normally
    // means action.call threw and afterInvokeAction was skipped.
    abandon("superseded before afterInvokeAction was called");
    await originalBefore?.(actionName, rawParam);
    const actionId = randomUUID();
    const traceId = randomUUID();
    const spanId = randomUUID();
    const correlation = { traceId, spanId, logicalActionId: actionId };
    const before = await captureCheckpoint("before-action", actionId, {
      traceId,
      parentSpanId: spanId,
      logicalActionId: actionId,
    });
    active = {
      actionId,
      actionName,
      beforeCaptureId: before.captureId,
      traceId,
      spanId,
    };
    context.emit({
      kind: "logical.action.started",
      lifecycle: "started",
      origin: "midscene-action-hook",
      actionId,
      operation: actionName,
      rawArguments: rawParam,
      beforeCaptureId: before.captureId,
      correlation,
    });
  };

  target.afterInvokeAction = async (actionName, normalizedParam) => {
    await originalAfter?.(actionName, normalizedParam);
    if (!active) {
      context.emit({
        kind: "logical.action.unmatched-after-hook",
        lifecycle: "instant",
        origin: "midscene-action-hook",
        operation: actionName,
        normalizedArguments: normalizedParam,
      });
      return;
    }
    const logical = active;
    const after = await captureCheckpoint("after-action", logical.actionId, {
      traceId: logical.traceId,
      parentSpanId: logical.spanId,
      logicalActionId: logical.actionId,
    });
    context.emit({
      kind: "logical.action.completed",
      lifecycle: "completed",
      origin: "midscene-action-hook",
      actionId: logical.actionId,
      operation: actionName,
      normalizedArguments: normalizedParam,
      beforeCaptureId: logical.beforeCaptureId,
      afterCaptureId: after.captureId,
      correlation: {
        traceId: logical.traceId,
        spanId: logical.spanId,
        logicalActionId: logical.actionId,
      },
    });
    active = undefined;
  };

  return {
    current: () => active,
    restore() {
      abandon("recorder closed before afterInvokeAction was called");
      target.beforeInvokeAction = originalBefore;
      target.afterInvokeAction = originalAfter;
    },
  };
}
