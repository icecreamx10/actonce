import { describe, expect, it, vi } from "vitest";
import { measureStep } from "../benchmark/lib/metrics.js";

describe("measureStep", () => {
  it("records a successful operation", async () => {
    const metric = await measureStep("example", async () => undefined);

    expect(metric.name).toBe("example");
    expect(metric.success).toBe(true);
    expect(metric.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("turns an exception into a failed metric", async () => {
    const operation = vi.fn(async () => {
      throw new Error("postcondition not reached");
    });

    const metric = await measureStep("verify", operation);

    expect(metric).toMatchObject({
      name: "verify",
      success: false,
      error: "postcondition not reached",
    });
  });
});
