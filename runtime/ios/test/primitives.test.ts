import { describe, expect, it, vi } from "vitest";
import { replayIOSPrimitive } from "../src/primitives.js";

function session() {
  return {
    launch: vi.fn(), terminate: vi.fn(),
    device: {
      home: vi.fn(),
      inputPrimitives: {
        pointer: { tap: vi.fn(), doubleClick: vi.fn(), longPress: vi.fn(), dragAndDrop: vi.fn() },
        touch: { swipe: vi.fn() },
        keyboard: { typeText: vi.fn(), keyboardPress: vi.fn(), clearInput: vi.fn() },
        scroll: { scroll: vi.fn() },
      },
    },
  };
}

describe("replayIOSPrimitive", () => {
  it("lowers recorded touch operations without AI", async () => {
    const ios = session();
    await replayIOSPrimitive(ios as never, { operation: "tap", arguments: [{ x: 12, y: 34 }] });
    await replayIOSPrimitive(ios as never, { operation: "swipe", arguments: [{ x: 1, y: 2 }, { x: 3, y: 4 }, { duration: 250 }] });
    expect(ios.device.inputPrimitives.pointer.tap).toHaveBeenCalledWith({ x: 12, y: 34 });
    expect(ios.device.inputPrimitives.touch.swipe).toHaveBeenCalledWith({ x: 1, y: 2 }, { x: 3, y: 4 }, { duration: 250 });
  });

  it("preserves the recorded replace input semantics", async () => {
    const ios = session();
    const target = { center: [40, 50] };
    await replayIOSPrimitive(ios as never, { operation: "typeText", arguments: ["hello", { target, replace: true }] });
    expect(ios.device.inputPrimitives.keyboard.typeText).toHaveBeenCalledWith("hello", { target, replace: true });
  });

  it("fails closed on malformed coordinates", async () => {
    await expect(replayIOSPrimitive(session() as never, { operation: "tap", arguments: [{ x: "12", y: 3 }] })).rejects.toThrow("tap point.x must be finite");
  });
});
