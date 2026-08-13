import { describe, expect, it } from "vitest";
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
});
