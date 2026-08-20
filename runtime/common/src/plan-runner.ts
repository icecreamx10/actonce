import { CheckpointMismatchError } from "./errors.js";
import type { ReplayFlow } from "./flow.js";
import type {
  FailedCheckpoint,
  ReplayPlanFile,
  ReplayResult,
  SerializablePrimitive,
} from "./replay-plan.js";

export type RunReplayPlanOptions = {
  /**
   * Start at this segment after an agent has restored the app to that segment's
   * precondition. The precondition is still verified before any action runs.
   */
  fromSegmentId?: string;
};

/**
 * Execute a compiled plan through a wired `ReplayFlow`, one segment at a time,
 * and return a checkpoint-centric result. This is the device-agnostic core of
 * every per-platform executor: it maps each segment's serializable `action`
 * onto the injected `replayPrimitive` and turns a checkpoint failure into a
 * `failedCheckpoint` that names *which* important checkpoint (state contract)
 * was never reached.
 *
 * A clean run returns `{ status: "passed" }` and nothing about how it got there.
 * The first checkpoint that is not reached stops the run and is reported as the
 * head-line field, because reaching that state is the model's next job.
 */
export async function runReplayPlan<TExpectation, TActual>(
  flow: ReplayFlow<TExpectation, TActual>,
  plan: ReplayPlanFile<TExpectation>,
  replayPrimitive: (action: SerializablePrimitive) => Promise<void> | void,
  options: RunReplayPlanOptions = {},
): Promise<ReplayResult<TExpectation, TActual>> {
  const startIndex = findStartIndex(plan, options.fromSegmentId);
  let segmentsRun = 0;
  for (const segment of plan.segments.slice(startIndex)) {
    try {
      await flow.segment({
        id: segment.id,
        precondition: segment.precondition,
        deterministic: () => replayPrimitive(segment.action),
        postcondition: segment.postcondition,
        idempotency: segment.idempotency,
      });
      segmentsRun += 1;
    } catch (error) {
      if (error instanceof CheckpointMismatchError) {
        const phase = error.phase;
        const spec = phase === "precondition" ? segment.precondition : segment.postcondition;
        const failedCheckpoint: FailedCheckpoint<TExpectation, TActual> = {
          segmentId: segment.id,
          checkpointId: error.checkpointId,
          phase,
          reason: "mismatched",
          expected: spec.expected,
          differences: (error.result?.differences ?? []) as FailedCheckpoint<TExpectation, TActual>["differences"],
          actual: error.result?.actual as TActual | undefined,
        };
        if (spec.state !== undefined) failedCheckpoint.state = spec.state;
        return {
          status: "failed",
          recordingId: plan.recordingId,
          version: plan.version,
          segmentsRun,
          failedCheckpoint,
        };
      }
      throw error;
    }
  }
  return {
    status: "passed",
    recordingId: plan.recordingId,
    version: plan.version,
    segmentsRun,
  };
}

function findStartIndex<TExpectation>(
  plan: ReplayPlanFile<TExpectation>,
  fromSegmentId: string | undefined,
): number {
  if (fromSegmentId === undefined) return 0;
  const index = plan.segments.findIndex((segment) => segment.id === fromSegmentId);
  if (index < 0) throw new Error(`unknown fromSegmentId: ${fromSegmentId}`);
  return index;
}
