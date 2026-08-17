import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveManagedAppiumHome } from "../src/appium-server.js";

describe("managed Appium workspace resolution", () => {
  it("uses the real installation root for a hoisted mac2 driver", async () => {
    const home = resolveManagedAppiumHome();
    await expect(access(resolve(home, "node_modules/appium-mac2-driver/package.json")))
      .resolves.toBeUndefined();
  });

  it("honors an explicit Appium home", () => {
    expect(resolveManagedAppiumHome("./custom-appium-home"))
      .toBe(resolve("./custom-appium-home"));
  });
});
