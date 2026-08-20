import { CheckpointMismatchError } from "./errors.js";
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
export async function runReplayPlan(flow, plan, replayPrimitive, options = {}) {
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
        }
        catch (error) {
            if (error instanceof CheckpointMismatchError) {
                const phase = error.phase;
                const spec = phase === "precondition" ? segment.precondition : segment.postcondition;
                const failedCheckpoint = {
                    segmentId: segment.id,
                    checkpointId: error.checkpointId,
                    phase,
                    reason: "mismatched",
                    expected: spec.expected,
                    differences: (error.result?.differences ?? []),
                    actual: error.result?.actual,
                };
                if (spec.state !== undefined)
                    failedCheckpoint.state = spec.state;
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
function findStartIndex(plan, fromSegmentId) {
    if (fromSegmentId === undefined)
        return 0;
    const index = plan.segments.findIndex((segment) => segment.id === fromSegmentId);
    if (index < 0)
        throw new Error(`unknown fromSegmentId: ${fromSegmentId}`);
    return index;
}
//# sourceMappingURL=plan-runner.js.map