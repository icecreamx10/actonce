import type { DeviceSession, DeviceTarget, VisualCaptureSession, VisualComparator, VisualRegion } from "./device.js";
import type { CheckpointDifference } from "./types.js";
export type TreeSourceKind = "cdp" | "ax" | "wda" | "uiautomator";
export type TreeSourceDescriptor = {
    id: string;
    kind: TreeSourceKind;
    schemaVersion: string;
    capabilities: {
        fullTree: boolean;
        query: boolean;
        bounds: boolean;
        stableNodeId: boolean;
        subscriptions: boolean;
    };
};
export type SemanticNode = {
    nodeId?: string;
    role?: string;
    name?: string;
    text?: string;
    value?: string;
    testId?: string;
    className?: string;
    states: {
        visible?: boolean;
        enabled?: boolean;
        focused?: boolean;
        selected?: boolean;
        checked?: boolean;
    };
    bounds?: VisualRegion;
    attributes?: Record<string, string | number | boolean | null>;
    sourceAttributes?: Record<string, unknown>;
    children: SemanticNode[];
};
export type TreeSnapshot = {
    snapshotId: string;
    source: TreeSourceDescriptor;
    targetId: string;
    sequence: number;
    capturedAtMonotonicNs: string;
    captureDurationMs: number;
    root: SemanticNode;
    canonicalHash: string;
    rawArtifactRef?: string;
};
export type SemanticSelector = Partial<Pick<SemanticNode, "nodeId" | "role" | "name" | "text" | "value" | "testId" | "className">>;
export interface TreeObservationSession {
    readonly source: TreeSourceDescriptor;
    capture(): Promise<TreeSnapshot>;
    query(selector: SemanticSelector): Promise<SemanticNode[]>;
    close(): Promise<void>;
}
export interface TreeObserver<TOptions = unknown> {
    readonly source: TreeSourceDescriptor;
    connect(context: {
        device: DeviceSession;
        target: DeviceTarget;
        options: TOptions;
    }): Promise<TreeObservationSession>;
}
export type TreeMatcher = (snapshot: TreeSnapshot) => CheckpointDifference[] | Promise<CheckpointDifference[]>;
export type StagedCheckpointResult = {
    status: "matched" | "mismatched" | "unknown";
    tree?: TreeSnapshot;
    differences: CheckpointDifference[];
    visual?: Awaited<ReturnType<VisualCaptureSession["compare"]>>;
    metrics: {
        treeCaptureDurationMs: number;
        treeCompareDurationMs: number;
        semanticSettleDelayMs: number;
        screenshotCaptureDurationMs: number;
        visualCompareDurationMs: number;
        totalDurationMs: number;
        treeCaptureCount: number;
        screenshotCaptureCount: number;
    };
};
export declare function waitForTreeThenVisual(options: {
    tree: TreeObservationSession;
    matchTree: TreeMatcher;
    timeoutMs: number;
    intervalMs?: number;
    consecutiveTreeMatches?: number;
    visual?: {
        session: VisualCaptureSession;
        referenceId: string;
        region?: VisualRegion;
        comparator: VisualComparator;
    };
    now?: () => number;
    delay?: (durationMs: number) => Promise<void>;
}): Promise<StagedCheckpointResult>;
export declare function canonicalTreeHash(root: SemanticNode): string;
//# sourceMappingURL=observation.d.ts.map