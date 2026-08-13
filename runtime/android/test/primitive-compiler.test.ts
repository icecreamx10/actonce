import { describe, expect, it } from "vitest";
import { compileAndroidPrimitives } from "../src/primitive-compiler.js";

describe("compileAndroidPrimitives", () => {
  it("lowers completed logical actions and omits waits", () => {
    const result = compileAndroidPrimitives(
      [
        {
          kind: "logical.action.completed",
          sequence: 4,
          actionId: "wait",
          operation: "Sleep",
          normalizedArguments: { timeMs: 1000 },
        },
        {
          kind: "logical.action.completed",
          sequence: 8,
          actionId: "tap",
          operation: "Tap",
          normalizedArguments: { locate: { center: [107, 311] } },
        },
      ],
      { recordingId: "android-case" },
    );
    expect(result.primitiveCount).toBe(1);
    expect(result.omittedWaitCount).toBe(1);
    expect(result.sequenceRange).toEqual({ from: 8, to: 8 });
    expect(result.source).toContain('"operation": "tap"');
    expect(result.source).toContain('"x": 107');
  });

  it("fails closed for unsupported actions", () => {
    expect(() =>
      compileAndroidPrimitives([
        {
          kind: "logical.action.completed",
          sequence: 1,
          actionId: "x",
          operation: "Unknown",
          normalizedArguments: {},
        },
      ]),
    ).toThrow("Unsupported recorded Android action");
  });
});
