import { createHash } from "node:crypto";
import type {
  DeviceSession,
  DeviceTarget,
  VisualCaptureSession,
  VisualComparator,
  VisualRegion,
} from "./device.js";
import type { CheckpointDifference } from "./types.js";
import { ReplayFlow } from "./flow.js";
import { ObservationCheckpointDriver } from "./observation-checkpoint.js";
import type { ObservationCheckpointActual } from "./observation-checkpoint.js";

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

export type SemanticSelector = Partial<Pick<
  SemanticNode,
  "nodeId" | "role" | "name" | "text" | "value" | "testId" | "className"
>>;

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

export type TreeMatcher = (
  snapshot: TreeSnapshot,
) => CheckpointDifference[] | Promise<CheckpointDifference[]>;

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

export async function waitForTreeThenVisual(options: {
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
}): Promise<StagedCheckpointResult> {
  const now = options.now ?? (() => performance.now());
  const delay = options.delay ?? ((durationMs) => new Promise<void>((resolve) => setTimeout(resolve, durationMs)));
  const started = now();
  const timeoutMs = positive(options.timeoutMs, "timeoutMs");
  const intervalMs = options.intervalMs ?? 30;
  const requiredMatches = options.consecutiveTreeMatches ?? 2;
  positive(requiredMatches, "consecutiveTreeMatches");
  type CompatibilityExpectation = { visual: boolean };
  const aggregate = {
    treeCaptureDurationMs: 0,
    treeCompareDurationMs: 0,
    screenshotCaptureDurationMs: 0,
    visualCompareDurationMs: 0,
    treeCaptureCount: 0,
    screenshotCaptureCount: 0,
  };
  const driver = new ObservationCheckpointDriver<CompatibilityExpectation>({
    tree: options.tree,
    matcher: () => options.matchTree,
    visual: options.visual ? {
      session: options.visual.session,
      expectation: (expected) => expected.visual ? {
        referenceId: options.visual!.referenceId,
        region: options.visual!.region,
        comparator: options.visual!.comparator,
      } : undefined,
    } : undefined,
    semanticMatchesBeforeVisual: requiredMatches,
    now,
  });
  const flow = new ReplayFlow<CompatibilityExpectation, ObservationCheckpointActual>({
    checkpoints: driver,
    now,
    delay,
    emit: (event) => {
      if (event.kind !== "replay.checkpoint.checked" || !event.checkpoint) return;
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

export function canonicalTreeHash(root: SemanticNode): string {
  return createHash("sha256").update(JSON.stringify(canonicalNode(root))).digest("hex");
}

function canonicalNode(node: SemanticNode): unknown {
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

function ordered<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))) as T;
}

function positive(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new TypeError(`${name} must be positive`);
  return value;
}
