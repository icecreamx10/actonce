import type { CheckpointResult } from "./types.js";
export declare class CheckpointMismatchError<TActual = unknown> extends Error {
    readonly segmentId: string;
    readonly phase: "precondition" | "postcondition";
    readonly checkpointId: string;
    readonly result: CheckpointResult<TActual>;
    readonly name: string;
    constructor(segmentId: string, phase: "precondition" | "postcondition", checkpointId: string, result: CheckpointResult<TActual>, message?: string);
}
export declare class FallbackFailedError<TActual = unknown> extends CheckpointMismatchError<TActual> {
    readonly name = "FallbackFailedError";
}
//# sourceMappingURL=errors.d.ts.map