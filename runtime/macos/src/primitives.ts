import { spawn } from "node:child_process";
import type { MacSession } from "./session.js";
import type { Point } from "./types.js";

const META = "\uE03D";

export const SUPPORTED_MAC_PRIMITIVES = [
  "tap",
  "doubleClick",
  "rightClick",
  "hover",
  "dragAndDrop",
  "typeText",
  "keyboardPress",
  "clearInput",
  "scroll",
] as const;

export type MacPrimitiveOperation = (typeof SUPPORTED_MAC_PRIMITIVES)[number];

export type RecordedMacPrimitive = {
  operation: MacPrimitiveOperation;
  arguments: unknown[];
};

export interface MacClipboard {
  readText(): Promise<string>;
  writeText(value: string): Promise<void>;
}

export interface MacPrimitiveSession {
  click(point: Point): Promise<void>;
  doubleClick(point: Point): Promise<void>;
  rightClick(point: Point): Promise<void>;
  hover(point: Point, durationMs?: number): Promise<void>;
  dragAndDrop(from: Point, to: Point, durationMs?: number): Promise<void>;
  scroll(
    delta: { x?: number; y?: number; deltaX: number; deltaY: number },
    durationMs?: number,
  ): Promise<void>;
  keys(keys: string | string[]): Promise<void>;
  keyChord(keys: string[]): Promise<void>;
}

export type ReplayMacPrimitiveOptions = {
  clipboard?: MacClipboard;
  defaultScrollDistance?: number;
};

/**
 * Deterministically lowers one recorded Midscene macOS primitive to runtime calls.
 * Unknown operations and malformed arguments fail closed instead of asking an AI
 * to invent an implementation.
 */
export async function replayMacPrimitive(
  mac: MacPrimitiveSession,
  primitive: RecordedMacPrimitive,
  options: ReplayMacPrimitiveOptions = {},
): Promise<void> {
  const args = primitive.arguments;
  switch (primitive.operation) {
    case "tap":
      await mac.click(point(args[0], "tap point"));
      return;
    case "doubleClick":
      await mac.doubleClick(point(args[0], "doubleClick point"));
      return;
    case "rightClick":
      await mac.rightClick(point(args[0], "rightClick point"));
      return;
    case "hover":
      await mac.hover(point(args[0], "hover point"));
      return;
    case "dragAndDrop":
      await mac.dragAndDrop(
        point(args[0], "drag start"),
        point(args[1], "drag end"),
      );
      return;
    case "keyboardPress": {
      const keyName = string(args[0], "keyboardPress keyName");
      const target = targetPoint(optionObject(args[1])?.target);
      if (target) await mac.click(target);
      const keys = webDriverKeys(keyName);
      if (Array.isArray(keys)) await mac.keyChord(keys);
      else await mac.keys(keys);
      return;
    }
    case "typeText": {
      const value = string(args[0], "typeText value");
      const typeOptions = optionObject(args[1]);
      const target = targetPoint(typeOptions?.target);
      if (target) await mac.click(target);
      if (typeOptions?.focusOnly === true) return;
      await pasteText(mac, value, typeOptions?.replace === true, options.clipboard);
      return;
    }
    case "clearInput": {
      const target = targetPoint(args[0]);
      if (target) await mac.click(target);
      await mac.keyChord([META, "a"]);
      await mac.keys("\uE003");
      return;
    }
    case "scroll": {
      const scrollOptions = optionObject(args[0]);
      if (!scrollOptions) throw new TypeError("scroll arguments[0] must be an object");
      const direction = scrollOptions.direction ?? "down";
      if (!isDirection(direction)) throw new TypeError(`Unsupported scroll direction: ${String(direction)}`);
      const distance = numberOr(scrollOptions.distance, options.defaultScrollDistance ?? 500);
      const target = targetPoint(scrollOptions.locate);
      const delta = scrollDelta(direction, distance);
      await mac.scroll({ ...delta, ...(target ?? {}) });
      return;
    }
  }

  const exhaustive: never = primitive.operation;
  throw new Error(`Unsupported macOS primitive: ${String(exhaustive)}`);
}

export const systemMacClipboard: MacClipboard = {
  readText: () => pipeProcess("/usr/bin/pbpaste"),
  writeText: (value) => pipeProcess("/usr/bin/pbcopy", value).then(() => undefined),
};

async function pasteText(
  mac: Pick<MacPrimitiveSession, "keyChord">,
  value: string,
  replace: boolean,
  clipboard: MacClipboard = systemMacClipboard,
): Promise<void> {
  const previous = await clipboard.readText();
  try {
    await clipboard.writeText(value);
    if (replace) await mac.keyChord([META, "a"]);
    await mac.keyChord([META, "v"]);
    // Mac2 reports the key chord before Electron has necessarily consumed the
    // pasteboard. Restoring it immediately can make the application paste the
    // previous clipboard contents. Keep the recorded one-paste semantics while
    // allowing the receiving run loop to read the intended value.
    await new Promise((resolve) => setTimeout(resolve, 250));
  } finally {
    await clipboard.writeText(previous);
  }
}

function webDriverKeys(keyName: string): string | string[] {
  const parts = keyName.split("+").map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) throw new TypeError("keyboardPress keyName must not be empty");
  if (parts.length === 1) return namedKey(parts[0]);
  const hasExplicitShift = parts.slice(0, -1).some((part) =>
    part.toLowerCase().replaceAll(/[-_ ]/g, "") === "shift"
  );
  return [
    ...parts.map((part, index) => {
      const mapped = namedKey(part);
      return index === parts.length - 1 && !hasExplicitShift && /^[A-Z]$/.test(mapped)
        ? mapped.toLowerCase()
        : mapped;
    }),
  ];
}

function namedKey(name: string): string {
  const normalized = name.toLowerCase().replaceAll(/[-_ ]/g, "");
  const keys: Record<string, string> = {
    cmd: META,
    command: META,
    meta: META,
    control: "\uE009",
    ctrl: "\uE009",
    alt: "\uE00A",
    option: "\uE00A",
    shift: "\uE008",
    backspace: "\uE003",
    tab: "\uE004",
    enter: "\uE007",
    return: "\uE006",
    escape: "\uE00C",
    esc: "\uE00C",
    space: "\uE00D",
    pageup: "\uE00E",
    pagedown: "\uE00F",
    end: "\uE010",
    home: "\uE011",
    arrowleft: "\uE012",
    left: "\uE012",
    arrowup: "\uE013",
    up: "\uE013",
    arrowright: "\uE014",
    right: "\uE014",
    arrowdown: "\uE015",
    down: "\uE015",
    insert: "\uE016",
    delete: "\uE017",
  };
  return keys[normalized] ?? name;
}

function targetPoint(value: unknown): Point | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Record<string, unknown>;
  if (Array.isArray(candidate.center) && candidate.center.length >= 2) {
    return { x: finite(candidate.center[0], "target center x"), y: finite(candidate.center[1], "target center y") };
  }
  if (typeof candidate.x === "number" && typeof candidate.y === "number") {
    return point(candidate, "target");
  }
  const rect = candidate.rect;
  if (rect && typeof rect === "object") {
    const box = rect as Record<string, unknown>;
    const left = finite(box.left ?? box.x, "target rect left");
    const top = finite(box.top ?? box.y, "target rect top");
    return {
      x: Math.round(left + finite(box.width, "target rect width") / 2),
      y: Math.round(top + finite(box.height, "target rect height") / 2),
    };
  }
  return undefined;
}

function point(value: unknown, label: string): Point {
  if (!value || typeof value !== "object") throw new TypeError(`${label} must be an object`);
  const candidate = value as Record<string, unknown>;
  return { x: finite(candidate.x, `${label}.x`), y: finite(candidate.y, `${label}.y`) };
}

function optionObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string") throw new TypeError(`${label} must be a string`);
  return value;
}

function finite(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
  return value;
}

function numberOr(value: unknown, fallback: number): number {
  return value === null || value === undefined ? fallback : Math.abs(finite(value, "scroll distance"));
}

function isDirection(value: unknown): value is "up" | "down" | "left" | "right" {
  return value === "up" || value === "down" || value === "left" || value === "right";
}

function scrollDelta(direction: "up" | "down" | "left" | "right", distance: number) {
  switch (direction) {
    case "up": return { deltaX: 0, deltaY: -distance };
    case "down": return { deltaX: 0, deltaY: distance };
    case "left": return { deltaX: -distance, deltaY: 0 };
    case "right": return { deltaX: distance, deltaY: 0 };
  }
}

function pipeProcess(command: string, input?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${command} exited with ${code}: ${stderr.trim()}`));
    });
    child.stdin.end(input);
  });
}

// Compile-time assertion that the real runtime implements the primitive surface.
const _macSessionCompatibility: MacPrimitiveSession | undefined = undefined as MacSession | undefined;
void _macSessionCompatibility;
