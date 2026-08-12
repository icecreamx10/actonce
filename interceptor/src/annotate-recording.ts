import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import {
  annotateWdaRequest,
  normalizeWdaTarget,
} from "./protocol-catalog.js";

type RawRequestStartedEvent = {
  recordingId: string;
  sequence: number;
  kind: "http.request.started";
  requestId: string;
  http: {
    method: string;
    target: string;
  };
};

const requestedDirectory = process.argv[2];
if (!requestedDirectory) {
  console.error(
    "Usage: npm run interceptor:annotate -- <recording-directory>",
  );
  process.exit(2);
}

const recordingDirectory = resolve(requestedDirectory);
const eventsPath = join(recordingDirectory, "events.ndjson");
const derivedDirectory = join(recordingDirectory, "derived");
const outputPath = join(derivedDirectory, "protocol-annotations.ndjson");
const temporaryPath = `${outputPath}.tmp`;
const input = await readFile(eventsPath, "utf8");
const events = input
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line) as unknown);

const requests = events.filter(isRawRequestStartedEvent);
const annotations = requests.map((event) => ({
  schemaVersion: 1,
  recordingId: event.recordingId,
  sourceEventSequence: event.sequence,
  requestId: event.requestId,
  method: event.http.method,
  target: event.http.target,
  normalizedTarget: normalizeWdaTarget(event.http.target),
  annotation: annotateWdaRequest(event.http.method, event.http.target),
}));

await mkdir(derivedDirectory, { recursive: true });
await writeFile(
  temporaryPath,
  annotations.map((annotation) => JSON.stringify(annotation)).join("\n") +
    (annotations.length > 0 ? "\n" : ""),
  "utf8",
);
await rename(temporaryPath, outputPath);

const categoryCounts = Object.fromEntries(
  [...new Set(annotations.map(({ annotation }) => annotation.category))]
    .sort()
    .map((category) => [
      category,
      annotations.filter(({ annotation }) => annotation.category === category)
        .length,
    ]),
);
const unknownCount = annotations.filter(
  ({ annotation }) => annotation.category === "unknown",
).length;

console.log(
  JSON.stringify(
    {
      recording: basename(recordingDirectory),
      requests: requests.length,
      annotations: annotations.length,
      unknown: unknownCount,
      coverage:
        requests.length === 0
          ? 1
          : (requests.length - unknownCount) / requests.length,
      categories: categoryCounts,
      outputPath,
    },
    null,
    2,
  ),
);

function isRawRequestStartedEvent(
  value: unknown,
): value is RawRequestStartedEvent {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<RawRequestStartedEvent>;
  return (
    candidate.kind === "http.request.started" &&
    typeof candidate.recordingId === "string" &&
    typeof candidate.sequence === "number" &&
    typeof candidate.requestId === "string" &&
    typeof candidate.http === "object" &&
    candidate.http !== null &&
    typeof candidate.http.method === "string" &&
    typeof candidate.http.target === "string"
  );
}
