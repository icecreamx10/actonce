import type { DevicePlatform } from "./device.js";
import type { CheckpointDifference, CheckpointSpec, SegmentIdempotency } from "./types.js";
/**
 * A serializable description of one deterministic device action — the
 * replaceable *how* of a segment. The executor maps it to the platform's
 * `replayIOSPrimitive` / `replayAndroidPrimitive`. This is exactly the recorded
 * primitive shape (`{ operation, arguments }`); it deliberately carries no
 * device handle, timing, or checkpoint data.
 */
export type SerializablePrimitive = {
    operation: string;
    arguments: unknown[];
};
/**
 * One compiled segment. Its **core** is the pair of important checkpoints
 * (frozen state contracts, the immutable *what*): `precondition` asserts "in the
 * from-state" and `postcondition` asserts "arrived at the to-state". `action` is
 * the replaceable *how*. Compile determines the checkpoints first; the action is
 * filled in afterwards and may be rewritten on recompilation without touching
 * the contracts.
 */
export type ReplayPlanSegment<TExpectation = unknown> = {
    id: string;
    precondition: CheckpointSpec<TExpectation>;
    postcondition: CheckpointSpec<TExpectation>;
    action: SerializablePrimitive;
    idempotency?: SegmentIdempotency;
};
/**
 * The versioned compiled product — a loadable, addressable replay plan. Compile
 * once into this; execute it many times. `version` is v1 on first compile and
 * bumped on recompilation; what is immutable across versions is the set of
 * important-checkpoint contracts, while a v(n) -> v(n+1) diff touches only each
 * segment's `action`.
 */
export type ReplayPlanFile<TExpectation = unknown> = {
    schemaVersion: 1;
    recordingId: string;
    version: number;
    platform: DevicePlatform;
    segments: ReplayPlanSegment<TExpectation>[];
};
/**
 * Checkpoint-centric execution result. A clean pass says nothing beyond
 * `passed` — the caller need not care how it got there. A failure names the
 * exact checkpoint that was not reached (its id, phase, state label, and
 * `expected` contract) plus attribution, so a skill can show the model *which*
 * state to drive the app to and reach it.
 */
export type ReplayResult<TExpectation = unknown, TActual = unknown> = {
    status: "passed";
    recordingId: string;
    version: number;
    segmentsRun: number;
} | {
    status: "failed";
    recordingId: string;
    version: number;
    segmentsRun: number;
    /**
     * The head-line field on failure: the important checkpoint the run failed
     * to reach. `state`/`expected` are the frozen contract the model must
     * satisfy; `differences` is the sanitized attribution of why it did not.
     */
    failedCheckpoint: FailedCheckpoint<TExpectation, TActual>;
};
export type FailedCheckpoint<TExpectation = unknown, TActual = unknown> = {
    segmentId: string;
    checkpointId: string;
    phase: "precondition" | "postcondition";
    /** The reason the important checkpoint was never reached. */
    reason: "mismatched";
    /** Human state label from the checkpoint contract, when present. */
    state?: string;
    /** The frozen state assertion the app must satisfy to reach this checkpoint. */
    expected: TExpectation;
    /** Sanitized differences between expected contract and observed state. */
    differences: CheckpointDifference[];
    actual?: TActual;
};
export declare class ReplayPlanError extends Error {
    readonly name = "ReplayPlanError";
}
/**
 * Parse and validate a `ReplayPlanFile` from raw JSON text. Rejects a plan that
 * is missing a checkpoint contract, because the checkpoint pair is the core of a
 * compiled segment — an action without both important checkpoints is not a
 * compiled segment. Returns a typed, structurally-checked plan.
 */
export declare function parseReplayPlan<TExpectation = unknown>(raw: string): ReplayPlanFile<TExpectation>;
//# sourceMappingURL=replay-plan.d.ts.map