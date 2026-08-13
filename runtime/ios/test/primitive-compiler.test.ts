import { describe, expect, it } from "vitest";
import { compileIOSPrimitives } from "../src/primitive-compiler.js";

describe("compileIOSPrimitives", () => {
  it("lowers completed logical taps using normalized device coordinates", () => {
    const result = compileIOSPrimitives([{ kind: "logical.action.completed", actionId: "tap-general", operation: "Tap", sequence: 98, normalizedArguments: { locate: { center: [218, 328] } } }], { recordingId: "ios-recording" });
    expect(result.primitiveCount).toBe(1);
    expect(result.source).toContain('"operation": "tap"');
    expect(result.source).toContain('"x": 218');
    expect(result.source).toContain("Recording: ios-recording");
  });
  it("rejects unsupported actions instead of inventing an implementation", () => {
    expect(() => compileIOSPrimitives([{ kind: "logical.action.completed", actionId: "x", operation: "Unknown", sequence: 3 }])).toThrow("Unsupported recorded iOS action");
  });
});
