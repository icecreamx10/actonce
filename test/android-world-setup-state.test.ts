import { describe, expect, it } from "vitest";
import { type AppResult, invalidateStaleReady } from "../benchmark/android/android-world/setup-state.js";

const ready = (app: string, revision = 0): AppResult => ({ app, status: "ready", durationMs: 1, exitCode: 0, fixtureRevision: revision });

describe("AndroidWorld native fixture readiness", () => {
  it("invalidates host-ready records when device snapshots disappeared", () => {
    const results = new Map([["markor", ready("markor")], ["vlc", ready("vlc", 1)]]);
    invalidateStaleReady(results, { markor: "markor.package", vlc: "vlc.package" }, new Set(["vlc.package"]));
    expect([...results.keys()]).toEqual(["vlc"]);
  });
  it("requires the new onboarding verification revision", () => {
    const results = new Map([["clipper", ready("clipper")]]);
    invalidateStaleReady(results, { clipper: "clipper.package" }, new Set(["clipper.package"]));
    expect(results.size).toBe(0);
  });
  it("preserves failures and ready fixtures backed by actual snapshots", () => {
    const failed: AppResult = { ...ready("sms"), status: "failed", exitCode: 1 };
    const results = new Map([["sms", failed], ["clipper", ready("clipper", 1)]]);
    invalidateStaleReady(results, { sms: "sms.package", clipper: "clipper.package" }, new Set(["clipper.package"]));
    expect(results.size).toBe(2);
    expect(results.get("sms")?.status).toBe("failed");
  });
});
