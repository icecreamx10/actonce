import type {
  VisualCaptureSession,
  VisualComparator,
  VisualRegion,
} from "./device.js";
import type {
  TreeMatcher,
  TreeObservationSession,
  TreeSnapshot,
} from "./observation.js";
import type {
  CheckpointDifference,
  CheckpointDriver,
  CheckpointResult,
  CheckpointSpec,
  CheckpointVerificationContext,
} from "./types.js";

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
export class ObservationCheckpointDriver<TExpectation>
implements CheckpointDriver<TExpectation, ObservationCheckpointActual> {
  private readonly semanticMatches = new Map<string, number>();
  private readonly requiredSemanticMatches: number;

  constructor(private readonly adapter: ObservationCheckpointAdapter<TExpectation>) {
    this.requiredSemanticMatches = positiveInteger(
      adapter.semanticMatchesBeforeVisual ?? 2,
      "semanticMatchesBeforeVisual",
    );
  }

  async verify(
    spec: CheckpointSpec<TExpectation>,
    context?: CheckpointVerificationContext,
  ): Promise<CheckpointResult<ObservationCheckpointActual>> {
    const adapter = this.adapter;
    const now = this.adapter.now ?? (() => performance.now());
    const started = now();
    const actual = emptyActual();
    const matcher = this.adapter.matcher(spec.expected);
    const visualExpectation = this.adapter.visual?.expectation(spec.expected);

    if (expired(context, now())) {
      actual.captureErrors.push("checkpoint deadline exceeded before capture");
      return finish("unknown", [{
        path: "checkpoint.deadline",
        message: "Checkpoint deadline exceeded before capture",
      }]);
    }

    const before = await captureTree();
    if (!before) return finish("unknown", captureErrorDifferences(actual.captureErrors));
    const treeDifferences = await compareTree(before);
    if (treeDifferences.length) {
      this.semanticMatches.delete(spec.id);
      return finish("mismatched", treeDifferences);
    }

    if (!visualExpectation) {
      this.semanticMatches.delete(spec.id);
      return finish("matched", []);
    }

    // A caller that explicitly opts out of ReplayFlow settling still receives
    // one complete atomic checkpoint rather than a synthetic stability miss.
    const requiredSemanticMatches = spec.settle ? this.requiredSemanticMatches : 1;
    const semanticMatches = (this.semanticMatches.get(spec.id) ?? 0) + 1;
    if (semanticMatches < requiredSemanticMatches) {
      this.semanticMatches.set(spec.id, semanticMatches);
      return finish("mismatched", [{
        path: "tree.stability",
        expected: { consecutiveMatches: requiredSemanticMatches },
        actual: { consecutiveMatches: semanticMatches },
        message: "Semantic checkpoint has not matched enough consecutive observations",
      }]);
    }
    this.semanticMatches.delete(spec.id);

    if (expired(context, now())) {
      actual.captureErrors.push("checkpoint deadline exceeded before screenshot capture");
      return finish("unknown", captureErrorDifferences(actual.captureErrors));
    }
    try {
      const captureStarted = now();
      const frame = await this.adapter.visual!.session.capture({ region: visualExpectation.region });
      actual.metrics.screenshotCaptureDurationMs += Math.max(0, now() - captureStarted);
      actual.metrics.screenshotCaptureCount += 1;
      if (expired(context, now())) {
        actual.captureErrors.push("checkpoint deadline exceeded during screenshot capture");
        return finish("unknown", captureErrorDifferences(actual.captureErrors));
      }
      const compareStarted = now();
      actual.visual = await this.adapter.visual!.session.compare({
        frameId: frame.frameId,
        referenceId: visualExpectation.referenceId,
        region: visualExpectation.region,
        comparator: visualExpectation.comparator,
      });
      actual.metrics.visualCompareDurationMs += Math.max(0, now() - compareStarted);
    } catch (error) {
      actual.captureErrors.push(`visual: ${message(error)}`);
      return finish("unknown", captureErrorDifferences(actual.captureErrors));
    }

    const after = await captureTree();
    if (!after) return finish("unknown", captureErrorDifferences(actual.captureErrors));
    if (expired(context, now())) {
      actual.captureErrors.push("checkpoint deadline exceeded during final tree capture");
      return finish("unknown", captureErrorDifferences(actual.captureErrors));
    }
    const afterDifferences = await compareTree(after);
    if (before.canonicalHash !== after.canonicalHash) {
      afterDifferences.unshift({
        path: "tree.canonicalHash",
        expected: before.canonicalHash,
        actual: after.canonicalHash,
        message: "Tree changed while the visual checkpoint was captured",
      });
    }
    if (!actual.visual?.matched) {
      afterDifferences.push({
        path: "visual",
        expected: { referenceId: visualExpectation.referenceId },
        actual: actual.visual,
        message: "Visual checkpoint did not match",
      });
    }
    return finish(afterDifferences.length ? "mismatched" : "matched", afterDifferences);

    async function captureTree(): Promise<TreeSnapshot | undefined> {
      try {
        const captureStarted = now();
        const tree = await adapter.tree.capture();
        actual.metrics.treeCaptureDurationMs += Math.max(0, now() - captureStarted);
        actual.metrics.treeCaptureCount += 1;
        actual.tree = tree;
        return tree;
      } catch (error) {
        actual.captureErrors.push(`tree: ${message(error)}`);
        return undefined;
      }
    }

    async function compareTree(tree: TreeSnapshot): Promise<CheckpointDifference[]> {
      const compareStarted = now();
      const differences = await matcher(tree);
      actual.metrics.treeCompareDurationMs += Math.max(0, now() - compareStarted);
      return differences;
    }

    function finish(
      status: CheckpointResult<ObservationCheckpointActual>["status"],
      differences: CheckpointDifference[],
    ): CheckpointResult<ObservationCheckpointActual> {
      actual.metrics.totalDurationMs = Math.max(0, now() - started);
      return { status, actual, differences };
    }
  }
}

function emptyActual(): ObservationCheckpointActual {
  return {
    captureErrors: [],
    metrics: {
      treeCaptureDurationMs: 0,
      treeCompareDurationMs: 0,
      screenshotCaptureDurationMs: 0,
      visualCompareDurationMs: 0,
      totalDurationMs: 0,
      treeCaptureCount: 0,
      screenshotCaptureCount: 0,
    },
  };
}

function expired(context: CheckpointVerificationContext | undefined, now: number): boolean {
  return context?.signal.aborted === true || now > (context?.deadlineMs ?? Infinity);
}

function captureErrorDifferences(errors: string[]): CheckpointDifference[] {
  return errors.map((error, index) => ({
    path: `captureErrors.${index}`,
    actual: error,
    message: error,
  }));
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0) throw new TypeError(`${name} must be a positive integer`);
  return value;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
