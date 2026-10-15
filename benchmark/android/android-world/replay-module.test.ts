import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { originalTimingBoundary, parseReplayModuleArgs, runReplayModule, summarizeCheckpointCaptureTiming, validateReplayModule, validateReplaySelection } from "./replay-module.js";
import type { AndroidSession, createAndroidReplayFlow } from "@byted-lynx/actonce-android";

describe("benchmark replay module runner", () => {
  it("aggregates checked samples once and keeps unavailable legacy timings explicit", () => {
    const checked = (captureTiming?: Record<string, unknown>) => ({ kind: "replay.checkpoint.checked", checkpoint: { actual: { captureTiming } } });
    expect(summarizeCheckpointCaptureTiming([checked()])).toBeNull();
    expect(summarizeCheckpointCaptureTiming([
      checked({ sourceDurationMs: 10, screenshotDurationMs: 20, visualComparisonDurationMs: 5 }),
      checked({ sourceDurationMs: 0 }), checked(),
      { kind: "replay.checkpoint.settle.matched", checkpoint: { actual: { captureTiming: { sourceDurationMs: 10 } } } },
    ])).toEqual({ checkedSamples: 3, timedSamples: 2, complete: false, source: { samples: 2, durationMs: 10 }, screenshot: { samples: 1, durationMs: 20 }, visualComparison: { samples: 1, durationMs: 5 } });
    expect(summarizeCheckpointCaptureTiming([checked({ sourceDurationMs: -1, screenshotDurationMs: NaN })])).toMatchObject({ source: { samples: 0 }, screenshot: { samples: 0 } });
  });
  it.each([false, true])("times connect + execution + close, preserves diagnostics and writes afterwards (failed=%s)", async failure => {
    let time = 0n;
    const order: string[] = [];
    const result = await runReplayModule({ modulePath: "authored.ts", serial: "leased", outputDir: "unused", args: ["hello"] }, {
      now: () => time,
      load: async () => { order.push("load"); return { run: async context => { expect(context.args).toEqual(["hello"]); time += 20_000_000n; if (failure) throw new Error("action failed"); } }; },
      connect: async config => { expect(config?.serial).toBe("leased"); order.push("connect"); time += 10_000_000n; return { serial: "leased", screenshot: async () => { order.push("screenshot"); time += 3_000_000n; return "aW1hZ2U="; }, invalidateObservation() {}, source: async () => { order.push("source"); time += 2_000_000n; return '{"text":"native"}'; }, close: async () => { order.push("close"); time += 30_000_000n; if (failure) throw new Error("cleanup failed"); } } as unknown as AndroidSession; },
      createFlow: ((_android: AndroidSession, options: Parameters<typeof createAndroidReplayFlow>[1]) => { expect(options?.policy).toBe("disabled"); options?.emit?.({ type: "test" } as never); return { diagnostics: () => ({ retries: 2, fallback: 0, timeouts: 1 }) }; }) as unknown as typeof createAndroidReplayFlow,
      writeArtifacts: async (_path, value, events, evidence) => { order.push("write"); expect((value as { executionDurationMs: number }).executionDurationMs).toBe(65); expect(events).toHaveLength(1); expect(evidence.screenshot?.toString()).toBe("image"); expect(JSON.parse(evidence.source!)).toEqual({ text: "native" }); expect(JSON.stringify(value)).not.toContain("aW1hZ2U="); time += 100_000_000n; },
    });
    expect(result.executionDurationMs).toBe(65);
    expect(result.status).toBe(failure ? "failed" : "passed");
    expect(result.errors).toHaveLength(failure ? 2 : 0);
    expect(result.replayDiagnostics).toEqual({ retries: 2, fallback: 0, timeouts: 1 });
    expect(order).toEqual(["load", "connect", "screenshot", "source", "close", "write"]);
  });
  it("rejects invalid callable/options and mismatched serial before connecting", async () => {
    expect(() => validateReplayModule({} , "leased")).toThrow(/function/);
    expect(() => validateReplayModule({ run() {}, config: { systemPort: -1 } }, "leased")).toThrow(/systemPort/);
    expect(() => validateReplayModule({ run() {}, config: [] as never }, "leased")).toThrow(/Options/);
    let connected = false;
    await expect(runReplayModule({ modulePath: "authored.ts", serial: "leased", outputDir: "unused" }, { load: async () => ({ default() {}, config: { serial: "other" } }), connect: async () => { connected = true; throw new Error(); } })).rejects.toThrow(/leased serial/);
    expect(connected).toBe(false);
  });
  it("reports a connect failure with elapsed timing", async () => {
    let ticks = 0;
    const result = await runReplayModule({ modulePath: "authored.ts", serial: "leased", outputDir: "unused" }, { load: async () => ({ default() {} }), now: () => BigInt(ticks++ * 5_000_000), connect: async () => { throw new Error("connect failed"); }, writeArtifacts: async () => {} });
    expect(result.status).toBe("failed"); expect(result.executionDurationMs).toBe(5); expect(result.replayDiagnostics).toBeNull();
  });
  it.each(["matched", "recovered", "checkpoint-mismatch"])("classifies final segment outcome %s", async outcome => {
    const result = await runReplayModule({ modulePath: "authored.ts", serial: "leased", outputDir: "unused" }, {
      load: async () => ({ run() {} }),
      connect: async () => ({ serial: "leased", screenshot: async () => "aW1hZ2U=", source: async () => "{}", invalidateObservation() {}, close: async () => {} }) as unknown as AndroidSession,
      createFlow: (() => ({ diagnostics: () => ({ segments: [{ outcome, retry: { attempts: 1 }, guard: { timeoutCount: 1 } }] }) })) as unknown as typeof createAndroidReplayFlow,
      writeArtifacts: async () => {},
    });
    expect(result.status).toBe(outcome === "checkpoint-mismatch" ? "failed" : "passed");
  });
  it("preserves capture failures and still closes the session", async () => {
    let closed = false;
    const result = await runReplayModule({ modulePath: "authored.ts", serial: "leased", outputDir: "unused" }, {
      load: async () => ({ run() {} }),
      connect: async () => ({ serial: "leased", screenshot: async () => { throw new Error("capture failed"); }, source: async () => "invalid-json", invalidateObservation() {}, close: async () => { closed = true; } }) as unknown as AndroidSession,
      createFlow: (() => ({ diagnostics: () => ({ segments: [] }) })) as unknown as typeof createAndroidReplayFlow,
      writeArtifacts: async () => { expect(closed).toBe(true); },
    });
    expect(result.status).toBe("failed"); expect(result.errors.map(error => error.phase)).toEqual(["final-screenshot", "final-source"]);
  });
  it("infers legacy original scope only from an exact complete manifest", () => {
    const manifest = { status: "complete", integrity: "complete", startedAt: "2026-10-12T00:00:00Z", completedAt: "2026-10-12T00:00:01Z" };
    const original = { executionDurationMs: 1000 };
    expect(originalTimingBoundary(original, manifest)).toMatchObject({ scope: "recording-session", provenance: { kind: "legacy-manifest-exact-duration-inference" } });
    expect(originalTimingBoundary(original, null)).toBeNull();
    expect(originalTimingBoundary(original, { ...manifest, status: "incomplete" })).toBeNull();
    expect(originalTimingBoundary(original, { ...manifest, integrity: "incomplete" })).toBeNull();
    expect(originalTimingBoundary(original, { startedAt: manifest.startedAt })).toBeNull();
    expect(originalTimingBoundary(original, { ...manifest, completedAt: "bad" })).toBeNull();
    expect(originalTimingBoundary({ executionDurationMs: 999 }, manifest)).toBeNull();
    expect(originalTimingBoundary({ timingBoundary: { scope: "legacy" } }, manifest)).toEqual({ scope: "legacy" });
    expect(original).toEqual({ executionDurationMs: 1000 });
  });
  it("parses runner flags and forwards argv after --", () => {
    expect(() => validateReplaySelection("module.ts", "entry.ts")).toThrow(/only one/);
    expect(() => validateReplaySelection(undefined, "entry.ts")).not.toThrow();
    expect(() => validateReplaySelection("module.ts", undefined)).not.toThrow();
    expect(parseReplayModuleArgs(["--replay-module", "task.ts", "--serial", "leased", "--output", "out", "--", "--custom", "value"]).args).toEqual(["--custom", "value"]);
    expect(() => parseReplayModuleArgs(["--replay-module", "--serial"])).toThrow(/requires a value/);
    expect(() => parseReplayModuleArgs(["--replay-entry", "legacy.ts"])).toThrow(/Unknown/);
  });
  it("benchmark CLI rejects ambiguous or missing module paths before device activity", () => {
    for (const [flags, message] of [
      [["--replay-module", "module.ts", "--replay-entry", "legacy.ts"], "Use only one"],
      [["--replay-module"], "requires a path"],
    ] as const) {
      const child = spawnSync("node_modules/.bin/tsx", ["benchmark/android/android-world/benchmark.ts", ...flags], { encoding: "utf8" });
      expect(child.status).not.toBe(0);
      expect(child.stderr).toContain(message);
    }
  });
});
