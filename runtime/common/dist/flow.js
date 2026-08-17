import { CheckpointMismatchError, FallbackFailedError } from "./errors.js";
export class ReplayFlow {
    options;
    policy;
    fallbackCount = 0;
    fallbackDurationMs = 0;
    checkpointPollCount = 0;
    checkpointCaptureDurationMs = 0;
    checkpointSettleDelayMs = 0;
    checkpointWaitDurationMs = 0;
    checkpointTimeoutCount = 0;
    constructor(options) {
        this.options = options;
        this.policy = options.policy ?? "disabled";
        if (this.policy === "recover" && !options.fallback) {
            throw new Error("fallback driver is required when replay policy is recover");
        }
    }
    diagnostics() {
        return {
            strategy: this.policy === "recover" ? "hybrid" : "deterministic",
            fallbackCount: this.fallbackCount,
            fallbackDurationMs: this.fallbackDurationMs,
            checkpointPollCount: this.checkpointPollCount,
            checkpointCaptureDurationMs: this.checkpointCaptureDurationMs,
            checkpointSettleDelayMs: this.checkpointSettleDelayMs,
            checkpointWaitDurationMs: this.checkpointWaitDurationMs,
            checkpointTimeoutCount: this.checkpointTimeoutCount,
        };
    }
    async checkpoint(segmentId, phase, spec, context) {
        const now = this.options.now ?? Date.now;
        const started = now();
        const result = await this.options.checkpoints.verify(spec, context);
        const captureDurationMs = Math.max(0, now() - started);
        this.checkpointCaptureDurationMs += captureDurationMs;
        this.checkpointWaitDurationMs += captureDurationMs;
        await this.emit({
            kind: "replay.checkpoint.checked",
            segmentId,
            phase,
            checkpointId: spec.id,
            checkpoint: result,
            captureDurationMs,
        });
        return result;
    }
    /**
     * Wait for a standalone checkpoint using the same settle scheduler and
     * diagnostics as segment pre/postconditions. This is useful for externally
     * driven E2E actions whose execution remains outside ActOnce.
     */
    async waitForCheckpoint(segmentId, phase, spec) {
        return this.settleCheckpoint(segmentId, phase, spec);
    }
    async segment(segment) {
        const idempotency = segment.idempotency ?? "safe";
        await this.emit({ kind: "replay.segment.started", segmentId: segment.id });
        try {
            await this.ensure(segment, "precondition", segment.precondition, idempotency);
            await this.emit({
                kind: "replay.deterministic.started",
                segmentId: segment.id,
                phase: "deterministic",
            });
            let deterministicFailure;
            try {
                await segment.deterministic();
                await this.emit({
                    kind: "replay.deterministic.completed",
                    segmentId: segment.id,
                    phase: "deterministic",
                });
            }
            catch (error) {
                deterministicFailure = serializeError(error);
                await this.emit({
                    kind: "replay.deterministic.failed",
                    segmentId: segment.id,
                    phase: "deterministic",
                    error: deterministicFailure,
                });
            }
            await this.ensure(segment, "postcondition", segment.postcondition, idempotency, deterministicFailure
                ? [{
                        path: "deterministic",
                        actual: deterministicFailure,
                        message: `Deterministic action failed: ${deterministicFailure.message}`,
                    }]
                : []);
            await this.emit({ kind: "replay.segment.completed", segmentId: segment.id });
        }
        catch (error) {
            await this.emit({
                kind: "replay.segment.failed",
                segmentId: segment.id,
                error: serializeError(error),
            });
            throw error;
        }
    }
    async ensure(segment, phase, spec, idempotency, additionalDifferences = []) {
        let result = await this.settleCheckpoint(segment.id, phase, spec);
        if (result.status === "matched")
            return;
        if (additionalDifferences.length) {
            result = { ...result, differences: [...additionalDifferences, ...result.differences] };
        }
        if (this.policy === "disabled" || !segment.fallback) {
            throw new CheckpointMismatchError(segment.id, phase, spec.id, result);
        }
        const maxAttempts = segment.fallback.maxAttempts ?? 1;
        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
            const observationOnly = phase === "postcondition" && idempotency === "never-retry";
            const request = {
                segmentId: segment.id,
                phase,
                goal: segment.fallback.goal,
                expected: spec,
                actual: result.actual,
                differences: result.differences,
                idempotency,
                attempt,
                constraints: {
                    maxActions: segment.fallback.maxActions,
                    timeoutMs: segment.fallback.timeoutMs,
                    allowedApps: segment.fallback.allowedApps,
                    forbiddenActions: segment.fallback.forbiddenActions,
                    observationOnly,
                },
            };
            await this.emit({ kind: "replay.fallback.started", segmentId: segment.id, phase, attempt });
            const fallbackStarted = process.hrtime.bigint();
            const fallbackResult = await this.options.fallback.recover(request);
            const fallbackDurationMs = Number(process.hrtime.bigint() - fallbackStarted) / 1_000_000;
            this.fallbackCount += 1;
            this.fallbackDurationMs += fallbackDurationMs;
            await this.emit({
                kind: "replay.fallback.completed",
                segmentId: segment.id,
                phase,
                attempt,
                fallbackResult,
                durationMs: fallbackDurationMs,
            });
            if (fallbackResult.status !== "completed")
                break;
            result = await this.settleCheckpoint(segment.id, phase, spec);
            if (result.status === "matched")
                return;
        }
        throw new FallbackFailedError(segment.id, phase, spec.id, result);
    }
    async settleCheckpoint(segmentId, phase, spec) {
        if (!spec.settle)
            return this.checkpoint(segmentId, phase, spec);
        const timeoutMs = positiveNumber(spec.settle.timeoutMs, "checkpoint settle timeoutMs");
        const intervalMs = positiveNumber(spec.settle.intervalMs ?? 100, "checkpoint settle intervalMs");
        const consecutiveMatches = positiveInteger(spec.settle.consecutiveMatches ?? 1, "checkpoint settle consecutiveMatches");
        const now = this.options.now ?? Date.now;
        const delay = this.options.delay ?? ((durationMs) => new Promise((resolve) => setTimeout(resolve, durationMs)));
        const started = now();
        const deadline = started + timeoutMs;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(new Error("checkpoint settle deadline exceeded")), timeoutMs);
        let result;
        let checkCount = 1;
        let matchCount = 0;
        let settleDelayMs = 0;
        try {
            await this.emit({
                kind: "replay.checkpoint.settle.started",
                segmentId,
                phase,
                checkpointId: spec.id,
                checkCount,
            });
            result = await this.checkpoint(segmentId, phase, spec, {
                deadlineMs: deadline,
                signal: controller.signal,
            });
            matchCount = result.status === "matched" && now() <= deadline ? 1 : 0;
            if (matchCount >= consecutiveMatches) {
                return await this.completeSettle(segmentId, phase, spec.id, result, checkCount, started, now(), settleDelayMs);
            }
            while (now() < deadline && !controller.signal.aborted) {
                const requestedDelayMs = Math.min(intervalMs, Math.max(0, deadline - now()));
                const delayStarted = now();
                await delay(requestedDelayMs);
                const capturedDelayMs = Math.max(0, now() - delayStarted);
                this.checkpointSettleDelayMs += capturedDelayMs;
                this.checkpointWaitDurationMs += capturedDelayMs;
                settleDelayMs += capturedDelayMs;
                if (now() >= deadline || controller.signal.aborted)
                    break;
                this.checkpointPollCount += 1;
                checkCount += 1;
                result = await this.checkpoint(segmentId, phase, spec, {
                    deadlineMs: deadline,
                    signal: controller.signal,
                });
                matchCount = result.status === "matched" && now() <= deadline ? matchCount + 1 : 0;
                if (matchCount >= consecutiveMatches) {
                    return await this.completeSettle(segmentId, phase, spec.id, result, checkCount, started, now(), settleDelayMs);
                }
            }
            const durationMs = Math.max(0, now() - started);
            this.checkpointTimeoutCount += 1;
            await this.emit({
                kind: "replay.checkpoint.settle.timed-out",
                segmentId,
                phase,
                checkpointId: spec.id,
                checkpoint: result,
                checkCount,
                durationMs,
                settleDelayMs,
            });
            return result;
        }
        finally {
            clearTimeout(timeout);
        }
    }
    async completeSettle(segmentId, phase, checkpointId, result, checkCount, started, completed, settleDelayMs) {
        const durationMs = Math.max(0, completed - started);
        await this.emit({
            kind: "replay.checkpoint.settle.completed",
            segmentId,
            phase,
            checkpointId,
            checkpoint: result,
            checkCount,
            durationMs,
            settleDelayMs,
        });
        return result;
    }
    async emit(event) {
        await this.options.emit?.({ ...event, monotonicNs: process.hrtime.bigint().toString() });
    }
}
function positiveNumber(value, name) {
    if (!Number.isFinite(value) || value <= 0)
        throw new Error(`${name} must be positive`);
    return value;
}
function positiveInteger(value, name) {
    if (!Number.isInteger(value) || value <= 0)
        throw new Error(`${name} must be a positive integer`);
    return value;
}
function serializeError(error) {
    return error instanceof Error
        ? { name: error.name, message: error.message }
        : { name: "Error", message: String(error) };
}
//# sourceMappingURL=flow.js.map