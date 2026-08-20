import { describe, expect, it } from "vitest";
import { ReplayPlanError, parseReplayPlan } from "../src/index.js";
import type { ReplayPlanFile } from "../src/index.js";

const plan: ReplayPlanFile = {
  schemaVersion: 1,
  recordingId: "ios-settings-about",
  version: 1,
  platform: "ios",
  segments: [
    {
      id: "open-about",
      precondition: { id: "general-ready", state: "settings.general", expected: { source: { includes: ["About"] } } },
      action: { operation: "tap", arguments: [{ x: 218, y: 404 }] },
      postcondition: {
        id: "about-visible",
        state: "settings.about",
        expected: { source: { includes: ["ProductModelName"] } },
        settle: { timeoutMs: 2500, intervalMs: 100 },
      },
    },
  ],
};

describe("parseReplayPlan", () => {
  it("round-trips a plan byte-identical, preserving checkpoint contracts", () => {
    const raw = `${JSON.stringify(plan, null, 2)}\n`;
    const parsed = parseReplayPlan(raw);
    expect(parsed).toEqual(plan);
    // The checkpoint contracts (the frozen state assertions) survive intact.
    expect(parsed.segments[0].precondition.state).toBe("settings.general");
    expect(parsed.segments[0].postcondition.expected).toEqual({ source: { includes: ["ProductModelName"] } });
  });

  it("proves a v1 -> v2 diff that only rewrites `action` leaves the contracts unchanged", () => {
    const v2: ReplayPlanFile = structuredClone(plan);
    v2.version = 2;
    v2.segments[0].action = { operation: "tap", arguments: [{ x: 220, y: 452 }] };
    // The important checkpoints (the *what*) are byte-identical across versions.
    expect(v2.segments[0].precondition).toEqual(plan.segments[0].precondition);
    expect(v2.segments[0].postcondition).toEqual(plan.segments[0].postcondition);
    // Only the *how* differs.
    expect(v2.segments[0].action).not.toEqual(plan.segments[0].action);
  });

  it("rejects a segment missing its postcondition state contract", () => {
    const broken = structuredClone(plan) as unknown as { segments: { postcondition?: unknown }[] };
    delete broken.segments[0].postcondition;
    expect(() => parseReplayPlan(JSON.stringify(broken))).toThrow(ReplayPlanError);
    expect(() => parseReplayPlan(JSON.stringify(broken))).toThrow(/postcondition.*required/);
  });

  it("rejects a checkpoint missing its `expected` assertion", () => {
    const broken = structuredClone(plan);
    delete (broken.segments[0].precondition as { expected?: unknown }).expected;
    expect(() => parseReplayPlan(JSON.stringify(broken))).toThrow(/expected.*required/);
  });

  it("rejects an unsupported schemaVersion", () => {
    expect(() => parseReplayPlan(JSON.stringify({ ...plan, schemaVersion: 2 }))).toThrow(/schemaVersion/);
  });

  it("rejects a plan whose action is not { operation, arguments }", () => {
    const broken = structuredClone(plan) as unknown as { segments: { action: unknown }[] };
    broken.segments[0].action = { operation: "tap" };
    expect(() => parseReplayPlan(JSON.stringify(broken))).toThrow(/action must be/);
  });

  it("rejects automatic fallback metadata in a compiled plan", () => {
    const broken = structuredClone(plan) as unknown as {
      segments: Array<{ fallback?: unknown }>;
    };
    broken.segments[0].fallback = { goal: "Recover automatically" };
    expect(() => parseReplayPlan(JSON.stringify(broken))).toThrow(
      /fallback is not supported.*deterministic/,
    );
  });
});
