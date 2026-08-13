import type { IOSSession } from "./session.js";
import type { Point } from "./types.js";

export const SUPPORTED_IOS_PRIMITIVES = [
  "tap", "doubleClick", "longPress", "swipe", "dragAndDrop",
  "typeText", "keyboardPress", "clearInput", "scroll",
  "launchApp", "terminateApp", "home",
] as const;

export type IOSPrimitiveOperation = (typeof SUPPORTED_IOS_PRIMITIVES)[number];
export type RecordedIOSPrimitive = { operation: IOSPrimitiveOperation; arguments: unknown[] };

export interface IOSPrimitiveSession {
  device: IOSSession["device"];
  launch(bundleId: string): Promise<void>;
  terminate(bundleId: string): Promise<void>;
}

export async function replayIOSPrimitive(
  ios: IOSPrimitiveSession,
  primitive: RecordedIOSPrimitive,
): Promise<void> {
  const args = primitive.arguments;
  const input = ios.device.inputPrimitives;
  switch (primitive.operation) {
    case "tap": await input.pointer.tap(point(args[0], "tap point")); return;
    case "doubleClick": await input.pointer.doubleClick(point(args[0], "doubleClick point")); return;
    case "longPress": await input.pointer.longPress(point(args[0], "longPress point"), { duration: optionalNumber(args[1]) }); return;
    case "swipe": await input.touch.swipe(point(args[0], "swipe start"), point(args[1], "swipe end"), options(args[2])); return;
    case "dragAndDrop": await input.pointer.dragAndDrop(point(args[0], "drag start"), point(args[1], "drag end")); return;
    case "typeText": await input.keyboard.typeText(string(args[0], "typeText value"), options(args[1])); return;
    case "keyboardPress": await input.keyboard.keyboardPress(string(args[0], "keyboardPress key")); return;
    case "clearInput": await input.keyboard.clearInput(args[0]); return;
    case "scroll": {
      const value = options(args[0]);
      if (!value) throw new TypeError("scroll arguments[0] must be an object");
      await ios.device.inputPrimitives.scroll?.scroll(value as never);
      return;
    }
    case "launchApp": await ios.launch(string(args[0], "launchApp bundleId")); return;
    case "terminateApp": await ios.terminate(string(args[0], "terminateApp bundleId")); return;
    case "home": await ios.device.home(); return;
  }
}

function point(value: unknown, label: string): Point {
  if (!value || typeof value !== "object") throw new TypeError(`${label} must be an object`);
  const candidate = value as Record<string, unknown>;
  if (Array.isArray(candidate.center) && candidate.center.length >= 2) {
    return { x: finite(candidate.center[0], `${label}.x`), y: finite(candidate.center[1], `${label}.y`) };
  }
  return { x: finite(candidate.x, `${label}.x`), y: finite(candidate.y, `${label}.y`) };
}
function options(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
function string(value: unknown, label: string): string {
  if (typeof value !== "string") throw new TypeError(`${label} must be a string`);
  return value;
}
function finite(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
  return value;
}
function optionalNumber(value: unknown): number | undefined {
  return value === undefined ? undefined : finite(value, "duration");
}
