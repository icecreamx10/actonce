import { createHash } from "node:crypto";
import { ReplayFlow } from "./flow.js";
import { ObservationCheckpointDriver } from "./observation-checkpoint.js";
export async function waitForTreeThenVisual(options) {
    const now = options.now ?? (() => performance.now());
    const delay = options.delay ?? ((durationMs) => new Promise((resolve) => setTimeout(resolve, durationMs)));
    const started = now();
    const timeoutMs = positive(options.timeoutMs, "timeoutMs");
    const intervalMs = options.intervalMs ?? 30;
    const requiredMatches = options.consecutiveTreeMatches ?? 2;
    positive(requiredMatches, "consecutiveTreeMatches");
    const aggregate = {
        treeCaptureDurationMs: 0,
        treeCompareDurationMs: 0,
        screenshotCaptureDurationMs: 0,
        visualCompareDurationMs: 0,
        treeCaptureCount: 0,
        screenshotCaptureCount: 0,
    };
    const driver = new ObservationCheckpointDriver({
        tree: options.tree,
        matcher: () => options.matchTree,
        visual: options.visual ? {
            session: options.visual.session,
            expectation: (expected) => expected.visual ? {
                referenceId: options.visual.referenceId,
                region: options.visual.region,
                comparator: options.visual.comparator,
            } : undefined,
        } : undefined,
        semanticMatchesBeforeVisual: requiredMatches,
        now,
    });
    const flow = new ReplayFlow({
        checkpoints: driver,
        now,
        delay,
        emit: (event) => {
            if (event.kind !== "replay.checkpoint.checked" || !event.checkpoint)
                return;
            const metrics = event.checkpoint.actual.metrics;
            aggregate.treeCaptureDurationMs += metrics.treeCaptureDurationMs;
            aggregate.treeCompareDurationMs += metrics.treeCompareDurationMs;
            aggregate.screenshotCaptureDurationMs += metrics.screenshotCaptureDurationMs;
            aggregate.visualCompareDurationMs += metrics.visualCompareDurationMs;
            aggregate.treeCaptureCount += metrics.treeCaptureCount;
            aggregate.screenshotCaptureCount += metrics.screenshotCaptureCount;
        },
    });
    const checkpoint = await flow.waitForCheckpoint("staged-checkpoint", "postcondition", {
        id: "tree-then-visual",
        expected: { visual: Boolean(options.visual) },
        settle: {
            timeoutMs,
            intervalMs,
            consecutiveMatches: options.visual ? 1 : requiredMatches,
        },
    });
    const diagnostics = flow.diagnostics();
    return {
        status: checkpoint.status,
        tree: checkpoint.actual.tree,
        differences: checkpoint.differences,
        visual: checkpoint.actual.visual,
        metrics: {
            ...aggregate,
            semanticSettleDelayMs: diagnostics.checkpointSettleDelayMs,
            totalDurationMs: Math.max(0, now() - started),
        },
    };
}
export function canonicalTreeHash(root) {
    return createHash("sha256").update(JSON.stringify(canonicalNode(root))).digest("hex");
}
function canonicalNode(node) {
    return {
        role: node.role,
        name: node.name,
        text: node.text,
        value: node.value,
        testId: node.testId,
        className: node.className,
        states: ordered(node.states),
        bounds: node.bounds,
        attributes: ordered(node.attributes ?? {}),
        children: node.children.map(canonicalNode),
    };
}
function ordered(value) {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));
}
function positive(value, name) {
    if (!Number.isFinite(value) || value <= 0)
        throw new TypeError(`${name} must be positive`);
    return value;
}
//# sourceMappingURL=observation.js.map