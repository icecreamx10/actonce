import { describe, expect, it } from "vitest";
import { waitUntil } from "../src/wait.js";

describe("waitUntil", () => {
  it("returns the first truthy value", async () => {
    let calls = 0;
    await expect(waitUntil(() => ++calls >= 3 ? "ready" : undefined, {
      timeoutMs: 100,
      intervalMs: 1,
    })).resolves.toBe("ready");
  });

  it("includes the last transient failure on timeout", async () => {
    await expect(waitUntil(() => {
      throw new Error("not ready");
    }, { timeoutMs: 1, intervalMs: 1, message: "editor unavailable" }))
      .rejects.toThrow("editor unavailable: not ready");
  });
});
