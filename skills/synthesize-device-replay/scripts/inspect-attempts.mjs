#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { attemptSummary, indexRecordingAttempts } from "./recording-attempts.mjs";

const directory = process.argv[2];
if (!directory || process.argv.includes("--help")) {
  console.error("Usage: inspect-attempts.mjs <recording-directory>");
  process.exit(directory ? 0 : 2);
}

const root = resolve(directory);
const events = (await readFile(`${root}/events.ndjson`, "utf8"))
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`events.ndjson line ${index + 1} is invalid JSON: ${error.message}`);
    }
  });
const attempts = indexRecordingAttempts(events);
const duplicateSequences = duplicateValues(events.map((event) => event.sequence).filter(Number.isInteger));

console.log(JSON.stringify({
  attemptCount: attempts.length,
  globallyUniqueSequences: duplicateSequences.length === 0,
  duplicateSequences,
  selectionRequired: attempts.length > 1,
  attempts: attempts.map(attemptSummary),
}, null, 2));

function duplicateValues(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].filter(([, count]) => count > 1).map(([value]) => value);
}
