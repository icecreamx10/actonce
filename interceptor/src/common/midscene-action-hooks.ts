import { randomUUID } from "node:crypto";
import type { RecordingWriter } from "./recording-writer.js";

export type MidsceneHookableInterface = {
  beforeInvokeAction?: (actionName: string, param: unknown) => Promise<void>;
  afterInvokeAction?: (actionName: string, param: unknown) => Promise<void>;
};

export type LogicalAction = {
  actionId: string;
  actionName: string;
  beforeCaptureId: string;
};

export type MidsceneActionHookController = {
  current(): LogicalAction | undefined;
  restore(): void;
};

/** Adds logical action boundaries while preserving hooks already on the device. */
export function installMidsceneActionHooks(
  target: MidsceneHookableInterface,
  writer: RecordingWriter,
  captureCheckpoint: (
    phase: "before-action" | "after-action",
    actionId: string,
  ) => Promise<{ captureId: string }>,
): MidsceneActionHookController {
  const originalBefore = target.beforeInvokeAction?.bind(target);
  const originalAfter = target.afterInvokeAction?.bind(target);
  let active: LogicalAction | undefined;

  const abandon = (reason: string) => {
    if (!active) return;
    writer.append({
      kind: "logical.action.outcome-unknown",
      origin: "midscene-action-hook",
      actionId: active.actionId,
      operation: active.actionName,
      beforeCaptureId: active.beforeCaptureId,
      reason,
    });
    active = undefined;
  };

  target.beforeInvokeAction = async (actionName, rawParam) => {
    // Midscene has no action-error hook. A still-open action here normally
    // means action.call threw and afterInvokeAction was skipped.
    abandon("superseded before afterInvokeAction was called");
    await originalBefore?.(actionName, rawParam);
    const actionId = randomUUID();
    const before = await captureCheckpoint("before-action", actionId);
    active = { actionId, actionName, beforeCaptureId: before.captureId };
    writer.append({
      kind: "logical.action.started",
      origin: "midscene-action-hook",
      actionId,
      operation: actionName,
      rawArguments: rawParam,
      beforeCaptureId: before.captureId,
    });
  };

  target.afterInvokeAction = async (actionName, normalizedParam) => {
    await originalAfter?.(actionName, normalizedParam);
    if (!active) {
      writer.append({
        kind: "logical.action.unmatched-after-hook",
        origin: "midscene-action-hook",
        operation: actionName,
        normalizedArguments: normalizedParam,
      });
      return;
    }
    const logical = active;
    const after = await captureCheckpoint("after-action", logical.actionId);
    writer.append({
      kind: "logical.action.completed",
      origin: "midscene-action-hook",
      actionId: logical.actionId,
      operation: actionName,
      normalizedArguments: normalizedParam,
      beforeCaptureId: logical.beforeCaptureId,
      afterCaptureId: after.captureId,
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
