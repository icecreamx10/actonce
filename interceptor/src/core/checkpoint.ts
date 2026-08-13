import type { EventCorrelation } from "./source-interceptor.js";

export type CheckpointPhase =
  | "before-action"
  | "after-action"
  | "manual-observation";

export type CaptureCheckpoint = (
  phase: CheckpointPhase,
  actionId: string | null,
  correlation?: EventCorrelation,
) => Promise<{ captureId: string; sequence: number }>;

