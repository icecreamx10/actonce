import { describe, expect, it } from "vitest";
import { mergeIOSConfigs } from "../src/runner.js";

describe("mergeIOSConfigs", () => {
  it("combines compatible runtime settings", () => {
    expect(mergeIOSConfigs([{ wdaHost: "127.0.0.1" }, { wdaPort: 8100 }])).toEqual({ wdaHost: "127.0.0.1", wdaPort: 8100 });
  });
  it("rejects conflicting settings", () => {
    expect(() => mergeIOSConfigs([{ wdaPort: 8100 }, { wdaPort: 8200 }])).toThrow("Conflicting iOS session config.wdaPort");
  });
});
