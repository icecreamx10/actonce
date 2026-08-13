import { describe, expect, it, vi } from "vitest";
import { MidsceneFallbackDriver, buildMidsceneFallbackPrompt } from "../src/index.js";

const request = {
  segmentId: "edit-main",
  phase: "postcondition" as const,
  goal: "Make main.js contain the probe",
  expected: { id: "main-edited", expected: { text: "probe" } },
  actual: { text: "default" },
  differences: [{ path: "text", expected: "probe", actual: "default", message: "differs" }],
  idempotency: "safe" as const,
  attempt: 1,
  constraints: {
    maxActions: 3,
    timeoutMs: 1_000,
    allowedApps: ["Lynxtron"],
    forbiddenActions: ["save"],
    observationOnly: false,
  },
};

describe("MidsceneFallbackDriver", () => {
  it("runs one bounded local AI action", async () => {
    const aiAction = vi.fn().mockResolvedValue(undefined);
    const driver = new MidsceneFallbackDriver({ aiAction });
    await expect(driver.recover(request)).resolves.toEqual({ status: "completed", actionCount: 0 });
    expect(aiAction).toHaveBeenCalledOnce();
    expect(aiAction.mock.calls[0][0]).toContain("Do not continue to later task steps");
    expect(aiAction.mock.calls[0][1]).toMatchObject({ cacheable: false });
  });

  it("aborts when Midscene exceeds the action budget", async () => {
    let listener: ((event: { scope: string; phase: string }) => void) | undefined;
    const aiAction = vi.fn(async (_prompt: string, options?: { abortSignal?: AbortSignal }) => {
      listener?.({ scope: "aiAct", phase: "action_running" });
      listener?.({ scope: "aiAct", phase: "action_running" });
      if (options?.abortSignal?.aborted) throw options.abortSignal.reason;
      await new Promise<void>((resolve, reject) => {
        options?.abortSignal?.addEventListener("abort", () => reject(options.abortSignal?.reason));
        setTimeout(resolve, 20);
      });
    });
    const driver = new MidsceneFallbackDriver({
      aiAction,
      addProgressListener: (value) => {
        listener = value;
        return () => {
          listener = undefined;
        };
      },
    });
    const result = await driver.recover({
      ...request,
      constraints: { ...request.constraints, maxActions: 1 },
    });
    expect(result).toMatchObject({ status: "failed", reason: expect.stringContaining("exceeded 1") });
  });

  it("declines action recovery for never-retry postconditions", async () => {
    const aiAction = vi.fn();
    const driver = new MidsceneFallbackDriver({ aiAction });
    const result = await driver.recover({
      ...request,
      idempotency: "never-retry",
      constraints: { ...request.constraints, observationOnly: true },
    });
    expect(result.status).toBe("declined");
    expect(aiAction).not.toHaveBeenCalled();
  });

  it("builds a prompt from differences without including full current artifacts", () => {
    const prompt = buildMidsceneFallbackPrompt(request);
    expect(prompt).toContain("Checkpoint evidence");
    expect(prompt).toContain("main.js contain the probe");
    expect(prompt).not.toContain("screenshotBase64");
  });
});
