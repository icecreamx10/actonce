import { describe, expect, it } from "vitest";
import { mergeConfigs } from "../src/runner.js";

describe("mergeConfigs", () => {
  it("combines non-conflicting fragment and CLI settings", () => {
    expect(mergeConfigs([
      { bundleId: "com.example.app", noReset: true },
      { server: { hostname: "127.0.0.1", port: 4723 } },
    ])).toEqual({
      bundleId: "com.example.app",
      noReset: true,
      server: { hostname: "127.0.0.1", port: 4723 },
    });
  });

  it("allows fragments to repeat the same setting", () => {
    expect(mergeConfigs([
      { bundleId: "com.example.app" },
      { bundleId: "com.example.app" },
    ])).toEqual({ bundleId: "com.example.app" });
  });

  it("rejects ambiguous fragment settings", () => {
    expect(() => mergeConfigs([
      { bundleId: "com.example.one" },
      { bundleId: "com.example.two" },
    ])).toThrow(/Conflicting replay session config.bundleId/);
  });
});
