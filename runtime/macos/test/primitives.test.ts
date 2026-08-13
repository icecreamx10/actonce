import { describe, expect, it } from "vitest";
import {
  replayMacPrimitive,
  type MacClipboard,
  type MacPrimitiveSession,
} from "../src/primitives.js";

class FakeMac implements MacPrimitiveSession {
  readonly calls: unknown[][] = [];
  click(point: { x: number; y: number }) { this.calls.push(["click", point]); return Promise.resolve(); }
  doubleClick(point: { x: number; y: number }) { this.calls.push(["doubleClick", point]); return Promise.resolve(); }
  rightClick(point: { x: number; y: number }) { this.calls.push(["rightClick", point]); return Promise.resolve(); }
  hover(point: { x: number; y: number }, durationMs?: number) { this.calls.push(["hover", point, durationMs]); return Promise.resolve(); }
  dragAndDrop(from: { x: number; y: number }, to: { x: number; y: number }, durationMs?: number) {
    this.calls.push(["dragAndDrop", from, to, durationMs]); return Promise.resolve();
  }
  scroll(delta: { x?: number; y?: number; deltaX: number; deltaY: number }, durationMs?: number) {
    this.calls.push(["scroll", delta, durationMs]); return Promise.resolve();
  }
  keys(keys: string | string[]) { this.calls.push(["keys", keys]); return Promise.resolve(); }
  keyChord(keys: string[]) { this.calls.push(["keyChord", keys]); return Promise.resolve(); }
}

function fakeClipboard(initial = "original") {
  let value = initial;
  const writes: string[] = [];
  const clipboard: MacClipboard = {
    readText: async () => value,
    writeText: async (next) => { value = next; writes.push(next); },
  };
  return { clipboard, writes, value: () => value };
}

describe("replayMacPrimitive", () => {
  it("maps pointer primitives without interpretation", async () => {
    const mac = new FakeMac();
    await replayMacPrimitive(mac, { operation: "tap", arguments: [{ x: 10, y: 20 }] });
    await replayMacPrimitive(mac, { operation: "hover", arguments: [{ x: 30, y: 40 }] });
    await replayMacPrimitive(mac, {
      operation: "dragAndDrop",
      arguments: [{ x: 1, y: 2 }, { x: 3, y: 4 }],
    });
    expect(mac.calls).toEqual([
      ["click", { x: 10, y: 20 }],
      ["hover", { x: 30, y: 40 }, undefined],
      ["dragAndDrop", { x: 1, y: 2 }, { x: 3, y: 4 }, undefined],
    ]);
  });

  it("implements replace text as focus, select-all, one paste, and clipboard restore", async () => {
    const mac = new FakeMac();
    const state = fakeClipboard();
    await replayMacPrimitive(mac, {
      operation: "typeText",
      arguments: ["const probe = (", { target: { center: [1003, 417] }, replace: true }],
    }, { clipboard: state.clipboard });

    expect(mac.calls).toEqual([
      ["click", { x: 1003, y: 417 }],
      ["keyChord", ["\uE03D", "a"]],
      ["keyChord", ["\uE03D", "v"]],
    ]);
    expect(state.writes).toEqual(["const probe = (", "original"]);
    expect(state.value()).toBe("original");
  });

  it("pastes append text without select-all", async () => {
    const mac = new FakeMac();
    const state = fakeClipboard();
    await replayMacPrimitive(mac, {
      operation: "typeText",
      arguments: ["more", { replace: false }],
    }, { clipboard: state.clipboard });
    expect(mac.calls).toEqual([["keyChord", ["\uE03D", "v"]]]);
  });

  it("maps chords and clears with one deletion", async () => {
    const mac = new FakeMac();
    await replayMacPrimitive(mac, { operation: "keyboardPress", arguments: ["Cmd+Z"] });
    await replayMacPrimitive(mac, { operation: "clearInput", arguments: [] });
    expect(mac.calls).toEqual([
      ["keyChord", ["\uE03D", "z"]],
      ["keyChord", ["\uE03D", "a"]],
      ["keys", "\uE003"],
    ]);
  });

  it("preserves an explicitly shifted shortcut", async () => {
    const mac = new FakeMac();
    await replayMacPrimitive(mac, {
      operation: "keyboardPress",
      arguments: ["Cmd+Shift+Z"],
    });
    expect(mac.calls).toEqual([
      ["keyChord", ["\uE03D", "\uE008", "Z"]],
    ]);
  });

  it("maps scroll direction and target center", async () => {
    const mac = new FakeMac();
    await replayMacPrimitive(mac, {
      operation: "scroll",
      arguments: [{ direction: "up", distance: 120, locate: { center: [8, 9] } }],
    });
    expect(mac.calls).toEqual([
      ["scroll", { x: 8, y: 9, deltaX: 0, deltaY: -120 }, undefined],
    ]);
  });

  it("fails closed on malformed recorded arguments", async () => {
    const mac = new FakeMac();
    await expect(replayMacPrimitive(mac, {
      operation: "tap",
      arguments: [{ x: "10", y: 20 }],
    })).rejects.toThrow("tap point.x must be finite");
    expect(mac.calls).toEqual([]);
  });
});
