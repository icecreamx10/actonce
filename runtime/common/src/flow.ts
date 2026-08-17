import { CheckpointMismatchError, FallbackFailedError } from "./errors.js";
import type {
  CheckpointResult,
  CheckpointSpec,
  FallbackRequest,
  ReplayEvent,
  ReplayDiagnostics,
  ReplayFlowOptions,
  ReplaySegment,
  SegmentIdempotency,
} from "./types.js";

export class ReplayFlow<TExpectation, TActual> {
  private readonly policy;
  private fallbackCount = 0;
  private fallbackDurationMs = 0;
  private deterministicRetryCount = 0;
  private deterministicRetryDurationMs = 0;
  private checkpointPollCount = 0;
  private checkpointCaptureDurationMs = 0;
  private checkpointSettleDelayMs = 0;
  private checkpointWaitDurationMs = 0;
  private checkpointTimeoutCount = 0;

  constructor(private readonly options: ReplayFlowOptions<TExpectation, TActual>) {
    this.policy = options.policy ?? "disabled";
    if (this.policy === "recover" && !options.fallback) {
      throw new Error("fallback driver is required when replay policy is recover");
    }
  }

  diagnostics(): ReplayDiagnostics {
    return {
      strategy: this.policy === "recover" ? "hybrid" : "deterministic",
      deterministicRetryCount: this.deterministicRetryCount,
      deterministicRetryDurationMs: this.deterministicRetryDurationMs,
      fallbackCount: this.fallbackCount,
      fallbackDurationMs: this.fallbackDurationMs,
      checkpointPollCount: this.checkpointPollCount,
      checkpointCaptureDurationMs: this.checkpointCaptureDurationMs,
      checkpointSettleDelayMs: this.checkpointSettleDelayMs,
      checkpointWaitDurationMs: this.checkpointWaitDurationMs,
      checkpointTimeoutCount: this.checkpointTimeoutCount,
    };
  }

  async checkpoint(
    segmentId: string,
    phase: "precondition" | "postcondition",
    spec: CheckpointSpec<TExpectation>,
    context?: { deadlineMs: number; signal: AbortSignal },
  ): Promise<CheckpointResult<TActual>> {
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

  async segment(segment: ReplaySegment<TExpectation>): Promise<void> {
    const idempotency = segment.idempotency ?? "safe";
    await this.emit({ kind: "replay.segment.started", segmentId: segment.id });
    try {
      await this.ensure(segment, "precondition", segment.precondition, idempotency);
      await this.emit({
        kind: "replay.deterministic.started",
        segmentId: segment.id,
        phase: "deterministic",
      });
      let deterministicFailure: { name: string; message: string } | undefined;
      try {
        await segment.deterministic();
        await this.emit({
          kind: "replay.deterministic.completed",
          segmentId: segment.id,
          phase: "deterministic",
        });
      } catch (error) {
        deterministicFailure = serializeError(error);
        await this.emit({
          kind: "replay.deterministic.failed",
          segmentId: segment.id,
          phase: "deterministic",
          error: deterministicFailure,
        });
      }
      await this.ensure(
        segment,
        "postcondition",
        segment.postcondition,
        idempotency,
        deterministicFailure
          ? [{
              path: "deterministic",
              actual: deterministicFailure,
              message: `Deterministic action failed: ${deterministicFailure.message}`,
            }]
          : [],
      );
      await this.emit({ kind: "replay.segment.completed", segmentId: segment.id });
    } catch (error) {
      await this.emit({
        kind: "replay.segment.failed",
        segmentId: segment.id,
        error: serializeError(error),
      });
      throw error;
    }
  }

  private async ensure(
    segment: ReplaySegment<TExpectation>,
    phase: "precondition" | "postcondition",
    spec: CheckpointSpec<TExpectation>,
    idempotency: SegmentIdempotency,
    additionalDifferences: CheckpointResult<TActual>["differences"] = [],
  ): Promise<void> {
    let result = await this.settleCheckpoint(segment.id, phase, spec);
    if (result.status === "matched") return;
    if (additionalDifferences.length) {
      result = { ...result, differences: [...additionalDifferences, ...result.differences] };
    }
    if (phase === "postcondition"
      && idempotency === "observe-before-retry"
      && segment.deterministicRetry) {
      const maxAttempts = positiveInteger(
        segment.deterministicRetry.maxAttempts ?? 1,
        "deterministicRetry maxAttempts",
      );
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        await this.emit({
          kind: "replay.deterministic.retry.started",
          segmentId: segment.id,
          phase: "deterministic",
          attempt,
        });
        const retryStarted = process.hrtime.bigint();
        try {
          await segment.deterministicRetry.action();
          const durationMs = Number(process.hrtime.bigint() - retryStarted) / 1_000_000;
          this.deterministicRetryCount += 1;
          this.deterministicRetryDurationMs += durationMs;
          await this.emit({
            kind: "replay.deterministic.retry.completed",
            segmentId: segment.id,
            phase: "deterministic",
            attempt,
            durationMs,
          });
        } catch (error) {
          const durationMs = Number(process.hrtime.bigint() - retryStarted) / 1_000_000;
          this.deterministicRetryCount += 1;
          this.deterministicRetryDurationMs += durationMs;
          const retryFailure = serializeError(error);
          result = {
            ...result,
            differences: [{
              path: "deterministicRetry",
              actual: retryFailure,
              message: `Deterministic retry failed: ${retryFailure.message}`,
            }, ...result.differences],
          };
          await this.emit({
            kind: "replay.deterministic.retry.failed",
            segmentId: segment.id,
            phase: "deterministic",
            attempt,
            durationMs,
            error: retryFailure,
          });
          break;
        }
        result = await this.settleCheckpoint(segment.id, phase, spec);
        if (result.status === "matched") return;
      }
    }
    if (this.policy === "disabled" || !segment.fallback) {
      throw new CheckpointMismatchError(segment.id, phase, spec.id, result);
    }

    const maxAttempts = segment.fallback.maxAttempts ?? 1;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const observationOnly = phase === "postcondition" && idempotency === "never-retry";
      const request: FallbackRequest<TExpectation, TActual> = {
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
      const fallbackResult = await this.options.fallback!.recover(request);
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
      if (fallbackResult.status !== "completed") break;
      result = await this.settleCheckpoint(segment.id, phase, spec);
      if (result.status === "matched") return;
    }
    throw new FallbackFailedError(segment.id, phase, spec.id, result);
  }

  private async settleCheckpoint(
    segmentId: string,
    phase: "precondition" | "postcondition",
    spec: CheckpointSpec<TExpectation>,
  ): Promise<CheckpointResult<TActual>> {
    if (!spec.settle) return this.checkpoint(segmentId, phase, spec);

    const timeoutMs = positiveNumber(spec.settle.timeoutMs, "checkpoint settle timeoutMs");
    const intervalMs = positiveNumber(spec.settle.intervalMs ?? 100, "checkpoint settle intervalMs");
    const consecutiveMatches = positiveInteger(
      spec.settle.consecutiveMatches ?? 1,
      "checkpoint settle consecutiveMatches",
    );
    const now = this.options.now ?? Date.now;
    const delay = this.options.delay ?? ((durationMs: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, durationMs)));
    const started = now();
    const deadline = started + timeoutMs;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error("checkpoint settle deadline exceeded")), timeoutMs);
    let result: CheckpointResult<TActual>;
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
        if (now() >= deadline || controller.signal.aborted) break;
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
    } finally {
      clearTimeout(timeout);
    }
  }

  private async completeSettle(
    segmentId: string,
    phase: "precondition" | "postcondition",
    checkpointId: string,
    result: CheckpointResult<TActual>,
    checkCount: number,
    started: number,
    completed: number,
    settleDelayMs: number,
  ): Promise<CheckpointResult<TActual>> {
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

  private async emit(event: Omit<ReplayEvent<TActual>, "monotonicNs">): Promise<void> {
    await this.options.emit?.({ ...event, monotonicNs: process.hrtime.bigint().toString() });
  }
}

function positiveNumber(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be positive`);
  return value;
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

function serializeError(error: unknown): { name: string; message: string } {
  return error instanceof Error
    ? { name: error.name, message: error.message }
    : { name: "Error", message: String(error) };
}
