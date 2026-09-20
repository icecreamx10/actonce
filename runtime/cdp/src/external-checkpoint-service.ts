import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import {
  canonicalTreeHash,
  ReplayFlow,
  type CheckpointDriver,
  type CheckpointResult,
  type CheckpointSpec,
  type CheckpointVerificationContext,
  type SemanticNode,
} from "@byted-lynx/actonce-replay";
import { normalizeCdpNode } from "./index.js";

export type StableTreeAnchor = {
  version: 1;
  source: "cdp-dom";
  canonicalHash: string;
};

type StableTreeParams = {
  timeoutMs?: number;
  intervalMs?: number;
  rejectSessionIds?: Array<string | number>;
};

type WaitRequest = {
  id: string;
  method: "waitForStableCdpTree";
  params?: StableTreeParams & {
    stableCaptures?: number;
  };
};

type RecordAnchorRequest = {
  id: string;
  method: "recordStableCdpAnchor";
  params?: StableTreeParams & {
    stableCaptures?: number;
  };
};

type WaitForAnchorRequest = {
  id: string;
  method: "waitForCdpAnchor";
  params?: StableTreeParams & {
    anchor?: StableTreeAnchor;
    consecutiveMatches?: number;
  };
};

type WaitForReadyRequest = {
  id: string;
  method: "waitForCdpReady";
  params?: StableTreeParams;
};

type PingRequest = {
  id: string;
  method: "ping";
};

type CaptureResponse = {
  method: "capture.result";
  params?: {
    captureId?: string;
    snapshot?: { sessionId?: string | number; root?: Record<string, unknown> };
    error?: string;
  };
};

type InputMessage = PingRequest | WaitRequest | RecordAnchorRequest | WaitForAnchorRequest | WaitForReadyRequest | CaptureResponse;

type StableTreeActual = {
  sessionId?: string;
  canonicalHash?: string;
  root?: SemanticNode;
  captureCount: number;
  captureDurationMs: number;
};

type StableTreeExpectation = { rejectSessionIds: string[] };
type AnchorExpectation = StableTreeExpectation & { anchor: StableTreeAnchor };

type PendingCapture = {
  resolve: (snapshot: { sessionId: string; root: Record<string, unknown> }) => void;
  reject: (error: Error) => void;
};

/**
 * Bidirectional JSONL sidecar for products that already own a CDP connection.
 * The product only supplies raw DOM snapshots; ActOnce owns settling, stale
 * session rejection, canonicalization, deadlines, and metrics.
 */
export class ExternalCdpCheckpointService {
  private readonly pendingCaptures = new Map<string, PendingCapture>();
  private readonly activeRequests = new Set<string>();

  constructor(private readonly output: Writable) {}

  async serve(input: Readable): Promise<void> {
    const lines = createInterface({ input, crlfDelay: Infinity });
    for await (const line of lines) {
      if (!line.trim()) continue;
      let message: InputMessage;
      try {
        message = JSON.parse(line) as InputMessage;
      } catch (error) {
        this.write({ error: { code: "INVALID_JSON", message: errorMessage(error) } });
        continue;
      }
      if (message.method === "capture.result") {
        this.resolveCapture(message);
        continue;
      }
      if (message.method === "ping") {
        this.write({ id: message.id, result: { ready: true, protocolVersion: 1 } });
        continue;
      }
      if (message.method === "waitForStableCdpTree") {
        void this.waitForStableTree(message, false);
        continue;
      }
      if (message.method === "recordStableCdpAnchor") {
        void this.waitForStableTree(message, true);
        continue;
      }
      if (message.method === "waitForCdpAnchor") {
        void this.waitForAnchor(message);
        continue;
      }
      if (message.method === "waitForCdpReady") {
        void this.waitForReady(message);
        continue;
      }
      this.write({ id: (message as { id?: string }).id, error: { code: "UNKNOWN_METHOD", message: "Unknown checkpoint service method" } });
    }
    const closed = new Error("checkpoint service input closed");
    for (const pending of this.pendingCaptures.values()) pending.reject(closed);
    this.pendingCaptures.clear();
  }

  private async waitForStableTree(
    request: WaitRequest | RecordAnchorRequest,
    recordAnchor: boolean,
  ): Promise<void> {
    if (!request.id || this.activeRequests.has(request.id)) {
      this.write({ id: request.id, error: { code: "INVALID_REQUEST", message: "request id must be unique and non-empty" } });
      return;
    }
    this.activeRequests.add(request.id);
    try {
      const timeoutMs = positive(request.params?.timeoutMs ?? 5_000, "timeoutMs");
      const intervalMs = positive(request.params?.intervalMs ?? 50, "intervalMs");
      const stableCaptures = positiveInteger(request.params?.stableCaptures ?? 2, "stableCaptures");
      const rejectSessionIds = (request.params?.rejectSessionIds ?? []).map(String);
      const capture = (context?: CheckpointVerificationContext) => this.capture(request.id, context);
      const driver = recordAnchor
        ? new ExternalAcceptedTreeDriver(capture)
        : new ExternalStableTreeDriver(capture);
      const flow = new ReplayFlow<StableTreeExpectation, StableTreeActual>({ checkpoints: driver });
      const checkpoint = await flow.waitForCheckpoint("external-cdp", "postcondition", {
        id: "stable-cdp-tree",
        expected: { rejectSessionIds },
        settle: {
          timeoutMs,
          intervalMs,
          // Recording happens after the original sleep, so one accepted
          // snapshot is the observation. Stability polling belongs to replay.
          consecutiveMatches: recordAnchor ? 1 : Math.max(1, stableCaptures - 1),
        },
      });
      const diagnostics = flow.diagnostics();
      if (checkpoint.status !== "matched") {
        this.write({
          id: request.id,
          error: {
            code: "CHECKPOINT_TIMEOUT",
            message: `CDP tree did not reach a stable accepted state within ${timeoutMs}ms`,
            details: { checkpoint, diagnostics },
          },
        });
        return;
      }
      const canonicalHash = checkpoint.actual.canonicalHash;
      if (recordAnchor && !canonicalHash) throw new Error("stable CDP checkpoint did not produce a canonical hash");
      this.write({
        id: request.id,
        result: {
          checkpoint,
          diagnostics,
          ...(recordAnchor ? {
            anchor: {
              version: 1,
              source: "cdp-dom",
              canonicalHash: canonicalHash!,
            } satisfies StableTreeAnchor,
          } : {}),
        },
      });
    } catch (error) {
      this.write({ id: request.id, error: { code: "CHECKPOINT_FAILED", message: errorMessage(error) } });
    } finally {
      this.activeRequests.delete(request.id);
    }
  }

  private async waitForAnchor(request: WaitForAnchorRequest): Promise<void> {
    if (!request.id || this.activeRequests.has(request.id)) {
      this.write({ id: request.id, error: { code: "INVALID_REQUEST", message: "request id must be unique and non-empty" } });
      return;
    }
    this.activeRequests.add(request.id);
    try {
      const timeoutMs = positive(request.params?.timeoutMs ?? 5_000, "timeoutMs");
      const intervalMs = positive(request.params?.intervalMs ?? 50, "intervalMs");
      const consecutiveMatches = positiveInteger(request.params?.consecutiveMatches ?? 2, "consecutiveMatches");
      const rejectSessionIds = (request.params?.rejectSessionIds ?? []).map(String);
      const anchor = validAnchor(request.params?.anchor);
      const driver = new ExternalAnchorDriver((context) => this.capture(request.id, context));
      const flow = new ReplayFlow<AnchorExpectation, StableTreeActual>({ checkpoints: driver });
      const checkpoint = await flow.waitForCheckpoint("external-cdp", "postcondition", {
        id: "recorded-cdp-anchor",
        expected: { anchor, rejectSessionIds },
        settle: { timeoutMs, intervalMs, consecutiveMatches },
      });
      const diagnostics = flow.diagnostics();
      if (checkpoint.status !== "matched") {
        this.write({
          id: request.id,
          error: {
            code: "CHECKPOINT_TIMEOUT",
            message: `Recorded CDP anchor was not reached within ${timeoutMs}ms`,
            details: { checkpoint, diagnostics },
          },
        });
        return;
      }
      this.write({ id: request.id, result: { checkpoint, diagnostics, anchor } });
    } catch (error) {
      this.write({ id: request.id, error: { code: "CHECKPOINT_FAILED", message: errorMessage(error) } });
    } finally {
      this.activeRequests.delete(request.id);
    }
  }

  private async waitForReady(request: WaitForReadyRequest): Promise<void> {
    if (!request.id || this.activeRequests.has(request.id)) {
      this.write({ id: request.id, error: { code: "INVALID_REQUEST", message: "request id must be unique and non-empty" } });
      return;
    }
    this.activeRequests.add(request.id);
    try {
      const timeoutMs = positive(request.params?.timeoutMs ?? 5_000, "timeoutMs");
      const intervalMs = positive(request.params?.intervalMs ?? 50, "intervalMs");
      const rejectSessionIds = (request.params?.rejectSessionIds ?? []).map(String);
      const driver = new ExternalAcceptedTreeDriver((context) => this.capture(request.id, context));
      const flow = new ReplayFlow<StableTreeExpectation, StableTreeActual>({ checkpoints: driver });
      const checkpoint = await flow.waitForCheckpoint("external-cdp", "precondition", {
        id: "cdp-ready",
        expected: { rejectSessionIds },
        settle: { timeoutMs, intervalMs, consecutiveMatches: 1 },
      });
      const diagnostics = flow.diagnostics();
      if (checkpoint.status !== "matched") {
        this.write({
          id: request.id,
          error: {
            code: "CHECKPOINT_TIMEOUT",
            message: `CDP did not become ready within ${timeoutMs}ms`,
            details: { checkpoint, diagnostics },
          },
        });
        return;
      }
      this.write({ id: request.id, result: { checkpoint, diagnostics } });
    } catch (error) {
      this.write({ id: request.id, error: { code: "CHECKPOINT_FAILED", message: errorMessage(error) } });
    } finally {
      this.activeRequests.delete(request.id);
    }
  }

  private capture(requestId: string, context?: CheckpointVerificationContext): Promise<{ sessionId: string; root: Record<string, unknown> }> {
    const captureId = randomUUID();
    return new Promise((resolveCapture, rejectCapture) => {
      const pending: PendingCapture = { resolve: resolveCapture, reject: rejectCapture };
      this.pendingCaptures.set(captureId, pending);
      const remaining = context ? Math.max(1, context.deadlineMs - Date.now()) : 5_000;
      const timeout = setTimeout(() => {
        if (!this.pendingCaptures.delete(captureId)) return;
        rejectCapture(new Error("external CDP capture timed out"));
      }, remaining);
      const abort = () => {
        if (!this.pendingCaptures.delete(captureId)) return;
        clearTimeout(timeout);
        rejectCapture(new Error("external CDP capture deadline exceeded"));
      };
      context?.signal.addEventListener("abort", abort, { once: true });
      this.pendingCaptures.set(captureId, {
        resolve: (snapshot) => {
          clearTimeout(timeout);
          context?.signal.removeEventListener("abort", abort);
          resolveCapture(snapshot);
        },
        reject: (error) => {
          clearTimeout(timeout);
          context?.signal.removeEventListener("abort", abort);
          rejectCapture(error);
        },
      });
      this.write({ id: requestId, event: "capture", captureId });
    });
  }

  private resolveCapture(message: CaptureResponse): void {
    const captureId = message.params?.captureId;
    if (!captureId) return;
    const pending = this.pendingCaptures.get(captureId);
    if (!pending) return;
    this.pendingCaptures.delete(captureId);
    if (message.params?.error) {
      pending.reject(new Error(message.params.error));
      return;
    }
    const sessionId = message.params?.snapshot?.sessionId;
    const root = message.params?.snapshot?.root;
    if (sessionId === undefined || !root) {
      pending.reject(new Error("capture.result requires snapshot.sessionId and snapshot.root"));
      return;
    }
    pending.resolve({ sessionId: String(sessionId), root });
  }

  private write(value: unknown): void {
    this.output.write(`${JSON.stringify(value)}\n`);
  }
}

class ExternalStableTreeDriver implements CheckpointDriver<StableTreeExpectation, StableTreeActual> {
  private previousHash?: string;
  private previousSessionId?: string;
  private captureCount = 0;

  constructor(private readonly capture: (context?: CheckpointVerificationContext) => Promise<{ sessionId: string; root: Record<string, unknown> }>) {}

  async verify(
    spec: CheckpointSpec<StableTreeExpectation>,
    context?: CheckpointVerificationContext,
  ): Promise<CheckpointResult<StableTreeActual>> {
    const started = performance.now();
    this.captureCount += 1;
    try {
      const snapshot = await this.capture(context);
      const root = normalizeCdpNode(snapshot.root);
      const canonicalHash = canonicalTreeHash(root);
      const actual: StableTreeActual = {
        sessionId: snapshot.sessionId,
        canonicalHash,
        root,
        captureCount: this.captureCount,
        captureDurationMs: performance.now() - started,
      };
      if (spec.expected.rejectSessionIds.includes(snapshot.sessionId)) {
        this.previousHash = undefined;
        this.previousSessionId = undefined;
        return {
          status: "mismatched",
          actual,
          differences: [{
            path: "tree.sessionId",
            expected: { notIn: spec.expected.rejectSessionIds },
            actual: snapshot.sessionId,
            message: "CDP snapshot belongs to a stale session",
          }],
        };
      }
      const stable = this.previousSessionId === snapshot.sessionId && this.previousHash === canonicalHash;
      this.previousSessionId = snapshot.sessionId;
      this.previousHash = canonicalHash;
      return stable
        ? { status: "matched", actual, differences: [] }
        : {
            status: "mismatched",
            actual,
            differences: [{
              path: "tree.canonicalHash",
              expected: "same as previous accepted capture",
              actual: canonicalHash,
              message: "Waiting for the accepted CDP tree to become stable",
            }],
          };
    } catch (error) {
      this.previousHash = undefined;
      this.previousSessionId = undefined;
      return {
        status: "unknown",
        actual: { captureCount: this.captureCount, captureDurationMs: performance.now() - started },
        differences: [{ path: "tree.capture", actual: errorMessage(error), message: "External CDP capture failed" }],
      };
    }
  }
}

class ExternalAcceptedTreeDriver implements CheckpointDriver<StableTreeExpectation, StableTreeActual> {
  private captureCount = 0;

  constructor(private readonly capture: (context?: CheckpointVerificationContext) => Promise<{ sessionId: string; root: Record<string, unknown> }>) {}

  async verify(
    spec: CheckpointSpec<StableTreeExpectation>,
    context?: CheckpointVerificationContext,
  ): Promise<CheckpointResult<StableTreeActual>> {
    const started = performance.now();
    this.captureCount += 1;
    try {
      const snapshot = await this.capture(context);
      const root = normalizeCdpNode(snapshot.root);
      const canonicalHash = canonicalTreeHash(root);
      const actual: StableTreeActual = {
        sessionId: snapshot.sessionId,
        canonicalHash,
        root,
        captureCount: this.captureCount,
        captureDurationMs: performance.now() - started,
      };
      return spec.expected.rejectSessionIds.includes(snapshot.sessionId)
        ? {
            status: "mismatched",
            actual,
            differences: [{
              path: "tree.sessionId",
              expected: { notIn: spec.expected.rejectSessionIds },
              actual: snapshot.sessionId,
              message: "CDP snapshot belongs to a stale session",
            }],
          }
        : { status: "matched", actual, differences: [] };
    } catch (error) {
      return {
        status: "unknown",
        actual: { captureCount: this.captureCount, captureDurationMs: performance.now() - started },
        differences: [{ path: "tree.capture", actual: errorMessage(error), message: "External CDP capture failed" }],
      };
    }
  }
}

class ExternalAnchorDriver implements CheckpointDriver<AnchorExpectation, StableTreeActual> {
  private captureCount = 0;

  constructor(private readonly capture: (context?: CheckpointVerificationContext) => Promise<{ sessionId: string; root: Record<string, unknown> }>) {}

  async verify(
    spec: CheckpointSpec<AnchorExpectation>,
    context?: CheckpointVerificationContext,
  ): Promise<CheckpointResult<StableTreeActual>> {
    const started = performance.now();
    this.captureCount += 1;
    try {
      const snapshot = await this.capture(context);
      const root = normalizeCdpNode(snapshot.root);
      const canonicalHash = canonicalTreeHash(root);
      const actual: StableTreeActual = {
        sessionId: snapshot.sessionId,
        canonicalHash,
        root,
        captureCount: this.captureCount,
        captureDurationMs: performance.now() - started,
      };
      if (spec.expected.rejectSessionIds.includes(snapshot.sessionId)) {
        return {
          status: "mismatched",
          actual,
          differences: [{
            path: "tree.sessionId",
            expected: { notIn: spec.expected.rejectSessionIds },
            actual: snapshot.sessionId,
            message: "CDP snapshot belongs to a stale session",
          }],
        };
      }
      return canonicalHash === spec.expected.anchor.canonicalHash
        ? { status: "matched", actual, differences: [] }
        : {
            status: "mismatched",
            actual,
            differences: [{
              path: "tree.canonicalHash",
              expected: spec.expected.anchor.canonicalHash,
              actual: canonicalHash,
              message: "Recorded CDP anchor has not been reached",
            }],
          };
    } catch (error) {
      return {
        status: "unknown",
        actual: { captureCount: this.captureCount, captureDurationMs: performance.now() - started },
        differences: [{ path: "tree.capture", actual: errorMessage(error), message: "External CDP capture failed" }],
      };
    }
  }
}

export function serveExternalCdpCheckpoints(input: Readable, output: Writable): Promise<void> {
  return new ExternalCdpCheckpointService(output).serve(input);
}

function positive(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new TypeError(`${name} must be positive`);
  return value;
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0) throw new TypeError(`${name} must be a positive integer`);
  return value;
}

function validAnchor(value: StableTreeAnchor | undefined): StableTreeAnchor {
  if (value?.version !== 1 || value.source !== "cdp-dom" || !value.canonicalHash) {
    throw new TypeError("waitForCdpAnchor requires a valid CDP anchor");
  }
  return value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
