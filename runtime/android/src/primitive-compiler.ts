import { readFile, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type {
  AndroidPrimitiveOperation,
  RecordedAndroidPrimitive,
} from "./primitives.js";

type Event = {
  kind?: string;
  sequence?: number;
  recordingId?: string;
  actionId?: string;
  operation?: string;
  normalizedArguments?: Record<string, unknown>;
};
export type CompileAndroidPrimitivesResult = {
  source: string;
  primitiveCount: number;
  omittedWaitCount: number;
  sequenceRange: { from: number; to: number } | null;
};

export function compileAndroidPrimitives(
  events: Event[],
  provenance: {
    recordingId?: string;
    sequenceRange?: { from: number; to: number };
  } = {},
): CompileAndroidPrimitivesResult {
  const completed = events.filter(
    (event) => event.kind === "logical.action.completed",
  );
  const omittedWaitCount = completed.filter(
    (event) => event.operation === "Sleep",
  ).length;
  const actions = completed
    .filter((event) => event.operation !== "Sleep")
    .map((event) => {
      if (!event.actionId || !Number.isInteger(event.sequence))
        throw new Error(
          "A completed Android action is missing actionId or sequence",
        );
      return { sequence: event.sequence!, primitive: lower(event) };
    });
  const range =
    provenance.sequenceRange ??
    (actions.length
      ? { from: actions[0].sequence, to: actions.at(-1)!.sequence }
      : null);
  const lines = actions.flatMap(({ sequence, primitive }) => [
    `  // recorded ${primitive.operation}, completed at sequence ${sequence}`,
    `  await replayAndroidPrimitive(android, ${JSON.stringify(primitive, null, 2).split("\n").join("\n  ")});`,
  ]);
  return {
    source: [
      "/**",
      " * Generated mechanically by @byted-lynx/actonce-android; do not inline primitive implementations.",
      ...(provenance.recordingId
        ? [` * Recording: ${provenance.recordingId}`]
        : []),
      ...(range ? [` * Sequence range: ${range.from}..${range.to}`] : []),
      " */",
      'import { replayAndroidPrimitive } from "@byted-lynx/actonce-android";',
      "",
      "export default async function replayRecordedPrimitives({ android }) {",
      ...lines,
      "}",
      "",
    ].join("\n"),
    primitiveCount: actions.length,
    omittedWaitCount,
    sequenceRange: range,
  };
}
export async function compileAndroidPrimitivesFile(
  input: string,
  output: string,
) {
  const path = resolve(input);
  const info = await stat(path);
  let events: Event[];
  let provenance = {};
  if (info.isDirectory()) {
    const manifest = JSON.parse(
      await readFile(join(path, "manifest.json"), "utf8"),
    );
    if (manifest.status === "recording")
      throw new Error("Refusing to compile an active recording");
    events = ndjson(await readFile(join(path, "events.ndjson"), "utf8"));
    provenance = { recordingId: manifest.recordingId };
  } else if (path.endsWith(".ndjson"))
    events = ndjson(await readFile(path, "utf8"));
  else {
    const segment = JSON.parse(await readFile(path, "utf8"));
    if (!Array.isArray(segment.events))
      throw new Error(`${path} does not contain an events array`);
    events = segment.events;
    provenance = {
      recordingId: segment.source?.recordingId,
      sequenceRange: segment.source?.sequenceRange,
    };
  }
  const result = compileAndroidPrimitives(events, provenance);
  await writeFile(resolve(output), result.source, "utf8");
  return { ...result, output: resolve(output) };
}
function lower(event: Event): RecordedAndroidPrimitive {
  const args = event.normalizedArguments ?? {};
  const mapping: Record<string, AndroidPrimitiveOperation> = {
    Launch: "launchApp",
    Terminate: "terminateApp",
    Tap: "tap",
    DoubleClick: "doubleClick",
    LongPress: "longPress",
    Swipe: "swipe",
    DragAndDrop: "dragAndDrop",
    Input: "typeText",
    KeyboardPress: "keyboardPress",
    ClearInput: "clearInput",
    Scroll: "scroll",
    AndroidBackButton: "back",
    AndroidHomeButton: "home",
    AndroidRecentAppsButton: "recentApps",
  };
  const operation = event.operation && mapping[event.operation];
  if (!operation)
    throw new Error(
      `Unsupported recorded Android action: ${String(event.operation)}`,
    );
  if (["back", "home", "recentApps"].includes(operation))
    return { operation, arguments: [] };
  if (["launchApp", "terminateApp"].includes(operation)) {
    const packageName = args.uri ?? args.packageName ?? args.package;
    if (typeof packageName !== "string" || packageName.length === 0)
      throw new Error(
        `Recorded Android ${event.operation} action is missing package name`,
      );
    return { operation, arguments: [packageName] };
  }
  if (["tap", "doubleClick", "longPress"].includes(operation))
    return { operation, arguments: [targetPoint(args.locate)] };
  if (operation === "typeText") {
    if (typeof args.value !== "string")
      throw new Error("Recorded Android Input action is missing value");
    return {
      operation,
      arguments: [
        args.value,
        {
          target: args.locate,
          replace: args.mode === "replace" || args.replace !== false,
        },
      ],
    };
  }
  if (operation === "keyboardPress") {
    const key = args.keyName ?? args.key;
    if (typeof key !== "string")
      throw new Error(
        "Recorded Android KeyboardPress action is missing keyName",
      );
    return { operation, arguments: [key] };
  }
  if (operation === "clearInput")
    return { operation, arguments: [args.locate] };
  if (operation === "scroll") return { operation, arguments: [args] };
  const from = args.from ?? args.start;
  const to = args.to ?? args.end;
  if (!from || !to)
    throw new Error(
      `Recorded Android ${event.operation} action is missing start/end coordinates`,
    );
  return {
    operation,
    arguments: [
      from,
      to,
      ...(args.duration === undefined ? [] : [{ duration: args.duration }]),
    ],
  };
}
function targetPoint(value: unknown): { x: number; y: number } {
  if (!value || typeof value !== "object")
    throw new Error("Recorded Android action is missing locate target");
  const center = (value as { center?: unknown }).center;
  if (
    !Array.isArray(center) ||
    center.length < 2 ||
    !center.every((item) => typeof item === "number" && Number.isFinite(item))
  )
    throw new Error(
      "Recorded Android locate target is missing a finite center",
    );
  return { x: center[0], y: center[1] };
}
function ndjson(value: string): Event[] {
  return value
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}
