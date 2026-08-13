#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { relative, resolve } from "node:path";

const directory = process.argv[2];
if (!directory || process.argv.includes("--help")) {
  console.error("Usage: verify-recording.mjs <recording-directory>");
  process.exit(directory ? 0 : 2);
}

const root = resolve(directory);
const errors = [];
const warnings = [];

async function json(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

let manifest;
let events = [];
try {
  manifest = await json(`${root}/manifest.json`);
} catch (error) {
  errors.push(`Cannot read manifest.json: ${error.message}`);
}

try {
  const text = await readFile(`${root}/events.ndjson`, "utf8");
  events = text.split(/\r?\n/).filter(Boolean).map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      errors.push(`Invalid JSON at events.ndjson line ${index + 1}: ${error.message}`);
      return null;
    }
  }).filter(Boolean);
} catch (error) {
  errors.push(`Cannot read events.ndjson: ${error.message}`);
}

for (let index = 0; index < events.length; index += 1) {
  if (events[index].sequence !== index) {
    warnings.push(`Expected sequence ${index}, found ${events[index].sequence}`);
  }
}

const artifactRefs = new Map();
function visit(value) {
  if (!value || typeof value !== "object") return;
  if (typeof value.path === "string" && typeof value.sha256 === "string") {
    artifactRefs.set(value.path, value);
  }
  for (const child of Object.values(value)) visit(child);
}
for (const event of events) visit(event);

for (const [path, ref] of artifactRefs) {
  try {
    const absolute = resolve(root, path);
    const relativePath = relative(root, absolute);
    if (relativePath.startsWith("..") || relativePath === "") {
      throw new Error("artifact path escapes the recording directory");
    }
    const info = await stat(absolute);
    if (typeof ref.size === "number" && ref.size !== info.size) {
      errors.push(`Artifact size mismatch: ${path}`);
    }
    const bytes = await readFile(absolute);
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (digest !== ref.sha256) errors.push(`Artifact hash mismatch: ${path}`);
  } catch (error) {
    errors.push(`Missing artifact ${path}: ${error.message}`);
  }
}

if (manifest?.eventCount !== undefined && manifest.eventCount !== events.length) {
  errors.push(`Manifest eventCount ${manifest.eventCount} != ${events.length}`);
}
if (manifest?.status === "recording") warnings.push("Manifest is still recording");
if (manifest?.integrity === "incomplete") warnings.push("Manifest integrity is incomplete");

const counts = Object.create(null);
for (const event of events) counts[event.kind ?? "<missing-kind>"] = (counts[event.kind ?? "<missing-kind>"] ?? 0) + 1;

console.log(JSON.stringify({
  valid: errors.length === 0,
  recordingId: manifest?.recordingId ?? null,
  status: manifest?.status ?? null,
  integrity: manifest?.integrity ?? null,
  platform: manifest?.platform ?? null,
  sources: manifest?.sources ?? [],
  eventCount: events.length,
  artifactCount: artifactRefs.size,
  eventKinds: counts,
  errors,
  warnings,
}, null, 2));

if (errors.length) process.exit(1);
