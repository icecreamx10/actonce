import type { ReplayFlow } from "./flow.js";
import type { ReplayPlanFile, ReplayResult, SerializablePrimitive } from "./replay-plan.js";
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
export declare function runReplayPlan<TExpectation, TActual>(flow: ReplayFlow<TExpectation, TActual>, plan: ReplayPlanFile<TExpectation>, replayPrimitive: (action: SerializablePrimitive) => Promise<void> | void, options?: RunReplayPlanOptions): Promise<ReplayResult<TExpectation, TActual>>;
//# sourceMappingURL=plan-runner.d.ts.map