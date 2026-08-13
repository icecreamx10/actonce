import { describe, expect, it, vi } from "vitest";
import { IOSCheckpointDriver, compareIOSCheckpoint } from "../src/checkpoint.js";

describe("iOS checkpoints", () => {
  it("compares recorded WDA source facts", () => {
    expect(compareIOSCheckpoint(
      { source: { includes: ["关于本机"], excludes: ["Airplane Mode"] } },
      { source: '<XCUIElementTypeStaticText name="关于本机"/>', captureErrors: [] },
    )).toEqual([]);
  });

  it("reports semantic source differences", () => {
    const differences = compareIOSCheckpoint(
      { source: { includes: ["关于本机"] } },
      { source: "<xml />", captureErrors: [] },
    );
    expect(differences[0]).toMatchObject({ path: "source", message: expect.stringContaining("WDA source") });
  });

  it("captures source through the session boundary", async () => {
    const driver = new IOSCheckpointDriver({ source: async () => "Name iOS Version" } as never);
    const result = await driver.verify({ id: "about", expected: { source: { includes: ["iOS Version"] } } });
    expect(result.status).toBe("matched");
  });

  it("invalidates a mismatched source so settle polling captures again", async () => {
    const invalidateObservation = vi.fn();
    const driver = new IOSCheckpointDriver({ source: async () => "Catalog", invalidateObservation } as never);
    const result = await driver.verify({ id: "detail", expected: { source: { includes: ["Add to cart"] } } });
    expect(result.status).toBe("mismatched");
    expect(invalidateObservation).toHaveBeenCalledOnce();
  });
});
