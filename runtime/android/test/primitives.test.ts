import { describe, expect, it, vi } from "vitest";
import { replayAndroidPrimitive } from "../src/primitives.js";
import { extractAndroidPrimitives } from "../src/primitive-compiler.js";

describe("replayAndroidPrimitive", () => {
  it("delivers the recorded long-press duration after primitive lowering", async () => {
    const longPress = vi.fn(async () => undefined);
    const [action] = extractAndroidPrimitives([{
      kind: "logical.action.completed", sequence: 1, actionId: "hold",
      operation: "LongPress",
      normalizedArguments: { locate: { center: [42, 65] }, duration: 1000 },
    }]);
    await replayAndroidPrimitive({ device: { longPress } } as never, action.primitive);
    expect(longPress).toHaveBeenCalledExactlyOnceWith({ x: 42, y: 65 }, 1000);
  });

  it("supports a Skill-verified unique node with the recorded coordinate fallback", async () => {
    const tapUniqueNode = vi.fn(async () => "selector" as const);
    const android = {
      invalidateObservation: vi.fn(),
      device: { tapUniqueNode },
    } as never;

    await replayAndroidPrimitive(android, {
      operation: "tapUniqueNode",
      arguments: [
        { type: "android.widget.Spinner", text: "Mobile" },
        { x: 137, y: 619 },
      ],
    });

    expect(tapUniqueNode).toHaveBeenCalledWith(
      { type: "android.widget.Spinner", text: "Mobile", contentDescription: undefined, resourceId: undefined },
      { x: 137, y: 619 },
    );
  });

  it("preserves replace semantics for an already-focused input", async () => {
    const clearInput = vi.fn(async () => undefined);
    const typeText = vi.fn(async () => undefined);
    const hideKeyboard = vi.fn(async () => true);
    const android = {
      invalidateObservation: vi.fn(),
      device: { clearInput, typeText, hideKeyboard },
    } as never;

    await replayAndroidPrimitive(android, {
      operation: "typeText",
      arguments: ["hello", { replace: true }],
    });

    expect(clearInput).toHaveBeenCalledOnce();
    expect(typeText).toHaveBeenCalledWith("hello");
    expect(hideKeyboard).toHaveBeenCalledOnce();
    expect(clearInput.mock.invocationCallOrder[0]).toBeLessThan(
      typeText.mock.invocationCallOrder[0],
    );
    expect(typeText.mock.invocationCallOrder[0]).toBeLessThan(
      hideKeyboard.mock.invocationCallOrder[0],
    );
  });

  it("does not dismiss the keyboard for focus-only input", async () => {
    const typeText = vi.fn(async () => undefined);
    const hideKeyboard = vi.fn(async () => true);
    const android = {
      invalidateObservation: vi.fn(),
      device: {
        clearInput: vi.fn(async () => undefined),
        typeText,
        hideKeyboard,
      },
    } as never;

    await replayAndroidPrimitive(android, {
      operation: "typeText",
      arguments: ["", { replace: false, focusOnly: true }],
    });

    expect(typeText).not.toHaveBeenCalled();
    expect(hideKeyboard).not.toHaveBeenCalled();
  });
});
