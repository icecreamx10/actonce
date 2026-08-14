import type { AndroidSession } from "./session.js";
import type { RecordedAndroidPrimitive } from "./primitives.js";
import { replayAndroidPrimitive } from "./primitives.js";
import { compareAndroidVisualScreenshot } from "./checkpoint.js";

export type RecordedAndroidVisualCheckpoint = {
  sequence: number;
  referencePath: string;
  region?: { left: number; top: number; width: number; height: number };
  sourceIncludes?: string[];
  sourceNode?: Record<string, string>;
};

export type CheckpointGatedAndroidStep = {
  sequence: number;
  actionId: string;
  primitive: RecordedAndroidPrimitive;
  before: RecordedAndroidVisualCheckpoint;
  after: RecordedAndroidVisualCheckpoint;
  recordedSettleMs?: number;
  targetNode?: Record<string, string>;
};

export type CheckpointGatedAndroidReplayOptions = {
  fastTimeoutMs?: number;
  timeoutMs?: number;
  intervalMs?: number;
  pixelThreshold?: number;
  maxDifferenceRatio?: number;
  lookahead?: number;
};

export type CheckpointGatedAndroidReplayDiagnostics = {
  mode: "deterministic";
  fallbackCount: 0;
  primitiveCount: number;
  executedPrimitiveCount: number;
  skippedPrimitiveCount: number;
  checkpointCaptureCount: number;
  sourceCaptureCount: number;
  fastSettleCount: number;
  conservativeSettleCount: number;
  captureDurationMs: number;
  sourceCaptureDurationMs: number;
  settleDelayMs: number;
  reachedSequences: number[];
};

export async function replayCheckpointGatedAndroidRecording(
  android: AndroidSession,
  steps: CheckpointGatedAndroidStep[],
  options: CheckpointGatedAndroidReplayOptions = {},
): Promise<CheckpointGatedAndroidReplayDiagnostics> {
  const diagnostics: CheckpointGatedAndroidReplayDiagnostics = {
    mode: "deterministic",
    fallbackCount: 0,
    primitiveCount: steps.length,
    executedPrimitiveCount: 0,
    skippedPrimitiveCount: 0,
    checkpointCaptureCount: 0,
    sourceCaptureCount: 0,
    fastSettleCount: 0,
    conservativeSettleCount: 0,
    captureDurationMs: 0,
    sourceCaptureDurationMs: 0,
    settleDelayMs: 0,
    reachedSequences: [],
  };
  let index = 0;
  let adjacentPostMatched = false;
  while (index < steps.length) {
    const current = await capture(android, diagnostics);
    let alreadyReached = await findReachedStep(
      current,
      steps,
      index,
      options,
    );
    if (alreadyReached === null) {
      alreadyReached = await findReachedStepBySource(
        android,
        diagnostics,
        steps,
        index,
        options,
      );
    }
    if (alreadyReached !== null) {
      diagnostics.skippedPrimitiveCount += alreadyReached - index + 1;
      diagnostics.reachedSequences.push(steps[alreadyReached].after.sequence);
      index = alreadyReached + 1;
      adjacentPostMatched = true;
      continue;
    }

    if (
      !adjacentPostMatched &&
      !(await matches(current, steps[index].before, options)) &&
      !(await matchesSource(android, diagnostics, steps[index].before))
    ) {
      const before = await settle(
        android,
        diagnostics,
        (image) => matches(image, steps[index].before, options),
        Math.min(options.fastTimeoutMs ?? 1_200, options.timeoutMs ?? 6_000),
        options.intervalMs ?? 80,
      );
      if (!before) {
        throw new Error(
          `Recorded pre-checkpoint ${steps[index].before.sequence} did not match before action ${steps[index].actionId}`,
        );
      }
    }

    await replayAndroidPrimitive(
      android,
      await resolveTargetPrimitive(android, diagnostics, steps[index]),
    );
    adjacentPostMatched = false;
    diagnostics.executedPrimitiveCount += 1;
    const fastDeadline = options.fastTimeoutMs ?? 1_200;
    let reached = await settleForReached(
      android,
      diagnostics,
      steps,
      index,
      options,
      fastDeadline,
    );
    if (reached !== null) {
      diagnostics.fastSettleCount += 1;
    } else {
      reached = await findReachedStepBySource(
        android,
        diagnostics,
        steps,
        index,
        options,
      );
    }
    if (reached === null) {
      diagnostics.conservativeSettleCount += 1;
      const conservativeStarted = process.hrtime.bigint();
      const recordedDelay = Math.max(0, steps[index].recordedSettleMs ?? 0);
      if (recordedDelay > fastDeadline) {
        await delay(Math.min(recordedDelay - fastDeadline, options.timeoutMs ?? 6_000));
      }
      diagnostics.settleDelayMs += elapsed(conservativeStarted);
      reached = await settleForReached(
        android,
        diagnostics,
        steps,
        index,
        options,
        Math.max(0, (options.timeoutMs ?? 6_000) - recordedDelay),
      );
      if (reached === null) {
        reached = await findReachedStepBySource(
          android,
          diagnostics,
          steps,
          index,
          options,
        );
      }
    }
    if (reached === null) {
      throw new Error(
        `Recorded post-checkpoint ${steps[index].after.sequence} did not match after action ${steps[index].actionId}`,
      );
    }
    diagnostics.skippedPrimitiveCount += Math.max(0, reached - index);
    diagnostics.reachedSequences.push(steps[reached].after.sequence);
    index = reached + 1;
    adjacentPostMatched = true;
  }
  return diagnostics;
}

async function resolveTargetPrimitive(
  android: AndroidSession,
  diagnostics: CheckpointGatedAndroidReplayDiagnostics,
  step: CheckpointGatedAndroidStep,
): Promise<RecordedAndroidPrimitive> {
  if (
    !step.targetNode ||
    !["tap", "doubleClick", "longPress"].includes(step.primitive.operation)
  ) return step.primitive;
  const started = process.hrtime.bigint();
  android.invalidateObservation();
  const tree = JSON.parse(await android.source());
  diagnostics.sourceCaptureDurationMs += elapsed(started);
  diagnostics.sourceCaptureCount += 1;
  const node = findSourceNodeValue(tree, step.targetNode);
  if (!node) return step.primitive;
  const bounds = parseBounds(node.bounds);
  const screenWidth = maximumRight(tree);
  const size = await android.device.size();
  if (!screenWidth || !size.width) return step.primitive;
  return {
    ...step.primitive,
    arguments: [
      {
        x: (bounds.left + bounds.right) / 2 / (screenWidth / size.width),
        y: (bounds.top + bounds.bottom) / 2 / (screenWidth / size.width),
      },
      ...step.primitive.arguments.slice(1),
    ],
  };
}

async function findReachedStepBySource(
  android: AndroidSession,
  diagnostics: CheckpointGatedAndroidReplayDiagnostics,
  steps: CheckpointGatedAndroidStep[],
  index: number,
  options: CheckpointGatedAndroidReplayOptions,
): Promise<number | null> {
  const started = process.hrtime.bigint();
  android.invalidateObservation();
  const source = await android.source();
  diagnostics.sourceCaptureDurationMs += elapsed(started);
  diagnostics.sourceCaptureCount += 1;
  const end = Math.min(steps.length, index + (options.lookahead ?? 4));
  for (let candidate = index; candidate < end; candidate += 1) {
    if (matchesSourceExpectation(source, steps[candidate].after)) {
      return candidate;
    }
  }
  return null;
}

async function matchesSource(
  android: AndroidSession,
  diagnostics: CheckpointGatedAndroidReplayDiagnostics,
  checkpoint: RecordedAndroidVisualCheckpoint,
) {
  if (!checkpoint.sourceIncludes?.length && !checkpoint.sourceNode) return false;
  const started = process.hrtime.bigint();
  android.invalidateObservation();
  const source = await android.source();
  diagnostics.sourceCaptureDurationMs += elapsed(started);
  diagnostics.sourceCaptureCount += 1;
  return matchesSourceExpectation(source, checkpoint);
}

export function matchesSourceExpectation(
  source: string,
  checkpoint: RecordedAndroidVisualCheckpoint,
) {
  if (checkpoint.sourceNode) {
    return findSourceNode(JSON.parse(source), checkpoint.sourceNode);
  }
  const expected = checkpoint.sourceIncludes ?? [];
  return expected.length > 0 && expected.every((value) => source.includes(value));
}

function findSourceNode(
  value: unknown,
  expected: Record<string, string>,
): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some((item) => findSourceNode(item, expected));
  const node = value as Record<string, unknown>;
  if (Object.entries(expected).every(([key, item]) => node[key] === item)) return true;
  return Object.values(node).some((item) => findSourceNode(item, expected));
}

function findSourceNodeValue(
  value: unknown,
  expected: Record<string, string>,
): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const match = findSourceNodeValue(item, expected);
      if (match) return match;
    }
    return undefined;
  }
  const node = value as Record<string, unknown>;
  if (Object.entries(expected).every(([key, item]) => node[key] === item)) return node;
  for (const item of Object.values(node)) {
    const match = findSourceNodeValue(item, expected);
    if (match) return match;
  }
  return undefined;
}

function parseBounds(value: unknown) {
  if (typeof value !== "string") throw new Error("Accessibility target is missing bounds");
  const numbers = [...value.matchAll(/\d+/g)].map((match) => Number(match[0]));
  if (numbers.length !== 4) throw new Error(`Invalid Android bounds: ${value}`);
  return { left: numbers[0], top: numbers[1], right: numbers[2], bottom: numbers[3] };
}

function maximumRight(value: unknown): number {
  if (!value || typeof value !== "object") return 0;
  if (Array.isArray(value)) return Math.max(0, ...value.map(maximumRight));
  const object = value as Record<string, unknown>;
  let own = 0;
  if (typeof object.bounds === "string") {
    try { own = parseBounds(object.bounds).right; } catch { own = 0; }
  }
  return Math.max(own, ...Object.values(object).map(maximumRight));
}

async function settleForReached(
  android: AndroidSession,
  diagnostics: CheckpointGatedAndroidReplayDiagnostics,
  steps: CheckpointGatedAndroidStep[],
  index: number,
  options: CheckpointGatedAndroidReplayOptions,
  timeoutMs: number,
): Promise<number | null> {
  let reached: number | null = null;
  await settle(
    android,
    diagnostics,
    async (image) => {
      reached = await findReachedStep(image, steps, index, options);
      return reached !== null;
    },
    timeoutMs,
    options.intervalMs ?? 80,
  );
  return reached;
}

async function findReachedStep(
  image: string,
  steps: CheckpointGatedAndroidStep[],
  index: number,
  options: CheckpointGatedAndroidReplayOptions,
): Promise<number | null> {
  const end = Math.min(steps.length, index + (options.lookahead ?? 4));
  for (let candidate = index; candidate < end; candidate += 1) {
    if (await matches(image, steps[candidate].after, options)) return candidate;
  }
  return null;
}

async function settle(
  android: AndroidSession,
  diagnostics: CheckpointGatedAndroidReplayDiagnostics,
  predicate: (image: string) => Promise<boolean>,
  timeoutMs: number,
  intervalMs: number,
) {
  const deadline = Date.now() + timeoutMs;
  do {
    const image = await capture(android, diagnostics);
    if (await predicate(image)) return true;
    if (Date.now() >= deadline) return false;
    const delayStarted = process.hrtime.bigint();
    await delay(intervalMs);
    diagnostics.settleDelayMs += elapsed(delayStarted);
  } while (true);
}

async function capture(
  android: AndroidSession,
  diagnostics: CheckpointGatedAndroidReplayDiagnostics,
) {
  const started = process.hrtime.bigint();
  const result = await android.screenshot();
  diagnostics.captureDurationMs += elapsed(started);
  diagnostics.checkpointCaptureCount += 1;
  return result;
}

async function matches(
  image: string,
  checkpoint: RecordedAndroidVisualCheckpoint,
  options: CheckpointGatedAndroidReplayOptions,
) {
  const comparison = await compareAndroidVisualScreenshot(image, {
    referencePath: checkpoint.referencePath,
    region: checkpoint.region,
    resizeWidth: 256,
    pixelThreshold: options.pixelThreshold ?? 24,
    maxDifferenceRatio: options.maxDifferenceRatio ?? 0.003,
  });
  return comparison.differenceRatio <= (options.maxDifferenceRatio ?? 0.003);
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function elapsed(started: bigint) {
  return Number(process.hrtime.bigint() - started) / 1_000_000;
}
