import { describe, expect, it } from "vitest";
import { compareAndroidCheckpoint } from "../src/checkpoint.js";

describe("compareAndroidCheckpoint", () => {
  it("checks required and forbidden UI-tree values", () => {
    expect(
      compareAndroidCheckpoint(
        {
          source: {
            includes: ["Checkout", "Rebecca Winter"],
            excludes: ["Login"],
          },
        },
        { source: "Checkout Rebecca Winter", captureErrors: [] },
      ),
    ).toEqual([]);
  });

  it("reports missing values", () => {
    expect(
      compareAndroidCheckpoint(
        { source: { includes: ["Checkout"] } },
        { source: "Products", captureErrors: [] },
      )[0]?.path,
    ).toBe("source");
  });
});
