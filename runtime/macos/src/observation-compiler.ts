import { readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

type ArtifactRef = {
  path?: string;
  mediaType?: string;
  complete?: boolean;
};

type RecordingEvent = {
  kind?: string;
  sequence?: number;
  recordingId?: string;
  platform?: string;
  taskId?: string;
  operation?: string;
  stepId?: string;
  stepKind?: string;
  durationMs?: number;
  prompt?: string;
  result?: unknown;
  evidenceSource?: string;
  artifact?: ArtifactRef;
  sourceDumpArtifact?: ArtifactRef;
  evidence?: {
    nativeUi?: { status?: string; artifact?: ArtifactRef };
    domIncluded?: boolean | null;
    screenshots?: Array<{ sequence?: number; artifact?: ArtifactRef }>;
  };
};

export type MacObservationMode = "visual" | "dom" | "native-ui" | "unknown";
export type MacEvaluatorModality = "visual" | "dom" | "native-ui";

export type MacObservationPlanItem = {
  observationTaskId: string;
  sequence: number;
  operation: string | null;
  prompt: string | null;
  recordedResult: unknown;
  recordedMode: MacObservationMode;
  status: "requires-evaluator" | "uncompilable";
  allowedEvaluatorModalities: MacEvaluatorModality[];
  evidence: {
    screenshots: Array<{ sequence: number; artifact: string }>;
    nativeUi: Array<{ sequence: number; artifact: string }>;
    sourceDump: string | null;
    domIncluded: boolean | null;
  };
  rejectedEvaluatorModalities: Array<{ modality: MacEvaluatorModality; reason: string }>;
  recommendedSettle: {
    timeoutMs: number;
    intervalMs: number;
    consecutiveMatches: number;
    replacesWaitStepId: string | null;
  } | null;
};

export type MacObservationPlan = {
  schemaVersion: 1;
  recordingId: string | null;
  platform: "macos";
  selectedSequenceRange: { from: number; to: number } | null;
  status: "requires-evaluator" | "uncompilable" | "no-observations";
  observations: MacObservationPlanItem[];
};

export type MacObservationDecisionRecord = {
  schemaVersion?: number;
  selectedSequenceRange?: { from: number; to: number };
  decisions?: Array<{
    observationTaskId?: string;
    recordedMode?: string;
    evaluatorModality?: string;
    compiledEvaluator?: string;
    evidence?: Array<{ sequence?: number; artifact?: string }>;
  }>;
};

type DumpFact = { domIncluded: boolean | null; hasScreenshotContext: boolean };

const KNOWN_EVALUATOR_MODALITIES: Record<string, MacEvaluatorModality> = {
  "apple-vision-ocr": "visual",
  "bounded-red-pixel-classifier": "visual",
  "recorded-screenshot-region-comparison": "visual",
  "recorded-screenshot-contrastive-comparison": "visual",
  "visual-ai": "visual",
  "macos-ax": "native-ui",
  dom: "dom",
};

export async function compileMacObservationPlanFile(
  input: string,
  output: string,
  sequenceRange?: { from: number; to: number },
): Promise<MacObservationPlan> {
  const loaded = await loadRecordingInput(input);
  const range = sequenceRange ?? loaded.sequenceRange;
  const events = filterRange(loaded.events, range);
  const dumpFacts = await loadDumpFacts(events, loaded.recordingDir);
  const plan = compileMacObservationPlan(events, dumpFacts, {
    recordingId: loaded.recordingId,
    sequenceRange: range,
  });
  await writeFile(resolve(output), `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  return plan;
}

export async function validateMacObservationDecisionsFile(
  input: string,
  decisionsPath: string,
): Promise<{ valid: true; observationCount: number }> {
  const decisions = JSON.parse(await readFile(resolve(decisionsPath), "utf8")) as MacObservationDecisionRecord;
  const loaded = await loadRecordingInput(input);
  const range = decisions.selectedSequenceRange ?? loaded.sequenceRange;
  const events = filterRange(loaded.events, range);
  const facts = await loadDumpFacts(events, loaded.recordingDir);
  const plan = compileMacObservationPlan(events, facts, {
    recordingId: loaded.recordingId,
    sequenceRange: range,
  });
  validateMacObservationDecisions(plan, decisions);
  return { valid: true, observationCount: plan.observations.length };
}

export function compileMacObservationPlan(
  events: RecordingEvent[],
  dumpFacts: Map<string, DumpFact> = new Map(),
  provenance: { recordingId?: string; sequenceRange?: { from: number; to: number } } = {},
): MacObservationPlan {
  const observations = events
    .filter((event) => event.kind === "observation.completed")
    .map((event) => compileObservation(events, event, dumpFacts.get(event.taskId ?? "")));
  const status = observations.length === 0
    ? "no-observations"
    : observations.some((item) => item.status === "uncompilable")
      ? "uncompilable"
      : "requires-evaluator";
  return {
    schemaVersion: 1,
    recordingId: provenance.recordingId ?? events.find((event) => event.recordingId)?.recordingId ?? null,
    platform: "macos",
    selectedSequenceRange: provenance.sequenceRange ?? eventRange(events),
    status,
    observations,
  };
}

export function validateMacObservationDecisions(
  plan: MacObservationPlan,
  record: MacObservationDecisionRecord,
): void {
  if (!Array.isArray(record.decisions)) throw new Error("Observation decision record is missing decisions[]");
  for (const observation of plan.observations) {
    const decision = record.decisions.find((item) => item.observationTaskId === observation.observationTaskId);
    if (!decision) throw new Error(`Missing decision for observation ${observation.observationTaskId}`);
    if (decision.recordedMode !== observation.recordedMode) {
      throw new Error(
        `Observation ${observation.observationTaskId} recordedMode must be ${observation.recordedMode}, got ${String(decision.recordedMode)}`,
      );
    }
    const modality = resolveEvaluatorModality(decision);
    if (!observation.allowedEvaluatorModalities.includes(modality)) {
      throw new Error(
        `Observation ${observation.observationTaskId} recorded as ${observation.recordedMode} cannot use ${modality} evaluator`,
      );
    }
    if (observation.status === "uncompilable") {
      throw new Error(`Observation ${observation.observationTaskId} has no trustworthy recorded evidence`);
    }
    const recordedArtifacts = new Set([
      ...observation.evidence.screenshots.map((item) => item.artifact),
      ...observation.evidence.nativeUi.map((item) => item.artifact),
    ]);
    const claimedArtifacts = decision.evidence?.map((item) => item.artifact).filter(Boolean) as string[] | undefined;
    if (!claimedArtifacts?.some((artifact) => recordedArtifacts.has(artifact))) {
      throw new Error(`Observation ${observation.observationTaskId} decision does not cite its recorded evidence`);
    }
  }
}

function compileObservation(
  events: RecordingEvent[],
  event: RecordingEvent,
  dumpFact?: DumpFact,
): MacObservationPlanItem {
  if (!event.taskId || !Number.isInteger(event.sequence)) {
    throw new Error("An observation.completed event is missing taskId or sequence");
  }
  const window = observationWindow(events, event.sequence as number);
  const explicitScreenshots = event.evidence?.screenshots
    ?.filter((candidate) => Number.isInteger(candidate.sequence) && candidate.artifact?.path)
    .map((candidate) => ({ sequence: candidate.sequence as number, artifact: candidate.artifact!.path! })) ?? [];
  const screenshots = explicitScreenshots.length
    ? explicitScreenshots
    : window
      .filter((candidate) => candidate.kind === "observation.screenshot" && candidate.artifact?.path)
      .map((candidate) => ({ sequence: candidate.sequence as number, artifact: candidate.artifact!.path! }));
  const nativeUi = window
    .filter((candidate) => candidate.kind === "checkpoint.captured" &&
      candidate.evidence?.nativeUi?.status === "available" && candidate.evidence.nativeUi.artifact?.path)
    .map((candidate) => ({
      sequence: candidate.sequence as number,
      artifact: candidate.evidence!.nativeUi!.artifact!.path!,
    }));
  const domIncluded = typeof event.evidence?.domIncluded === "boolean"
    ? event.evidence.domIncluded
    : dumpFact?.domIncluded ?? null;
  const hasVisual = event.evidenceSource === "screenshot" ||
    screenshots.length > 0 || dumpFact?.hasScreenshotContext === true;
  const recordedMode: MacObservationMode = domIncluded === true
    ? "dom"
    : hasVisual
      ? "visual"
      : nativeUi.length > 0
        ? "native-ui"
        : "unknown";
  const allowedEvaluatorModalities: MacEvaluatorModality[] = recordedMode === "visual"
    ? ["visual"]
    : recordedMode === "dom"
      ? ["dom"]
      : recordedMode === "native-ui"
        ? ["native-ui"]
        : [];
  const reasons: Record<MacEvaluatorModality, string> = {
    visual: "the recorded observation has no screenshot-backed evidence",
    dom: domIncluded === false
      ? "the Midscene task declared domIncluded=false"
      : "the recorded observation has no DOM evidence",
    "native-ui": "the observation window contains no available native UI snapshot",
  };
  const currentStepStart = events
    .filter((candidate) => candidate.kind === "benchmark.step.started" &&
      Number.isInteger(candidate.sequence) && candidate.sequence! < event.sequence!)
    .at(-1)?.sequence ?? event.sequence!;
  const priorStep = events
    .filter((candidate) => candidate.kind === "benchmark.step.completed" &&
      Number.isInteger(candidate.sequence) && candidate.sequence! < currentStepStart)
    .at(-1);
  const recordedWaitMs = priorStep?.stepKind === "wait" &&
    typeof priorStep.durationMs === "number" && priorStep.durationMs > 0
    ? Math.ceil(priorStep.durationMs)
    : null;
  return {
    observationTaskId: event.taskId,
    sequence: event.sequence as number,
    operation: event.operation ?? null,
    prompt: event.prompt ?? null,
    recordedResult: event.result,
    recordedMode,
    status: allowedEvaluatorModalities.length ? "requires-evaluator" : "uncompilable",
    allowedEvaluatorModalities,
    evidence: {
      screenshots: screenshots.length ? [screenshots.at(-1)!] : [],
      nativeUi,
      sourceDump: event.sourceDumpArtifact?.path ?? null,
      domIncluded,
    },
    rejectedEvaluatorModalities: (["visual", "dom", "native-ui"] as const)
      .filter((modality) => !allowedEvaluatorModalities.includes(modality))
      .map((modality) => ({ modality, reason: reasons[modality] })),
    recommendedSettle: recordedWaitMs === null ? null : {
      timeoutMs: recordedWaitMs,
      intervalMs: Math.min(200, Math.max(50, Math.ceil(recordedWaitMs / 20))),
      consecutiveMatches: recordedMode === "visual" ? 2 : 1,
      replacesWaitStepId: priorStep?.stepId ?? null,
    },
  };
}

function observationWindow(events: RecordingEvent[], sequence: number): RecordingEvent[] {
  const priorStep = events
    .filter((event) => event.kind === "benchmark.step.started" && Number.isInteger(event.sequence) && event.sequence! < sequence)
    .at(-1)?.sequence ?? -1;
  return events.filter((event) => Number.isInteger(event.sequence) && event.sequence! > priorStep && event.sequence! <= sequence);
}

function resolveEvaluatorModality(
  decision: NonNullable<MacObservationDecisionRecord["decisions"]>[number],
): MacEvaluatorModality {
  const inferred = decision.compiledEvaluator && KNOWN_EVALUATOR_MODALITIES[decision.compiledEvaluator];
  if (!inferred) {
    throw new Error(
      `Unknown compiled evaluator ${JSON.stringify(decision.compiledEvaluator)}; register it in the runtime before use`,
    );
  }
  if (decision.evaluatorModality !== undefined && decision.evaluatorModality !== inferred) {
    throw new Error(
      `Evaluator ${decision.compiledEvaluator} is registered as ${inferred}, not ${decision.evaluatorModality}`,
    );
  }
  return inferred;
}

async function loadDumpFacts(events: RecordingEvent[], recordingDir?: string): Promise<Map<string, DumpFact>> {
  const result = new Map<string, DumpFact>();
  if (!recordingDir) return result;
  await Promise.all(events.filter((event) => event.kind === "observation.completed" && event.taskId)
    .map(async (event) => {
      const artifact = event.sourceDumpArtifact?.path;
      if (!artifact) return;
      const dump = JSON.parse(await readFile(join(recordingDir, artifact), "utf8"));
      const task = findObject(dump, (value) => value.taskId === event.taskId);
      if (!task) return;
      result.set(event.taskId!, {
        domIncluded: typeof task.param?.domIncluded === "boolean" ? task.param.domIncluded : null,
        hasScreenshotContext: Boolean(task.uiContext?.screenshot),
      });
    }));
  return result;
}

function findObject(value: unknown, predicate: (value: Record<string, any>) => boolean): Record<string, any> | undefined {
  if (!value || typeof value !== "object") return undefined;
  if (!Array.isArray(value) && predicate(value as Record<string, any>)) return value as Record<string, any>;
  for (const child of Array.isArray(value) ? value : Object.values(value)) {
    const found = findObject(child, predicate);
    if (found) return found;
  }
  return undefined;
}

async function loadRecordingInput(input: string): Promise<{
  events: RecordingEvent[];
  recordingDir?: string;
  recordingId?: string;
  sequenceRange?: { from: number; to: number };
}> {
  const path = resolve(input);
  const inputStat = await stat(path);
  if (inputStat.isDirectory()) {
    const manifest = JSON.parse(await readFile(join(path, "manifest.json"), "utf8"));
    if (manifest.status === "recording") throw new Error("Refusing to compile an active recording");
    return {
      events: parseNdjson(await readFile(join(path, "events.ndjson"), "utf8")),
      recordingDir: path,
      recordingId: manifest.recordingId,
    };
  }
  if (path.endsWith(".ndjson")) {
    return { events: parseNdjson(await readFile(path, "utf8")), recordingDir: dirname(path) };
  }
  const segment = JSON.parse(await readFile(path, "utf8"));
  if (!Array.isArray(segment.events)) throw new Error(`${path} does not contain an events array`);
  return {
    events: segment.events,
    recordingDir: segment.source?.recordingDir ? resolve(dirname(path), segment.source.recordingDir) : undefined,
    recordingId: segment.source?.recordingId,
    sequenceRange: segment.source?.sequenceRange,
  };
}

function filterRange(events: RecordingEvent[], range?: { from: number; to: number }): RecordingEvent[] {
  if (!range) return events;
  return events.filter((event) => Number.isInteger(event.sequence) && event.sequence! >= range.from && event.sequence! <= range.to);
}

function eventRange(events: RecordingEvent[]): { from: number; to: number } | null {
  const sequences = events.map((event) => event.sequence).filter(Number.isInteger) as number[];
  return sequences.length ? { from: Math.min(...sequences), to: Math.max(...sequences) } : null;
}

function parseNdjson(source: string): RecordingEvent[] {
  return source.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}
