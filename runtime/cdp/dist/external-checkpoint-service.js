import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { canonicalTreeHash, ReplayFlow, } from "@byted-lynx/actonce-replay";
import { normalizeCdpNode } from "./index.js";
/**
 * Bidirectional JSONL sidecar for products that already own a CDP connection.
 * The product only supplies raw DOM snapshots; ActOnce owns settling, stale
 * session rejection, canonicalization, deadlines, and metrics.
 */
export class ExternalCdpCheckpointService {
    output;
    pendingCaptures = new Map();
    activeRequests = new Set();
    constructor(output) {
        this.output = output;
    }
    async serve(input) {
        const lines = createInterface({ input, crlfDelay: Infinity });
        for await (const line of lines) {
            if (!line.trim())
                continue;
            let message;
            try {
                message = JSON.parse(line);
            }
            catch (error) {
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
            this.write({ id: message.id, error: { code: "UNKNOWN_METHOD", message: "Unknown checkpoint service method" } });
        }
        const closed = new Error("checkpoint service input closed");
        for (const pending of this.pendingCaptures.values())
            pending.reject(closed);
        this.pendingCaptures.clear();
    }
    async waitForStableTree(request, recordAnchor) {
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
            const capture = (context) => this.capture(request.id, context);
            const driver = recordAnchor
                ? new ExternalAcceptedTreeDriver(capture)
                : new ExternalStableTreeDriver(capture);
            const flow = new ReplayFlow({ checkpoints: driver });
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
            if (recordAnchor && !canonicalHash)
                throw new Error("stable CDP checkpoint did not produce a canonical hash");
            this.write({
                id: request.id,
                result: {
                    checkpoint,
                    diagnostics,
                    ...(recordAnchor ? {
                        anchor: {
                            version: 1,
                            source: "cdp-dom",
                            canonicalHash: canonicalHash,
                        },
                    } : {}),
                },
            });
        }
        catch (error) {
            this.write({ id: request.id, error: { code: "CHECKPOINT_FAILED", message: errorMessage(error) } });
        }
        finally {
            this.activeRequests.delete(request.id);
        }
    }
    async waitForAnchor(request) {
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
            const flow = new ReplayFlow({ checkpoints: driver });
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
        }
        catch (error) {
            this.write({ id: request.id, error: { code: "CHECKPOINT_FAILED", message: errorMessage(error) } });
        }
        finally {
            this.activeRequests.delete(request.id);
        }
    }
    async waitForReady(request) {
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
            const flow = new ReplayFlow({ checkpoints: driver });
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
        }
        catch (error) {
            this.write({ id: request.id, error: { code: "CHECKPOINT_FAILED", message: errorMessage(error) } });
        }
        finally {
            this.activeRequests.delete(request.id);
        }
    }
    capture(requestId, context) {
        const captureId = randomUUID();
        return new Promise((resolveCapture, rejectCapture) => {
            const pending = { resolve: resolveCapture, reject: rejectCapture };
            this.pendingCaptures.set(captureId, pending);
            const remaining = context ? Math.max(1, context.deadlineMs - Date.now()) : 5_000;
            const timeout = setTimeout(() => {
                if (!this.pendingCaptures.delete(captureId))
                    return;
                rejectCapture(new Error("external CDP capture timed out"));
            }, remaining);
            const abort = () => {
                if (!this.pendingCaptures.delete(captureId))
                    return;
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
    resolveCapture(message) {
        const captureId = message.params?.captureId;
        if (!captureId)
            return;
        const pending = this.pendingCaptures.get(captureId);
        if (!pending)
            return;
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
    write(value) {
        this.output.write(`${JSON.stringify(value)}\n`);
    }
}
class ExternalStableTreeDriver {
    capture;
    previousHash;
    previousSessionId;
    captureCount = 0;
    constructor(capture) {
        this.capture = capture;
    }
    async verify(spec, context) {
        const started = performance.now();
        this.captureCount += 1;
        try {
            const snapshot = await this.capture(context);
            const root = normalizeCdpNode(snapshot.root);
            const canonicalHash = canonicalTreeHash(root);
            const actual = {
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
        }
        catch (error) {
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
class ExternalAcceptedTreeDriver {
    capture;
    captureCount = 0;
    constructor(capture) {
        this.capture = capture;
    }
    async verify(spec, context) {
        const started = performance.now();
        this.captureCount += 1;
        try {
            const snapshot = await this.capture(context);
            const root = normalizeCdpNode(snapshot.root);
            const canonicalHash = canonicalTreeHash(root);
            const actual = {
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
        }
        catch (error) {
            return {
                status: "unknown",
                actual: { captureCount: this.captureCount, captureDurationMs: performance.now() - started },
                differences: [{ path: "tree.capture", actual: errorMessage(error), message: "External CDP capture failed" }],
            };
        }
    }
}
class ExternalAnchorDriver {
    capture;
    captureCount = 0;
    constructor(capture) {
        this.capture = capture;
    }
    async verify(spec, context) {
        const started = performance.now();
        this.captureCount += 1;
        try {
            const snapshot = await this.capture(context);
            const root = normalizeCdpNode(snapshot.root);
            const canonicalHash = canonicalTreeHash(root);
            const actual = {
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
        }
        catch (error) {
            return {
                status: "unknown",
                actual: { captureCount: this.captureCount, captureDurationMs: performance.now() - started },
                differences: [{ path: "tree.capture", actual: errorMessage(error), message: "External CDP capture failed" }],
            };
        }
    }
}
export function serveExternalCdpCheckpoints(input, output) {
    return new ExternalCdpCheckpointService(output).serve(input);
}
function positive(value, name) {
    if (!Number.isFinite(value) || value <= 0)
        throw new TypeError(`${name} must be positive`);
    return value;
}
function positiveInteger(value, name) {
    if (!Number.isInteger(value) || value <= 0)
        throw new TypeError(`${name} must be a positive integer`);
    return value;
}
function validAnchor(value) {
    if (value?.version !== 1 || value.source !== "cdp-dom" || !value.canonicalHash) {
        throw new TypeError("waitForCdpAnchor requires a valid CDP anchor");
    }
    return value;
}
function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
//# sourceMappingURL=external-checkpoint-service.js.map