import type { CheckpointDifference, CheckpointDriver, CheckpointResult, CheckpointSpec, CheckpointVerificationContext, DeviceSession, DeviceTarget, FallbackDriver, FallbackPolicy, ObservationCheckpointActual, ObservationVisualExpectation, ReplayEvent, SemanticNode, SemanticSelector, TreeObservationSession, TreeMatcher, TreeObserver, TreeSnapshot, TreeSourceDescriptor } from "@byted-lynx/actonce-replay";
import { ReplayFlow } from "@byted-lynx/actonce-replay";
import type { VisualCaptureSession } from "@byted-lynx/actonce-replay";
export interface CdpClient {
    request<TResult = unknown>(method: string, params?: Record<string, unknown>): Promise<TResult>;
    close(): Promise<void>;
}
export type CdpObserverOptions = {
    client?: CdpClient;
    endpoint?: string;
    target?: {
        id?: string;
        title?: string;
        url?: string;
        type?: string;
    };
};
type CdpNode = {
    nodeId?: number;
    backendNodeId?: number;
    nodeType?: number;
    nodeName?: string;
    localName?: string;
    nodeValue?: string;
    attributes?: string[];
    children?: CdpNode[];
    shadowRoots?: CdpNode[];
    contentDocument?: CdpNode;
    pseudoElements?: CdpNode[];
};
export declare const CDP_TREE_SOURCE: TreeSourceDescriptor;
export declare class CdpTreeObserver implements TreeObserver<CdpObserverOptions> {
    readonly source: TreeSourceDescriptor;
    connect(context: {
        device: DeviceSession;
        target: DeviceTarget;
        options: CdpObserverOptions;
    }): Promise<TreeObservationSession>;
}
export declare class CdpTreeSession implements TreeObservationSession {
    private readonly client;
    private readonly targetId;
    readonly source: TreeSourceDescriptor;
    private sequence;
    constructor(client: CdpClient, targetId: string);
    capture(): Promise<TreeSnapshot>;
    query(selector: SemanticSelector): Promise<SemanticNode[]>;
    close(): Promise<void>;
}
export declare function normalizeCdpNode(node: CdpNode): SemanticNode;
export declare function matchCanonicalTree(expectedHash: string): (snapshot: TreeSnapshot) => CheckpointDifference[];
export type SemanticProjection = Array<{
    selector: SemanticSelector;
    count?: {
        min?: number;
        max?: number;
    };
    properties?: {
        text?: string;
        value?: string;
        visible?: boolean;
        enabled?: boolean;
    };
}>;
export type CdpCheckpointExpectation = {
    tree: {
        canonicalHash?: string;
        projection?: SemanticProjection;
    };
    visual?: ObservationVisualExpectation;
};
export type CdpCheckpointActual = ObservationCheckpointActual;
export type CdpCheckpointDriverOptions = {
    tree: TreeObservationSession;
    visual?: VisualCaptureSession;
    semanticMatchesBeforeVisual?: number;
    now?: () => number;
};
export type CdpReplayFlowOptions = CdpCheckpointDriverOptions & {
    policy?: FallbackPolicy;
    fallback?: FallbackDriver<CdpCheckpointExpectation, CdpCheckpointActual>;
    emit?: (event: ReplayEvent<CdpCheckpointActual>) => void | Promise<void>;
    delay?: (durationMs: number) => Promise<void>;
};
export declare function createCdpReplayFlow(options: CdpReplayFlowOptions): ReplayFlow<CdpCheckpointExpectation, ObservationCheckpointActual>;
/** CDP lowering for the shared ActOnce observation checkpoint driver. */
export declare class CdpCheckpointDriver implements CheckpointDriver<CdpCheckpointExpectation, CdpCheckpointActual> {
    private readonly driver;
    constructor(options: CdpCheckpointDriverOptions);
    verify(spec: CheckpointSpec<CdpCheckpointExpectation>, context?: CheckpointVerificationContext): Promise<CheckpointResult<CdpCheckpointActual>>;
}
export declare function matchCdpCheckpoint(expected: CdpCheckpointExpectation["tree"]): TreeMatcher;
export declare function matchSemanticProjection(projection: SemanticProjection): (snapshot: TreeSnapshot) => CheckpointDifference[];
export declare class CdpWebSocketClient implements CdpClient {
    private readonly socket;
    private id;
    private readonly pending;
    private constructor();
    static connect(url: string): Promise<CdpWebSocketClient>;
    request<TResult>(method: string, params?: Record<string, unknown>): Promise<TResult>;
    close(): Promise<void>;
}
export declare function resolveCdpWebSocketUrl(endpoint: string | undefined, selector?: CdpObserverOptions["target"]): Promise<string>;
export {};
//# sourceMappingURL=index.d.ts.map