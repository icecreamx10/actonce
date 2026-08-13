#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";

const directory = process.argv[2];
if (!directory || process.argv.includes("--help")) {
  console.error("Usage: summarize-recording.mjs <recording-directory>");
  process.exit(directory ? 0 : 2);
}

const root = resolve(directory);
const manifest = JSON.parse(await readFile(`${root}/manifest.json`, "utf8"));
const events = (await readFile(`${root}/events.ndjson`, "utf8"))
  .split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));

const sensitiveName = /authorization|cookie|api[-_]?key|password|passwd|secret|access[-_]?token/i;
function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== "object") return value;
  const headerName = typeof value.name === "string" ? value.name : "";
  const result = {};
  for (const [key, child] of Object.entries(value)) {
    if (sensitiveName.test(key) || (key === "value" && sensitiveName.test(headerName))) {
      result[key] = "[REDACTED]";
    } else {
      result[key] = sanitize(child);
    }
  }
  return result;
}

const kinds = Object.create(null);
for (const event of events) kinds[event.kind ?? "<missing-kind>"] = (kinds[event.kind ?? "<missing-kind>"] ?? 0) + 1;

const actionMap = new Map();
for (const event of events) {
  const id = event.correlation?.logicalActionId ?? event.logicalActionId ?? event.actionId;
  if (!id) continue;
  const action = actionMap.get(id) ?? { actionId: id, traceId: event.correlation?.traceId ?? null, from: event.sequence, to: event.sequence, operation: null, events: [] };
  action.from = Math.min(action.from, event.sequence);
  action.to = Math.max(action.to, event.sequence);
  action.operation ??= event.operation ?? null;
  action.events.push({ sequence: event.sequence, kind: event.kind, operation: event.operation ?? null, source: event.source?.type ?? event.origin ?? null });
  actionMap.set(id, action);
}

const checkpoints = events.filter((event) => event.kind === "checkpoint.captured").map((event) => ({
  sequence: event.sequence,
  captureId: event.captureId,
  actionId: event.actionId,
  phase: event.phase,
  screenshot: event.evidence?.screenshot?.path ?? null,
  nativeUi: event.evidence?.nativeUi?.status ?? null,
}));

let midscene = [];
const dumpEvents = events.filter((event) => event.kind === "midscene.execution-dump.updated" && event.artifact?.path);
if (dumpEvents.length) {
  try {
    const latest = dumpEvents.at(-1);
    const dumpPath = resolve(root, latest.artifact.path);
    if (relative(root, dumpPath).startsWith("..")) throw new Error("artifact path escapes the recording directory");
    const dump = JSON.parse(await readFile(dumpPath, "utf8"));
    midscene = (dump.executions ?? []).map((execution) => ({
      id: execution.id,
      name: execution.name,
      tasks: (execution.tasks ?? []).map((task) => ({
        status: task.status,
        type: task.type,
        subType: task.subType,
        param: sanitize(task.param),
        output: sanitize(task.output),
        timing: task.timing,
      })),
    }));
  } catch (error) {
    midscene = [{ error: `Unable to parse latest Midscene dump: ${error.message}` }];
  }
}

console.log(JSON.stringify({
  recording: {
    recordingId: manifest.recordingId,
    platform: manifest.platform,
    status: manifest.status,
    integrity: manifest.integrity,
    startedAt: manifest.startedAt,
    completedAt: manifest.completedAt,
    metadata: sanitize(manifest.metadata),
    sources: manifest.sources ?? [],
  },
  eventCount: events.length,
  sequenceRange: events.length ? [events[0].sequence, events.at(-1).sequence] : null,
  kinds,
  actions: [...actionMap.values()],
  checkpoints,
  midscene,
}, null, 2));
