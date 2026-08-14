import { describe, expect, it, vi } from "vitest";
import { replayAndroidPrimitive } from "../src/primitives.js";

describe("replayAndroidPrimitive", () => {
  it("preserves replace semantics for an already-focused input", async () => {
    const clearInput = vi.fn(async () => undefined);
    const typeText = vi.fn(async () => undefined);
    const android = {
      invalidateObservation: vi.fn(),
      device: { clearInput, typeText },
    } as never;

    await replayAndroidPrimitive(android, {
      operation: "typeText",
      arguments: ["hello", { replace: true }],
    });

    expect(clearInput).toHaveBeenCalledOnce();
    expect(typeText).toHaveBeenCalledWith("hello");
    expect(clearInput.mock.invocationCallOrder[0]).toBeLessThan(
      typeText.mock.invocationCallOrder[0],
    );
  });
});
