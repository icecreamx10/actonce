export class CheckpointMismatchError extends Error {
    segmentId;
    phase;
    checkpointId;
    result;
    name = "CheckpointMismatchError";
    constructor(segmentId, phase, checkpointId, result, message = `Checkpoint ${checkpointId} ${result.status} during ${segmentId} ${phase}`) {
        super(message);
        this.segmentId = segmentId;
        this.phase = phase;
        this.checkpointId = checkpointId;
        this.result = result;
    }
}
export class FallbackFailedError extends CheckpointMismatchError {
    name = "FallbackFailedError";
}
//# sourceMappingURL=errors.js.map