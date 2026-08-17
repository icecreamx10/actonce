export class ReplayPlanError extends Error {
    name = "ReplayPlanError";
}
/**
 * Parse and validate a `ReplayPlanFile` from raw JSON text. Rejects a plan that
 * is missing a checkpoint contract, because the checkpoint pair is the core of a
 * compiled segment — an action without both important checkpoints is not a
 * compiled segment. Returns a typed, structurally-checked plan.
 */
export function parseReplayPlan(raw) {
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch (error) {
        throw new ReplayPlanError(`plan is not valid JSON: ${message(error)}`);
    }
    if (!isRecord(parsed))
        throw new ReplayPlanError("plan must be a JSON object");
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
    const segments = parsed.segments.map((segment, index) => validateSegment(segment, index));
    return {
        schemaVersion: 1,
        recordingId: parsed.recordingId,
        version: parsed.version,
        platform: parsed.platform,
        segments,
    };
}
function validateSegment(segment, index) {
    if (!isRecord(segment))
        throw new ReplayPlanError(`plan.segments[${index}] must be an object`);
    if (typeof segment.id !== "string" || !segment.id) {
        throw new ReplayPlanError(`plan.segments[${index}].id must be a non-empty string`);
    }
    const precondition = validateCheckpoint(segment.precondition, index, "precondition");
    const postcondition = validateCheckpoint(segment.postcondition, index, "postcondition");
    if (segment.fallback !== undefined) {
        throw new ReplayPlanError(`plan.segments[${index}].fallback is not supported; plan execution is deterministic`);
    }
    const action = segment.action;
    if (!isRecord(action) || typeof action.operation !== "string" || !Array.isArray(action.arguments)) {
        throw new ReplayPlanError(`plan.segments[${index}].action must be { operation: string, arguments: unknown[] }`);
    }
    const result = {
        id: segment.id,
        precondition,
        postcondition,
        action: { operation: action.operation, arguments: action.arguments },
    };
    if (segment.idempotency !== undefined)
        result.idempotency = segment.idempotency;
    return result;
}
function validateCheckpoint(spec, index, phase) {
    if (!isRecord(spec)) {
        throw new ReplayPlanError(`plan.segments[${index}].${phase} (the state contract) is required and must be an object`);
    }
    if (typeof spec.id !== "string" || !spec.id) {
        throw new ReplayPlanError(`plan.segments[${index}].${phase}.id must be a non-empty string`);
    }
    if (!("expected" in spec)) {
        throw new ReplayPlanError(`plan.segments[${index}].${phase}.expected (the state assertion) is required`);
    }
    return spec;
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isPlatform(value) {
    return value === "macos" || value === "ios" || value === "android" || value === "windows";
}
function message(error) {
    return error instanceof Error ? error.message : String(error);
}
//# sourceMappingURL=replay-plan.js.map