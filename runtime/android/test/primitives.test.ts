import { describe, expect, it, vi } from "vitest";
import { replayAndroidPrimitive } from "../src/primitives.js";

describe("replayAndroidPrimitive", () => {
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
