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
  const input = android.device.inputPrimitives;
  switch (primitive.operation) {
    case "tap":
      await input.pointer.tap(point(args[0], "tap point"));
      return;
    case "doubleClick":
      await input.pointer.doubleClick(point(args[0], "doubleClick point"));
      return;
    case "longPress":
      await input.pointer.longPress(point(args[0], "longPress point"), {
        duration: optionalNumber(args[1]),
      });
      return;
    case "swipe":
      await input.touch.swipe(
        point(args[0], "swipe start"),
        point(args[1], "swipe end"),
        options(args[2]),
      );
      return;
    case "dragAndDrop":
      await input.pointer.dragAndDrop(
        point(args[0], "drag start"),
        point(args[1], "drag end"),
      );
      return;
    case "typeText":
      await input.keyboard.typeText(
        string(args[0], "typeText value"),
        options(args[1]),
      );
      return;
    case "keyboardPress":
      await input.keyboard.keyboardPress(string(args[0], "keyboardPress key"));
      return;
    case "clearInput":
      await input.keyboard.clearInput(args[0] as never);
      return;
    case "scroll": {
      const value = options(args[0]);
      if (!value) throw new TypeError("scroll arguments[0] must be an object");
      await input.scroll?.scroll(value as never);
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
