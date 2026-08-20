import type { VisualCaptureSession, VisualComparator, VisualRegion } from "./device.js";
import type { TreeMatcher, TreeObservationSession, TreeSnapshot } from "./observation.js";
import type { CheckpointDriver, CheckpointResult, CheckpointSpec, CheckpointVerificationContext } from "./types.js";
export type ObservationVisualExpectation = {
    referenceId: string;
    region?: VisualRegion;
    comparator: VisualComparator;
};
export type ObservationCheckpointActual = {
    tree?: TreeSnapshot;
    visual?: Awaited<ReturnType<VisualCaptureSession["compare"]>>;
    captureErrors: string[];
    metrics: {
        treeCaptureDurationMs: number;
        treeCompareDurationMs: number;
        screenshotCaptureDurationMs: number;
        visualCompareDurationMs: number;
        totalDurationMs: number;
        treeCaptureCount: number;
        screenshotCaptureCount: number;
    };
};
export type ObservationCheckpointAdapter<TExpectation> = {
    tree: TreeObservationSession;
    matcher(expected: TExpectation): TreeMatcher;
    visual?: {
        session: VisualCaptureSession;
        expectation(expected: TExpectation): ObservationVisualExpectation | undefined;
    };
    /**
     * Cheap semantic observations required before an expensive screenshot.
     * The replay flow remains responsible for the outer timeout and polling.
     */
    semanticMatchesBeforeVisual?: number;
    now?: () => number;
};
/**
 * A single replay-checkpoint driver shared by CDP, AX, WDA and UIAutomator
 * observers. It performs no sleeps and owns no timeout loop. ReplayFlow is the
 * only scheduler; this driver captures one coherent tree -> visual -> tree
 * observation whenever verify() is called.
 */
export declare class ObservationCheckpointDriver<TExpectation> implements CheckpointDriver<TExpectation, ObservationCheckpointActual> {
    private readonly adapter;
    private readonly semanticMatches;
    private readonly requiredSemanticMatches;
    constructor(adapter: ObservationCheckpointAdapter<TExpectation>);
    verify(spec: CheckpointSpec<TExpectation>, context?: CheckpointVerificationContext): Promise<CheckpointResult<ObservationCheckpointActual>>;
}
//# sourceMappingURL=observation-checkpoint.d.ts.map