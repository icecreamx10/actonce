import { readFile, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { SUPPORTED_MAC_PRIMITIVES, type MacPrimitiveOperation } from "./primitives.js";

type RecordingEvent = {
  kind?: string;
  lifecycle?: string;
  sequence?: number;
  primitiveId?: string;
  operation?: string;
  arguments?: unknown[];
  source?: { type?: string };
};

type PrimitiveSpan = {
  primitiveId: string;
  operation: MacPrimitiveOperation;
  arguments: unknown[];
  from: number;
  to: number;
};

export type CompileMacPrimitivesResult = {
  source: string;
  primitiveCount: number;
  omittedNestedCount: number;
  sequenceRange: { from: number; to: number } | null;
};

export function compileMacPrimitives(
  events: RecordingEvent[],
  provenance: { recordingId?: string; sequenceRange?: { from: number; to: number } } = {},
): CompileMacPrimitivesResult {
  const terminals = new Map<string, RecordingEvent>();
  for (const event of events) {
    if (event.primitiveId &&
      (event.kind === "device.primitive.completed" || event.kind === "device.primitive.failed")) {
      terminals.set(event.primitiveId, event);
    }
  }

  const spans: PrimitiveSpan[] = [];
  for (const event of events) {
    if (event.kind !== "device.primitive.started" || event.source?.type !== "macos-input") continue;
    if (!event.primitiveId || !Number.isInteger(event.sequence)) {
      throw new Error("A macOS primitive is missing primitiveId or sequence");
    }
    if (!isSupportedOperation(event.operation)) {
      throw new Error(`Unsupported recorded macOS primitive: ${String(event.operation)}`);
    }
    const terminal = terminals.get(event.primitiveId);
    if (!terminal || !Number.isInteger(terminal.sequence)) {
      throw new Error(`Primitive ${event.primitiveId} (${event.operation}) is incomplete in the selected range`);
    }
    if (terminal.kind === "device.primitive.failed") {
      throw new Error(`Refusing to compile failed primitive ${event.primitiveId} (${event.operation})`);
    }
    spans.push({
      primitiveId: event.primitiveId,
      operation: event.operation,
      arguments: event.arguments ?? [],
      from: event.sequence as number,
      to: terminal.sequence as number,
    });
  }

  spans.sort((left, right) => left.from - right.from || right.to - left.to);
  const selected = spans.filter((candidate) => !spans.some((parent) =>
    parent !== candidate && parent.from < candidate.from && parent.to > candidate.to,
  ));
  const range = provenance.sequenceRange ?? (selected.length
    ? { from: selected[0].from, to: selected.at(-1)!.to }
    : null);
  const header = [
    "/**",
    " * Generated mechanically by @actonce/macos; do not inline primitive implementations.",
    ...(provenance.recordingId ? [` * Recording: ${provenance.recordingId}`] : []),
    ...(range ? [` * Sequence range: ${range.from}..${range.to}`] : []),
    " */",
  ];
  const body = selected.flatMap((span) => [
    `  // recorded ${span.operation}, sequence ${span.from}..${span.to}`,
    `  await replayMacPrimitive(mac, ${JSON.stringify({
      operation: span.operation,
      arguments: span.arguments,
    }, null, 2).split("\n").join("\n  ")});`,
  ]);
  const source = [
    ...header,
    'import { replayMacPrimitive } from "@actonce/macos";',
    "",
    "export default async function replayRecordedPrimitives({ mac }) {",
    ...body,
    "}",
    "",
  ].join("\n");
  return {
    source,
    primitiveCount: selected.length,
    omittedNestedCount: spans.length - selected.length,
    sequenceRange: range,
  };
}

export async function compileMacPrimitivesFile(input: string, output: string) {
  const inputPath = resolve(input);
  const inputStat = await stat(inputPath);
  let events: RecordingEvent[];
  let provenance: { recordingId?: string; sequenceRange?: { from: number; to: number } } = {};
  if (inputStat.isDirectory()) {
    const manifest = JSON.parse(await readFile(join(inputPath, "manifest.json"), "utf8"));
    if (manifest.status === "recording") throw new Error("Refusing to compile an active recording");
    events = parseNdjson(await readFile(join(inputPath, "events.ndjson"), "utf8"));
    provenance = { recordingId: manifest.recordingId };
  } else if (inputPath.endsWith(".ndjson")) {
    events = parseNdjson(await readFile(inputPath, "utf8"));
  } else {
    const segment = JSON.parse(await readFile(inputPath, "utf8"));
    if (!Array.isArray(segment.events)) throw new Error(`${inputPath} does not contain an events array`);
    events = segment.events;
    provenance = {
      recordingId: segment.source?.recordingId,
      sequenceRange: segment.source?.sequenceRange,
    };
  }
  const result = compileMacPrimitives(events, provenance);
  await writeFile(resolve(output), result.source, "utf8");
  return { ...result, output: resolve(output) };
}

function parseNdjson(source: string): RecordingEvent[] {
  return source.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

function isSupportedOperation(value: unknown): value is MacPrimitiveOperation {
  return typeof value === "string" && (SUPPORTED_MAC_PRIMITIVES as readonly string[]).includes(value);
}
