import { describe, expect, it, vi } from "vitest";
import { AndroidCheckpointDriver, compareAndroidCheckpoint } from "../src/checkpoint.js";

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

  it("invalidates a mismatched source so settle polling captures again", async () => {
    const invalidateObservation = vi.fn();
    const driver = new AndroidCheckpointDriver({ source: async () => "Products", invalidateObservation } as never);
    const result = await driver.verify({ id: "product", expected: { source: { includes: ["Add to cart"] } } });
    expect(result.status).toBe("mismatched");
    expect(invalidateObservation).toHaveBeenCalledOnce();
  });
});
