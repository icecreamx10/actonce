import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import {
  compileAndroidPrimitives,
  extractAndroidPrimitives,
  type RecordedAndroidEvent,
} from "../../../runtime/android/src/index.js";

type CheckpointEvent = RecordedAndroidEvent & {
  phase?: "before-action" | "after-action";
  evidence?: {
    screenshot?: { path?: string; mediaType?: string };
    nativeUi?: { artifact?: { path?: string; mediaType?: string } };
    deviceMetadata?: { viewport?: { width?: number; height?: number } };
  };
  wallTime?: string;
};

const args = parseArgs(process.argv.slice(2));
const sampleDir = resolve(args.sample);
const recordingDir = resolve(sampleDir, "original");
const outputDir = resolve(sampleDir, "compiled");
await mkdir(outputDir, { recursive: true });

try {
  const manifest = JSON.parse(await readFile(resolve(recordingDir, "manifest.json"), "utf8"));
  const original = JSON.parse(await readFile(resolve(recordingDir, "result.json"), "utf8"));
  if (manifest.status !== "complete") throw new Error("Recording manifest is not complete");
  if (original.status !== "passed" || original.officialValidator?.reward !== 1) {
    throw new Error("Original execution did not pass the official AndroidWorld validator");
  }
  const events = ndjson(await readFile(resolve(recordingDir, "events.ndjson"), "utf8"));
  const primitives = extractAndroidPrimitives(events);
  if (!primitives.length) throw new Error("Recording contains no completed Android primitives");
  const checkpoints = events.filter(
    (event): event is CheckpointEvent => event.kind === "checkpoint.captured",
  );
  const firstScreenshot = requireScreenshot(
    checkpoints.find((event) => event.evidence?.screenshot?.path),
  );
  const metadata = await sharp(resolve(recordingDir, firstScreenshot)).metadata();
  if (!metadata.width || !metadata.height) throw new Error("Recorded screenshot has no dimensions");
  const region = {
    left: 0,
    top: Math.round(metadata.height * 0.04),
    width: metadata.width,
    height: Math.round(metadata.height * 0.9),
  };
  const steps = await Promise.all(primitives.map(async (compiled) => {
    const before = checkpoints.find(
      (event) => event.actionId === compiled.actionId && event.phase === "before-action",
    );
    const after = checkpoints.find(
      (event) => event.actionId === compiled.actionId && event.phase === "after-action",
    );
    return {
      ...compiled,
      before: {
        sequence: requireSequence(before),
        path: requireScreenshot(before),
        region,
        sourceIncludes: await sourceSignature(recordingDir, before, after),
        sourceNode: await focusedNodeSignature(recordingDir, before),
      },
      after: {
        sequence: requireSequence(after),
        path: requireScreenshot(after),
        region,
        sourceIncludes: await sourceSignature(
          recordingDir,
          after,
          before,
          compiled.primitive.arguments.filter(
            (value): value is string => typeof value === "string",
          ),
        ),
        sourceNode: await focusedNodeSignature(recordingDir, after),
      },
      recordedSettleMs: recordedSettle(before, after),
      targetNode: await targetNodeSignature(
        recordingDir,
        before,
        compiled.primitive,
        metadata.width!,
      ),
    };
  }));
  const generated = generatedReplay({
    benchmark: original.benchmark,
    recordingId: manifest.recordingId,
    steps,
  });
  await writeFile(resolve(outputDir, "replay.ts"), generated);
  await writeFile(
    resolve(outputDir, "recorded-input.ts"),
    compileAndroidPrimitives(events, { recordingId: manifest.recordingId }).source,
  );
  await writeJson(resolve(outputDir, "assertion-decision.json"), {
    schemaVersion: 1,
    recordingId: manifest.recordingId,
    mode: "deterministic",
    sourceSequenceRange: {
      from: steps[0].before.sequence,
      to: steps.at(-1)!.after.sequence,
    },
    checkpointEvidence: steps.map((step) => ({
      actionId: step.actionId,
      beforeSequence: step.before.sequence,
      afterSequence: step.after.sequence,
      source: "recorded-screenshot",
      before: step.before.path,
      after: step.after.path,
    })),
    oracle: {
      type: "official-android-world-validator",
      expectedReward: 1,
    },
    fallback: { policy: "disabled" },
  });
  await writeJson(resolve(outputDir, "compile-result.json"), {
    schemaVersion: 1,
    status: "passed",
    recordingId: manifest.recordingId,
    primitiveCount: steps.length,
    output: relative(process.cwd(), resolve(outputDir, "replay.ts")),
  });
  console.log(JSON.stringify({ status: "passed", primitiveCount: steps.length, outputDir }, null, 2));
} catch (error) {
  const failure = {
    schemaVersion: 1,
    status: "failed",
    error: error instanceof Error
      ? { name: error.name, message: error.message }
      : { name: "Error", message: String(error) },
  };
  await writeJson(resolve(outputDir, "compile-result.json"), failure);
  console.error(JSON.stringify(failure, null, 2));
  process.exitCode = 2;
}

function generatedReplay(input: {
  benchmark: string;
  recordingId: string;
  steps: Array<{
    sequence: number;
    actionId: string;
    primitive: unknown;
    before: { sequence: number; path: string; region: object; sourceIncludes: string[]; sourceNode?: Record<string, string> };
    after: { sequence: number; path: string; region: object; sourceIncludes: string[]; sourceNode?: Record<string, string> };
    recordedSettleMs: number;
    targetNode?: Record<string, string>;
  }>;
}) {
  return `/**
 * Generated mechanically from ActOnce recording: ${input.recordingId}
 * Checkpoint-gated deterministic Android replay. Do not inline driver calls.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AndroidSession,
  replayCheckpointGatedAndroidRecording,
} from "@byted-lynx/actonce-android";

const outputDir = resolve(process.env.ACTONCE_BENCHMARK_OUTPUT_DIR ?? ".cache/android-world/replay");
const recordingDir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "original");
const rawSteps = ${JSON.stringify(input.steps, null, 2)};
const steps = rawSteps.map((step) => ({
  ...step,
  before: { ...step.before, referencePath: resolve(recordingDir, step.before.path) },
  after: { ...step.after, referencePath: resolve(recordingDir, step.after.path) },
}));
const started = process.hrtime.bigint();
await mkdir(outputDir, { recursive: true });
const android = await AndroidSession.connect();
let status = "passed";
let error;
let replayDiagnostics;
try {
  replayDiagnostics = await replayCheckpointGatedAndroidRecording(android, steps);
  await android.screenshot(resolve(outputDir, "final.png"));
} catch (caught) {
  status = "failed";
  error = caught instanceof Error
    ? { name: caught.name, message: caught.message }
    : { name: "Error", message: String(caught) };
} finally {
  const executionDurationMs = Number(process.hrtime.bigint() - started) / 1_000_000;
  await writeFile(resolve(outputDir, "result.json"), JSON.stringify({
    schemaVersion: 1,
    benchmark: ${JSON.stringify(input.benchmark)},
    mode: "replay",
    status,
    executionDurationMs,
    replayDiagnostics,
    error,
  }, null, 2) + "\\n");
  await android.close();
}
console.log(JSON.stringify({ status, replayDiagnostics, error }, null, 2));
if (status === "failed") process.exitCode = 2;
`;
}

function requireSequence(event: CheckpointEvent | undefined) {
  if (!Number.isInteger(event?.sequence)) throw new Error("Recorded action is missing checkpoint sequence");
  return event!.sequence!;
}

function requireScreenshot(event: CheckpointEvent | undefined) {
  const path = event?.evidence?.screenshot?.path;
  if (!path) throw new Error(`Checkpoint ${event?.sequence ?? "<missing>"} has no screenshot evidence`);
  return path;
}

function recordedSettle(before: CheckpointEvent | undefined, after: CheckpointEvent | undefined) {
  const from = Date.parse(before?.wallTime ?? "");
  const to = Date.parse(after?.wallTime ?? "");
  return Number.isFinite(from) && Number.isFinite(to) && to >= from
    ? Math.min(6_000, to - from)
    : 0;
}

async function sourceSignature(
  recordingDir: string,
  checkpoint: CheckpointEvent | undefined,
  competing: CheckpointEvent | undefined,
  hints: string[] = [],
) {
  const values = await nativeStrings(recordingDir, checkpoint);
  const competingValues = new Set(await nativeStrings(recordingDir, competing));
  const distinctive = values.filter((value) => !competingValues.has(value));
  const stableDistinctive = unique(distinctive.filter(stableSourceValue));
  const hinted = stableDistinctive.filter((value) =>
    hints.some((hint) => equivalentSemanticValue(value, hint)),
  );
  const numeric = stableDistinctive.filter((value) => /\d/.test(value));
  const remainingDistinctive = stableDistinctive
    .filter((value) => !hinted.includes(value) && !numeric.includes(value))
    .sort((left, right) => left.length - right.length);
  // A source checkpoint is usable only when it distinguishes the two adjacent
  // states. Generic labels such as Save/Phone are evidence that the app is
  // open, but cannot prove that a focus or input action has completed.
  return unique([...hinted, ...numeric, ...remainingDistinctive]).slice(0, 1);
}

async function nativeStrings(recordingDir: string, checkpoint: CheckpointEvent | undefined) {
  const path = checkpoint?.evidence?.nativeUi?.artifact?.path;
  if (!path) return [];
  const tree = JSON.parse(await readFile(resolve(recordingDir, path), "utf8"));
  const values: string[] = [];
  visit(tree, values);
  return values;
}

async function focusedNodeSignature(
  recordingDir: string,
  checkpoint: CheckpointEvent | undefined,
) {
  const path = checkpoint?.evidence?.nativeUi?.artifact?.path;
  if (!path) return undefined;
  const tree = JSON.parse(await readFile(resolve(recordingDir, path), "utf8"));
  const focused = findObject(tree, (node) => node.focused === "true");
  if (!focused) return undefined;
  const identity = ["text", "content-desc", "resource-id"]
    .find((key) => typeof focused[key] === "string" && focused[key]);
  if (!identity) return undefined;
  return {
    [identity]: focused[identity] as string,
    focused: "true",
  };
}

async function targetNodeSignature(
  recordingDir: string,
  checkpoint: CheckpointEvent | undefined,
  primitive: { operation: string; arguments: unknown[] },
  screenshotWidth: number,
) {
  if (!["tap", "doubleClick", "longPress"].includes(primitive.operation)) return undefined;
  const point = primitive.arguments[0];
  if (!point || typeof point !== "object") return undefined;
  const x = (point as { x?: unknown }).x, y = (point as { y?: unknown }).y;
  const viewportWidth = checkpoint?.evidence?.deviceMetadata?.viewport?.width;
  const path = checkpoint?.evidence?.nativeUi?.artifact?.path;
  if (typeof x !== "number" || typeof y !== "number" || !viewportWidth || !path) return undefined;
  const scale = screenshotWidth / viewportWidth;
  const tree = JSON.parse(await readFile(resolve(recordingDir, path), "utf8"));
  const candidates: Array<{ node: Record<string, unknown>; area: number }> = [];
  collectContainingNodes(tree, x, y, scale, candidates);
  candidates.sort((left, right) => left.area - right.area);
  for (const { node } of candidates) {
    for (const key of ["resource-id", "content-desc", "text"]) {
      if (typeof node[key] === "string" && node[key]) return { [key]: node[key] as string };
    }
  }
  return undefined;
}

function collectContainingNodes(
  value: unknown,
  x: number,
  y: number,
  physicalScale: number,
  output: Array<{ node: Record<string, unknown>; area: number }>,
) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) collectContainingNodes(item, x, y, physicalScale, output);
    return;
  }
  const node = value as Record<string, unknown>;
  const logicalBounds = objectBounds(node.bounds);
  const physicalBounds = typeof node.bounds === "string" ? boundsNumbers(node.bounds) : undefined;
  const bounds = logicalBounds ?? physicalBounds;
  const pointX = logicalBounds ? x : x * physicalScale;
  const pointY = logicalBounds ? y : y * physicalScale;
  if (bounds && pointX >= bounds.left && pointX <= bounds.right && pointY >= bounds.top && pointY <= bounds.bottom) {
    const attrs = node.attrs && typeof node.attrs === "object"
      ? node.attrs as Record<string, unknown>
      : node;
    output.push({ node: attrs, area: (bounds.right - bounds.left) * (bounds.bottom - bounds.top) });
  }
  for (const item of Object.values(node)) collectContainingNodes(item, x, y, physicalScale, output);
}

function boundsNumbers(value: string) {
  const values = [...value.matchAll(/\d+/g)].map((match) => Number(match[0]));
  if (values.length !== 4) return undefined;
  return { left: values[0], top: values[1], right: values[2], bottom: values[3] };
}

function objectBounds(value: unknown) {
  if (!value || typeof value !== "object") return undefined;
  const bounds = value as Record<string, unknown>;
  if (![bounds.left, bounds.top, bounds.width, bounds.height].every((item) => typeof item === "number")) return undefined;
  return {
    left: bounds.left as number,
    top: bounds.top as number,
    right: (bounds.left as number) + (bounds.width as number),
    bottom: (bounds.top as number) + (bounds.height as number),
  };
}

function findObject(
  value: unknown,
  predicate: (value: Record<string, unknown>) => boolean,
): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const match = findObject(item, predicate);
      if (match) return match;
    }
    return undefined;
  }
  const object = value as Record<string, unknown>;
  if (predicate(object)) return object;
  for (const item of Object.values(object)) {
    const match = findObject(item, predicate);
    if (match) return match;
  }
  return undefined;
}

function visit(value: unknown, output: string[]) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) visit(item, output);
    return;
  }
  const record = value as Record<string, unknown>;
  for (const key of ["text", "content-desc"]) {
    const item = record[key];
    if (typeof item === "string" && item.trim()) output.push(item.trim());
  }
  for (const item of Object.values(record)) visit(item, output);
}

function stableSourceValue(value: string) {
  return value.length >= 3 && value.length <= 120 && !/^\d{1,2}:\d{2}$/.test(value);
}

function equivalentSemanticValue(left: string, right: string) {
  const normalize = (value: string) => value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  const a = normalize(left), b = normalize(right);
  return Boolean(a && b && (a === b || a.includes(b) || b.includes(a)));
}

function unique(values: string[]) {
  return values.filter((value, index) => values.indexOf(value) === index);
}

function ndjson(value: string): RecordedAndroidEvent[] {
  return value.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

function parseArgs(values: string[]) {
  let sample: string | undefined;
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] === "--sample") sample = values[++index];
    else throw new Error(`Unknown argument: ${values[index]}`);
  }
  if (!sample) throw new Error("--sample is required");
  return { sample };
}

async function writeJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}
