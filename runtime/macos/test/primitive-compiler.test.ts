import { describe, expect, it } from "vitest";
import { compileMacPrimitives } from "../src/primitive-compiler.js";

describe("compileMacPrimitives", () => {
  it("emits fixed executor calls and removes primitives nested inside typeText", () => {
    const result = compileMacPrimitives([
      started(21, "outer", "typeText", ["probe", { replace: true }]),
      started(22, "inner", "tap", [{ x: 10, y: 20 }]),
      completed(23, "inner", "tap"),
      completed(24, "outer", "typeText"),
      started(30, "undo", "keyboardPress", ["Cmd+Z"]),
      completed(31, "undo", "keyboardPress"),
    ], { recordingId: "actonce", sequenceRange: { from: 19, to: 32 } });

    expect(result.primitiveCount).toBe(2);
    expect(result.omittedNestedCount).toBe(1);
    expect(result.source).toContain('import { replayMacPrimitive } from "@actonce/macos"');
    expect(result.source).toContain('"operation": "typeText"');
    expect(result.source).toContain('"operation": "keyboardPress"');
    expect(result.source).not.toContain('"operation": "tap"');
    expect(result.source).not.toContain("setValue");
  });

  it("refuses failed, incomplete, and unknown operations", () => {
    expect(() => compileMacPrimitives([
      started(1, "failed", "tap", [{ x: 1, y: 2 }]),
      { ...completed(2, "failed", "tap"), kind: "device.primitive.failed" },
    ])).toThrow("Refusing to compile failed primitive");
    expect(() => compileMacPrimitives([
      started(1, "incomplete", "tap", [{ x: 1, y: 2 }]),
    ])).toThrow("is incomplete");
    expect(() => compileMacPrimitives([
      started(1, "unknown", "magic", []),
      completed(2, "unknown", "magic"),
    ])).toThrow("Unsupported recorded macOS primitive");
  });
});

function started(sequence: number, primitiveId: string, operation: string, args: unknown[]) {
  return {
    kind: "device.primitive.started",
    lifecycle: "started",
    sequence,
    primitiveId,
    operation,
    arguments: args,
    source: { type: "macos-input" },
  };
}

function completed(sequence: number, primitiveId: string, operation: string) {
  return {
    kind: "device.primitive.completed",
    lifecycle: "completed",
    sequence,
    primitiveId,
    operation,
    source: { type: "macos-input" },
  };
}
