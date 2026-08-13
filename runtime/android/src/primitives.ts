import type { AndroidSession } from "./session.js";
import type { Point } from "./types.js";

export const SUPPORTED_ANDROID_PRIMITIVES = [
  "tap",
  "doubleClick",
  "longPress",
  "swipe",
  "dragAndDrop",
  "typeText",
  "keyboardPress",
  "clearInput",
  "scroll",
  "back",
  "home",
  "recentApps",
  "launchApp",
  "terminateApp",
] as const;
export type AndroidPrimitiveOperation =
  (typeof SUPPORTED_ANDROID_PRIMITIVES)[number];
export type RecordedAndroidPrimitive = {
  operation: AndroidPrimitiveOperation;
  arguments: unknown[];
};
export interface AndroidPrimitiveSession {
  device: AndroidSession["device"];
  launch(packageName: string): Promise<void>;
  terminate(packageName: string): Promise<void>;
  invalidateObservation?(): void;
}

export async function replayAndroidPrimitive(
  android: AndroidPrimitiveSession,
  primitive: RecordedAndroidPrimitive,
): Promise<void> {
  android.invalidateObservation?.();
  const args = primitive.arguments;
  switch (primitive.operation) {
    case "tap":
      await android.device.tap(point(args[0], "tap point"));
      return;
    case "doubleClick":
      await android.device.doubleClick(point(args[0], "doubleClick point"));
      return;
    case "longPress":
      await android.device.longPress(point(args[0], "longPress point"), optionalNumber(args[1]));
      return;
    case "swipe":
      await android.device.swipe(
        point(args[0], "swipe start"),
        point(args[1], "swipe end"),
        optionalDuration(options(args[2])),
      );
      return;
    case "dragAndDrop":
      await android.device.swipe(
        point(args[0], "drag start"),
        point(args[1], "drag end"),
      );
      return;
    case "typeText":
      {
        const value = string(args[0], "typeText value");
        const inputOptions = options(args[1]);
        const target = inputOptions?.target;
        if (target && typeof target === "object") {
          await android.device.tap(point(target, "typeText target"));
          if (inputOptions?.replace !== false) await android.device.clearInput();
        }
        if (!inputOptions?.focusOnly) await android.device.typeText(value);
      }
      return;
    case "keyboardPress":
      await android.device.keyboardPress(string(args[0], "keyboardPress key"));
      return;
    case "clearInput":
      await android.device.clearInput();
      return;
    case "scroll": {
      const value = options(args[0]);
      if (!value) throw new TypeError("scroll arguments[0] must be an object");
      const direction = typeof value.direction === "string" ? value.direction : "down";
      const center = { x: finite(value.x ?? 205, "scroll.x"), y: finite(value.y ?? 450, "scroll.y") };
      const distance = finite(value.distance ?? 300, "scroll.distance");
      const end = direction === "up" ? { x: center.x, y: center.y + distance } : direction === "left" ? { x: center.x + distance, y: center.y } : direction === "right" ? { x: center.x - distance, y: center.y } : { x: center.x, y: center.y - distance };
      await android.device.swipe(center, end, optionalDuration(value));
      return;
    }
    case "back":
      await android.device.back();
      return;
    case "home":
      await android.device.home();
      return;
    case "recentApps":
      await android.device.recentApps();
      return;
    case "launchApp":
      await android.launch(string(args[0], "launchApp package"));
      return;
    case "terminateApp":
      await android.terminate(string(args[0], "terminateApp package"));
      return;
  }
}
function point(value: unknown, label: string): Point {
  if (!value || typeof value !== "object")
    throw new TypeError(`${label} must be an object`);
  const candidate = value as Record<string, unknown>;
  if (Array.isArray(candidate.center) && candidate.center.length >= 2)
    return {
      x: finite(candidate.center[0], `${label}.x`),
      y: finite(candidate.center[1], `${label}.y`),
    };
  return {
    x: finite(candidate.x, `${label}.x`),
    y: finite(candidate.y, `${label}.y`),
  };
}
function options(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
function string(value: unknown, label: string): string {
  if (typeof value !== "string")
    throw new TypeError(`${label} must be a string`);
  return value;
}
function finite(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new TypeError(`${label} must be finite`);
  return value;
}
function optionalNumber(value: unknown): number | undefined {
  return value === undefined ? undefined : finite(value, "duration");
}
function optionalDuration(value: Record<string, unknown> | undefined): number | undefined {
  const duration = value?.duration ?? value?.durationMs;
  return duration === undefined ? undefined : finite(duration, "duration");
}
