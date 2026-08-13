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
  invalidateObservation?(): void;
}

export async function replayIOSPrimitive(
  ios: IOSPrimitiveSession,
  primitive: RecordedIOSPrimitive,
): Promise<void> {
  const args = primitive.arguments;
  ios.invalidateObservation?.();
  switch (primitive.operation) {
    case "tap": await ios.device.tap(point(args[0], "tap point")); return;
    case "doubleClick": await ios.device.doubleClick(point(args[0], "doubleClick point")); return;
    case "longPress": await ios.device.longPress(point(args[0], "longPress point"), optionalNumber(args[1])); return;
    case "swipe": await ios.device.swipe(point(args[0], "swipe start"), point(args[1], "swipe end"), optionalDuration(options(args[2]))); return;
    case "dragAndDrop": await ios.device.swipe(point(args[0], "drag start"), point(args[1], "drag end"), 1_000); return;
    case "typeText": {
      const value = string(args[0], "typeText value");
      const inputOptions = options(args[1]);
      const target = inputOptions?.target;
      if (target && typeof target === "object") {
        const targetPoint = point(target, "typeText target");
        await ios.device.tap(targetPoint);
        if (inputOptions?.replace !== false) await ios.device.clearInput();
      }
      if (!inputOptions?.focusOnly) await ios.device.typeText(value);
      return;
    }
    case "keyboardPress": await ios.device.keyboardPress(string(args[0], "keyboardPress key")); return;
    case "clearInput": await ios.device.clearInput(); return;
    case "scroll": {
      const value = options(args[0]);
      if (!value) throw new TypeError("scroll arguments[0] must be an object");
      const size = await ios.device.windowSize();
      const center = { x: finite(value.x ?? size.width / 2, "scroll.x"), y: finite(value.y ?? size.height / 2, "scroll.y") };
      const distance = finite(value.distance ?? size.height / 3, "scroll.distance");
      const direction = typeof value.direction === "string" ? value.direction : "down";
      const end = direction === "up" ? { x: center.x, y: center.y + distance } : direction === "left" ? { x: center.x + distance, y: center.y } : direction === "right" ? { x: center.x - distance, y: center.y } : { x: center.x, y: center.y - distance };
      await ios.device.swipe(center, end, optionalDuration(value));
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
function optionalDuration(value: Record<string, unknown> | undefined): number | undefined { const duration = value?.duration ?? value?.durationMs; return duration === undefined ? undefined : finite(duration, "duration"); }
