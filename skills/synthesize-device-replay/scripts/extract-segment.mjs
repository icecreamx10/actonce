#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { attemptSummary, indexRecordingAttempts, selectAttempt } from "./recording-attempts.mjs";

const args = process.argv.slice(2);
const directory = args[0];
function option(name) {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
}
const from = Number(option("--from"));
const to = Number(option("--to"));
const output = option("--output");
const attemptKey = option("--attempt");
if (!directory || !Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from || !output) {
  console.error("Usage: extract-segment.mjs <recording-directory> [--attempt KEY] --from N --to N --output segment.json");
  process.exit(2);
}

const root = resolve(directory);
const manifest = JSON.parse(await readFile(`${root}/manifest.json`, "utf8"));
if (manifest.status === "recording") throw new Error("Refusing to extract an active recording");
const allEvents = (await readFile(`${root}/events.ndjson`, "utf8"))
  .split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
const attempts = indexRecordingAttempts(allEvents);
let attempt;
try {
  attempt = selectAttempt(attempts, attemptKey);
} catch (error) {
  fail(error.message);
}
if (!attempt.sequenceUnique) {
  fail(`Attempt ${attempt.key} contains duplicate sequences: ${attempt.duplicateSequences.join(", ")}`);
}
const events = attempt.events
  .map((event, index) => ({ ...event, recordingAppendIndex: attempt.appendIndexRange.from + index }))
  .filter((event) => event.sequence >= from && event.sequence <= to);

if (!events.length) throw new Error(`No events in sequence range ${from}..${to}`);
const artifacts = new Map();
function visit(value) {
  if (!value || typeof value !== "object") return;
  if (typeof value.path === "string" && typeof value.sha256 === "string") artifacts.set(value.path, value);
  for (const child of Object.values(value)) visit(child);
}
for (const event of events) visit(event);

const segment = {
  schemaVersion: 1,
  kind: "actonce.recording-segment",
  source: {
    recordingId: manifest.recordingId,
    recordingDirectory: root,
    platform: manifest.platform,
    attempt: attemptSummary(attempt),
    sequenceRange: { from, to },
  },
  events,
  artifacts: [...artifacts.values()],
};
await writeFile(resolve(output), `${JSON.stringify(segment, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  output: resolve(output),
  attempt: attempt.key,
  eventCount: events.length,
  artifactCount: artifacts.size,
}, null, 2));

function fail(message) {
  console.error(`Attempt isolation failed: ${message}`);
  process.exit(1);
}
