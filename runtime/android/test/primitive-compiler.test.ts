import { describe, expect, it } from "vitest";
import { compileAndroidPrimitives, extractAndroidPrimitives } from "../src/primitive-compiler.js";

describe("compileAndroidPrimitives", () => {
  it("preserves recorded long-press duration as the runtime's numeric argument", () => {
    const [action] = extractAndroidPrimitives([{
      kind: "logical.action.completed", sequence: 81, actionId: "hold",
      operation: "LongPress",
      normalizedArguments: { locate: { center: [107, 311] }, duration: 1000 },
    }]);
    expect(action.primitive).toEqual({ operation: "longPress", arguments: [{ x: 107, y: 311 }, 1000] });
  });

  it("retains default long-press behavior when duration was not recorded", () => {
    const [action] = extractAndroidPrimitives([{
      kind: "logical.action.completed", sequence: 1, actionId: "hold",
      operation: "LongPress", normalizedArguments: { locate: { center: [1, 2] } },
    }]);
    expect(action.primitive.arguments).toEqual([{ x: 1, y: 2 }]);
  });

  it.each(["1000", -1, NaN, Infinity, null])("rejects invalid recorded duration %s", (duration) => {
    expect(() => extractAndroidPrimitives([{
      kind: "logical.action.completed", sequence: 1, actionId: "hold",
      operation: "LongPress", normalizedArguments: { locate: { center: [1, 2] }, duration },
    }])).toThrow("LongPress duration");
  });

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

  it("lowers app lifecycle actions and focused replace input", () => {
    const result = compileAndroidPrimitives([
      {
        kind: "logical.action.completed",
        sequence: 1,
        actionId: "launch",
        operation: "Launch",
        normalizedArguments: { uri: "com.example.app" },
      },
      {
        kind: "logical.action.completed",
        sequence: 2,
        actionId: "input",
        operation: "Input",
        normalizedArguments: { value: "hello", mode: "replace" },
      },
    ]);

    expect(result.source).toContain('"operation": "launchApp"');
    expect(result.source).toContain('"com.example.app"');
    expect(result.source).toContain('"operation": "typeText"');
    expect(result.source).toContain('"replace": true');
  });

  it("fails closed when a lifecycle action lacks a package name", () => {
    expect(() =>
      compileAndroidPrimitives([
        {
          kind: "logical.action.completed",
          sequence: 1,
          actionId: "launch",
          operation: "Launch",
          normalizedArguments: {},
        },
      ]),
    ).toThrow("missing package name");
  });
});
