import { describe, expect, it } from "vitest";
import { regionArgument } from "../src/screenshot.js";

describe("regionArgument", () => {
  it("builds a screencapture region in logical macOS coordinates", () => {
    expect(regionArgument({ x: 178, y: 118, width: 1372, height: 880 }))
      .toBe("-R178,118,1372,880");
  });

  it("rounds fractional coordinates and rejects invalid sizes", () => {
    expect(regionArgument({ x: 1.4, y: 2.6, width: 10.2, height: 20.8 }))
      .toBe("-R1,3,10,21");
    expect(() => regionArgument({ x: 0, y: 0, width: 0, height: 20 }))
      .toThrow(/must be positive/);
  });
});
