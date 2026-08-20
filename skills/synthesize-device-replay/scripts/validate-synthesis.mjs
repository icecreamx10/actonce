#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const recordingDirectory = args[0];
const ledgerPath = option("--ledger");
const planPath = option("--plan");

if (!recordingDirectory || !ledgerPath || args.includes("--help")) {
  console.error(
    "Usage: validate-synthesis.mjs <recording-directory> --ledger synthesis-ledger.json [--plan replay-plan.json]",
  );
  process.exit(args.includes("--help") ? 0 : 2);
}

function option(name) {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
}

const root = resolve(recordingDirectory);
const manifest = await json(`${root}/manifest.json`);
const events = (await readFile(`${root}/events.ndjson`, "utf8"))
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`events.ndjson line ${index + 1} is invalid JSON: ${message(error)}`);
    }
  });
const ledger = await json(resolve(ledgerPath));
const errors = [];

if (manifest.status !== "complete") errors.push(`recording manifest status is ${String(manifest.status)}, expected complete`);
if (ledger.schemaVersion !== 1) errors.push("ledger.schemaVersion must be 1");
if (ledger.kind !== "actonce.replay-synthesis-ledger") {
  errors.push("ledger.kind must be actonce.replay-synthesis-ledger");
}
if (!nonEmpty(ledger.recordingId) || ledger.recordingId !== manifest.recordingId) {
  errors.push(`ledger.recordingId must equal manifest.recordingId (${String(manifest.recordingId)})`);
}

const range = ledger.selectedSequenceRange;
if (!isRange(range)) errors.push("ledger.selectedSequenceRange must contain integer from/to with 0 <= from <= to");
const selectedEvents = isRange(range)
  ? events.filter((event) => event.sequence >= range.from && event.sequence <= range.to)
  : [];
if (isRange(range) && selectedEvents.length === 0) errors.push("selected sequence range contains no events");

const eventBySequence = new Map();
for (const event of events) {
  if (!Number.isInteger(event.sequence)) {
    errors.push("every recorded event must have an integer sequence");
    continue;
  }
  if (eventBySequence.has(event.sequence)) errors.push(`duplicate recording sequence ${event.sequence}`);
  eventBySequence.set(event.sequence, event);
}
const selectedEventBySequence = new Map(selectedEvents.map((event) => [event.sequence, event]));

const completedActions = new Map();
for (const event of selectedEvents) {
  if (event.kind !== "logical.action.completed") continue;
  const actionId = event.correlation?.logicalActionId ?? event.logicalActionId ?? event.actionId;
  if (!nonEmpty(actionId)) {
    errors.push(`logical.action.completed at sequence ${event.sequence} has no action ID`);
    continue;
  }
  if (completedActions.has(actionId)) errors.push(`logical action ${actionId} completed more than once in selected range`);
  completedActions.set(actionId, event);
}
if (completedActions.size === 0) errors.push("selected range has no completed top-level logical actions");

const segments = Array.isArray(ledger.segments) ? ledger.segments : [];
const exclusions = Array.isArray(ledger.exclusions) ? ledger.exclusions : [];
if (!Array.isArray(ledger.segments) || segments.length === 0) errors.push("ledger.segments must be a non-empty array");
if (!Array.isArray(ledger.exclusions)) errors.push("ledger.exclusions must be an array");

const segmentIds = new Set();
const coveredActions = new Map();
let previousActionSequence = -1;

for (const [index, segment] of segments.entries()) {
  const at = `ledger.segments[${index}]`;
  if (!isObject(segment)) {
    errors.push(`${at} must be an object`);
    continue;
  }
  if (!nonEmpty(segment.id)) errors.push(`${at}.id must be a non-empty string`);
  else if (segmentIds.has(segment.id)) errors.push(`duplicate segment id ${segment.id}`);
  else segmentIds.add(segment.id);
  if (segment.kind !== "action" && segment.kind !== "observation") {
    errors.push(`${at}.kind must be action or observation`);
  }
  if (!nonEmpty(segment.rationale)) errors.push(`${at}.rationale must record the agent's decision`);
  if (!["safe", "observe-before-retry", "never-retry"].includes(segment.idempotency)) {
    errors.push(`${at}.idempotency must be safe, observe-before-retry, or never-retry`);
  }
  validateCheckpointDecision(segment.precondition, `${at}.precondition`, selectedEventBySequence, errors);
  validateCheckpointDecision(segment.postcondition, `${at}.postcondition`, selectedEventBySequence, errors);

  if (segment.kind === "action") {
    if (!nonEmpty(segment.actionId)) {
      errors.push(`${at}.actionId must identify exactly one recorded logical action`);
      continue;
    }
    if (coveredActions.has(segment.actionId)) {
      errors.push(`logical action ${segment.actionId} is assigned more than once`);
      continue;
    }
    const action = completedActions.get(segment.actionId);
    if (!action) {
      errors.push(`${at}.actionId ${segment.actionId} is not a completed logical action in the selected range`);
      continue;
    }
    coveredActions.set(segment.actionId, `segment ${segment.id}`);
    if (action.sequence <= previousActionSequence) errors.push(`${at} is not ordered by recorded action sequence`);
    previousActionSequence = action.sequence;
    if (segment.recordedOperation !== action.operation) {
      errors.push(`${at}.recordedOperation must equal recorded ${String(action.operation)}`);
    }
    const expectedOperation = expectedLoweredOperation(manifest.platform, action.operation);
    if (!expectedOperation) {
      errors.push(`${at} recorded operation ${String(action.operation)} has no supported ${String(manifest.platform)} lowering`);
    } else if (segment.loweredOperation !== expectedOperation) {
      errors.push(`${at}.loweredOperation must be ${expectedOperation} for recorded ${String(action.operation)}`);
    }
    validateActionCheckpoint(segment.precondition, `${at}.precondition`, segment.actionId, "before-action", selectedEventBySequence, errors);
    validateActionCheckpoint(segment.postcondition, `${at}.postcondition`, segment.actionId, "after-action", selectedEventBySequence, errors);
  } else {
    if (segment.actionId !== undefined && segment.actionId !== null) {
      errors.push(`${at}.actionId must be omitted for an observation segment`);
    }
    if (segment.loweredOperation !== "noop") errors.push(`${at}.loweredOperation must be noop for an observation segment`);
  }
}

for (const [index, exclusion] of exclusions.entries()) {
  const at = `ledger.exclusions[${index}]`;
  if (!isObject(exclusion) || !nonEmpty(exclusion.actionId)) {
    errors.push(`${at}.actionId must be a non-empty string`);
    continue;
  }
  if (coveredActions.has(exclusion.actionId)) {
    errors.push(`logical action ${exclusion.actionId} is assigned more than once`);
    continue;
  }
  const action = completedActions.get(exclusion.actionId);
  if (!action) {
    errors.push(`${at}.actionId ${exclusion.actionId} is not a completed logical action in the selected range`);
    continue;
  }
  coveredActions.set(exclusion.actionId, "exclusion");
  if (exclusion.sequence !== action.sequence) errors.push(`${at}.sequence must equal recorded ${action.sequence}`);
  if (exclusion.operation !== action.operation) errors.push(`${at}.operation must equal recorded ${String(action.operation)}`);
  if (!nonEmpty(exclusion.reason) || exclusion.reason.length < 12) {
    errors.push(`${at}.reason must be a concrete evidence-based explanation`);
  }
  validateEvidence(exclusion.evidence, `${at}.evidence`, selectedEventBySequence, errors);
}

for (const actionId of completedActions.keys()) {
  if (!coveredActions.has(actionId)) errors.push(`completed logical action ${actionId} is neither replayed nor explicitly excluded`);
}

let plan;
if (planPath) {
  plan = await json(resolve(planPath));
  validatePlan(plan, ledger, segments, manifest.platform, errors);
}

if (errors.length) {
  console.error(JSON.stringify({ status: "invalid", errorCount: errors.length, errors }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  status: "valid",
  phase: planPath ? "executable-plan" : "pre-lowering",
  recordingId: manifest.recordingId,
  selectedSequenceRange: range,
  completedActionCount: completedActions.size,
  replayedActionCount: segments.filter((segment) => segment.kind === "action").length,
  observationSegmentCount: segments.filter((segment) => segment.kind === "observation").length,
  exclusionCount: exclusions.length,
  planSegmentCount: plan?.segments?.length ?? null,
}, null, 2));

function validatePlan(candidate, sourceLedger, sourceSegments, platform, target) {
  if (!isObject(candidate)) {
    target.push("plan must be an object");
    return;
  }
  if (candidate.schemaVersion !== 1) target.push("plan.schemaVersion must be 1");
  if (candidate.recordingId !== sourceLedger.recordingId) target.push("plan.recordingId must equal ledger.recordingId");
  if (candidate.platform !== platform) target.push(`plan.platform must equal recording platform ${String(platform)}`);
  if (!Number.isInteger(candidate.version) || candidate.version < 1) target.push("plan.version must be an integer >= 1");
  if (!Array.isArray(candidate.segments)) {
    target.push("plan.segments must be an array");
    return;
  }
  if (candidate.segments.length !== sourceSegments.length) {
    target.push(`plan must contain exactly ${sourceSegments.length} ledger-authored segments, got ${candidate.segments.length}`);
  }
  const count = Math.min(candidate.segments.length, sourceSegments.length);
  for (let index = 0; index < count; index += 1) {
    const planSegment = candidate.segments[index];
    const ledgerSegment = sourceSegments[index];
    const at = `plan.segments[${index}]`;
    if (!isObject(planSegment)) {
      target.push(`${at} must be an object`);
      continue;
    }
    if (planSegment.id !== ledgerSegment.id) target.push(`${at}.id must equal ledger segment ${ledgerSegment.id}`);
    if (planSegment.fallback !== undefined) target.push(`${at}.fallback is forbidden in deterministic replay`);
    if (planSegment.idempotency !== ledgerSegment.idempotency) {
      target.push(`${at}.idempotency must equal ledger value ${ledgerSegment.idempotency}`);
    }
    validatePlanCheckpoint(planSegment.precondition, ledgerSegment.precondition, `${at}.precondition`, target);
    validatePlanCheckpoint(planSegment.postcondition, ledgerSegment.postcondition, `${at}.postcondition`, target);
    if (!isObject(planSegment.action) || !nonEmpty(planSegment.action.operation) || !Array.isArray(planSegment.action.arguments)) {
      target.push(`${at}.action must be { operation: string, arguments: unknown[] }`);
    } else if (planSegment.action.operation !== ledgerSegment.loweredOperation) {
      target.push(`${at}.action.operation must equal ledger loweredOperation ${ledgerSegment.loweredOperation}`);
    }
  }
}

function validatePlanCheckpoint(checkpoint, decision, at, target) {
  if (!isObject(checkpoint)) {
    target.push(`${at} must be an object`);
    return;
  }
  if (checkpoint.id !== decision?.checkpointId) target.push(`${at}.id must equal ledger checkpointId ${String(decision?.checkpointId)}`);
  if (!("expected" in checkpoint) || !meaningful(checkpoint.expected)) {
    target.push(`${at}.expected must be a non-empty state assertion`);
  }
}

function validateCheckpointDecision(decision, at, sequenceMap, target) {
  if (!isObject(decision)) {
    target.push(`${at} must be an object`);
    return;
  }
  if (!nonEmpty(decision.checkpointId)) target.push(`${at}.checkpointId must be a non-empty string`);
  validateEvidence(decision.evidence, `${at}.evidence`, sequenceMap, target);
  if (!Array.isArray(decision.facts) || decision.facts.length === 0 || decision.facts.some((fact) => !nonEmpty(fact))) {
    target.push(`${at}.facts must contain concrete agent-verified facts`);
  }
}

function validateEvidence(evidence, at, sequenceMap, target) {
  if (!Array.isArray(evidence) || evidence.length === 0) {
    target.push(`${at} must cite at least one recorded event`);
    return;
  }
  for (const [index, citation] of evidence.entries()) {
    if (!isObject(citation) || !Number.isInteger(citation.sequence) || !sequenceMap.has(citation.sequence)) {
      target.push(`${at}[${index}] must cite an existing integer sequence`);
    }
    if (!isObject(citation) || !nonEmpty(citation.modality)) {
      target.push(`${at}[${index}].modality must name the recorded evidence modality`);
    }
  }
}

function validateActionCheckpoint(decision, at, actionId, phase, sequenceMap, target) {
  if (!isObject(decision) || !Array.isArray(decision.evidence)) return;
  const matched = decision.evidence.some((citation) => {
    const event = sequenceMap.get(citation?.sequence);
    const eventActionId = event?.correlation?.logicalActionId ?? event?.logicalActionId ?? event?.actionId;
    return event?.kind === "checkpoint.captured" && event.phase === phase && eventActionId === actionId;
  });
  if (!matched) target.push(`${at} must cite this action's own ${phase} checkpoint.captured event`);
}

async function json(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(`Unable to read JSON ${path}: ${message(error)}`);
  }
}

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRange(value) {
  return isObject(value) && Number.isInteger(value.from) && Number.isInteger(value.to) && value.from >= 0 && value.to >= value.from;
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function meaningful(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (isObject(value)) return Object.keys(value).length > 0;
  return true;
}

function expectedLoweredOperation(platform, recordedOperation) {
  const mobile = {
    Tap: "tap",
    DoubleClick: "doubleClick",
    LongPress: "longPress",
    Swipe: "swipe",
    DragAndDrop: "dragAndDrop",
    Input: "typeText",
    KeyboardPress: "keyboardPress",
    ClearInput: "clearInput",
    Scroll: "scroll",
  };
  const android = {
    ...mobile,
    AndroidBackButton: "back",
    AndroidHomeButton: "home",
    AndroidRecentAppsButton: "recentApps",
  };
  const macos = {
    Tap: "tap",
    DoubleClick: "doubleClick",
    RightClick: "rightClick",
    Hover: "hover",
    DragAndDrop: "dragAndDrop",
    Input: "typeText",
    KeyboardPress: "keyboardPress",
    ClearInput: "clearInput",
    Scroll: "scroll",
  };
  const mapping = platform === "android" ? android : platform === "ios" ? mobile : platform === "macos" ? macos : {};
  return mapping[recordedOperation];
}

function message(error) {
  return error instanceof Error ? error.message : String(error);
}
