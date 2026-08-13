import type { CheckpointResult } from "./types.js";

export class CheckpointMismatchError<TActual = unknown> extends Error {
  readonly name: string = "CheckpointMismatchError";

  constructor(
    readonly segmentId: string,
    readonly phase: "precondition" | "postcondition",
    readonly checkpointId: string,
    readonly result: CheckpointResult<TActual>,
    message = `Checkpoint ${checkpointId} ${result.status} during ${segmentId} ${phase}`,
  ) {
    super(message);
  }
}

export class FallbackFailedError<TActual = unknown> extends CheckpointMismatchError<TActual> {
  readonly name = "FallbackFailedError";
}
