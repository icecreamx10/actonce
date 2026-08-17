import type { DevicePlatform } from "./device.js";
import type {
  CheckpointDifference,
  CheckpointSpec,
  SegmentIdempotency,
} from "./types.js";

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
export type ReplayResult<TExpectation = unknown, TActual = unknown> =
  | {
      status: "passed";
      recordingId: string;
      version: number;
      segmentsRun: number;
    }
  | {
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

export class ReplayPlanError extends Error {
  readonly name = "ReplayPlanError";
}

/**
 * Parse and validate a `ReplayPlanFile` from raw JSON text. Rejects a plan that
 * is missing a checkpoint contract, because the checkpoint pair is the core of a
 * compiled segment — an action without both important checkpoints is not a
 * compiled segment. Returns a typed, structurally-checked plan.
 */
export function parseReplayPlan<TExpectation = unknown>(
  raw: string,
): ReplayPlanFile<TExpectation> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new ReplayPlanError(`plan is not valid JSON: ${message(error)}`);
  }
  if (!isRecord(parsed)) throw new ReplayPlanError("plan must be a JSON object");
  if (parsed.schemaVersion !== 1) {
    throw new ReplayPlanError(`unsupported plan schemaVersion: ${String(parsed.schemaVersion)}`);
  }
  if (typeof parsed.recordingId !== "string" || !parsed.recordingId) {
    throw new ReplayPlanError("plan.recordingId must be a non-empty string");
  }
  if (typeof parsed.version !== "number" || !Number.isInteger(parsed.version) || parsed.version < 1) {
    throw new ReplayPlanError("plan.version must be an integer >= 1");
  }
  if (!isPlatform(parsed.platform)) {
    throw new ReplayPlanError(`plan.platform must be one of macos|ios|android|windows, got ${String(parsed.platform)}`);
  }
  if (!Array.isArray(parsed.segments) || parsed.segments.length === 0) {
    throw new ReplayPlanError("plan.segments must be a non-empty array");
  }
  const segments = parsed.segments.map((segment, index) => validateSegment<TExpectation>(segment, index));
  return {
    schemaVersion: 1,
    recordingId: parsed.recordingId,
    version: parsed.version,
    platform: parsed.platform,
    segments,
  };
}

function validateSegment<TExpectation>(segment: unknown, index: number): ReplayPlanSegment<TExpectation> {
  if (!isRecord(segment)) throw new ReplayPlanError(`plan.segments[${index}] must be an object`);
  if (typeof segment.id !== "string" || !segment.id) {
    throw new ReplayPlanError(`plan.segments[${index}].id must be a non-empty string`);
  }
  const precondition = validateCheckpoint<TExpectation>(segment.precondition, index, "precondition");
  const postcondition = validateCheckpoint<TExpectation>(segment.postcondition, index, "postcondition");
  if (segment.fallback !== undefined) {
    throw new ReplayPlanError(
      `plan.segments[${index}].fallback is not supported; plan execution is deterministic`,
    );
  }
  const action = segment.action;
  if (!isRecord(action) || typeof action.operation !== "string" || !Array.isArray(action.arguments)) {
    throw new ReplayPlanError(`plan.segments[${index}].action must be { operation: string, arguments: unknown[] }`);
  }
  const result: ReplayPlanSegment<TExpectation> = {
    id: segment.id,
    precondition,
    postcondition,
    action: { operation: action.operation, arguments: action.arguments },
  };
  if (segment.idempotency !== undefined) result.idempotency = segment.idempotency as SegmentIdempotency;
  return result;
}

function validateCheckpoint<TExpectation>(
  spec: unknown,
  index: number,
  phase: "precondition" | "postcondition",
): CheckpointSpec<TExpectation> {
  if (!isRecord(spec)) {
    throw new ReplayPlanError(`plan.segments[${index}].${phase} (the state contract) is required and must be an object`);
  }
  if (typeof spec.id !== "string" || !spec.id) {
    throw new ReplayPlanError(`plan.segments[${index}].${phase}.id must be a non-empty string`);
  }
  if (!("expected" in spec)) {
    throw new ReplayPlanError(`plan.segments[${index}].${phase}.expected (the state assertion) is required`);
  }
  return spec as unknown as CheckpointSpec<TExpectation>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPlatform(value: unknown): value is DevicePlatform {
  return value === "macos" || value === "ios" || value === "android" || value === "windows";
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
