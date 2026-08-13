#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const directory = args[0];
function option(name) {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
}
const from = Number(option("--from"));
const to = Number(option("--to"));
const output = option("--output");
if (!directory || !Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from || !output) {
  console.error("Usage: extract-segment.mjs <recording-directory> --from N --to N --output segment.json");
  process.exit(2);
}

const root = resolve(directory);
const manifest = JSON.parse(await readFile(`${root}/manifest.json`, "utf8"));
if (manifest.status === "recording") throw new Error("Refusing to extract an active recording");
const events = (await readFile(`${root}/events.ndjson`, "utf8"))
  .split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line))
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
    sequenceRange: { from, to },
  },
  events,
  artifacts: [...artifacts.values()],
};
await writeFile(resolve(output), `${JSON.stringify(segment, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ output: resolve(output), eventCount: events.length, artifactCount: artifacts.size }, null, 2));
