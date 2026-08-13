import { describe, expect, it } from "vitest";
import {
  centeredWindowFrame,
  isMacAccessibilityPermissionError,
  sameWindowFrame,
} from "../src/window-setup.js";

describe("centeredWindowFrame", () => {
  it("centers a fully visible window inside the selected display", () => {
    expect(centeredWindowFrame(
      { id: 0, x: 0, y: 0, width: 1728, height: 1117 },
      1372,
      880,
      40,
    )).toEqual({ x: 178, y: 118, width: 1372, height: 880 });
  });

  it("uses the selected display's global origin", () => {
    expect(centeredWindowFrame(
      { id: 1, x: 1728, y: 0, width: 1920, height: 1080 },
      1000,
      800,
      40,
    )).toEqual({ x: 2188, y: 140, width: 1000, height: 800 });
  });

  it("rejects a window that would touch the edge margin", () => {
    expect(() => centeredWindowFrame(
      { id: 0, x: 0, y: 0, width: 1000, height: 800 },
      950,
      700,
      40,
    )).toThrow(/does not fit/);
  });
});

describe("sameWindowFrame", () => {
  it("requires both placement and size to settle", () => {
    const expected = { x: 178, y: 118, width: 1372, height: 880 };
    expect(sameWindowFrame(expected, expected)).toBe(true);
    expect(sameWindowFrame({ ...expected, width: 1200 }, expected)).toBe(false);
    expect(sameWindowFrame({ ...expected, x: 0 }, expected)).toBe(false);
  });
});

describe("isMacAccessibilityPermissionError", () => {
  it("recognizes the macOS assistive-access error code", () => {
    expect(isMacAccessibilityPermissionError({
      stderr: "execution error: osascript is not allowed assistive access. (-25211)",
    })).toBe(true);
  });

  it("recognizes the localized macOS error", () => {
    expect(isMacAccessibilityPermissionError(new Error("“osascript”不允许辅助访问。(-25211)"))).toBe(true);
  });

  it("does not classify an unopened window as a permission failure", () => {
    expect(isMacAccessibilityPermissionError(new Error("target window is not ready"))).toBe(false);
  });
});
