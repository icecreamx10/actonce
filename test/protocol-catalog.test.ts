import { describe, expect, it } from "vitest";
import {
  annotateWdaRequest,
  normalizeWdaTarget,
  protocolRuleCount,
} from "../interceptor/src/protocol-catalog.js";

const session = "6C76035A-2993-46AA-BCA7-DD4FB9F21544";

describe("WDA protocol catalog", () => {
  it("classifies a tap as a replayable UI mutation", () => {
    expect(
      annotateWdaRequest("POST", `/session/${session}/wda/tap`),
    ).toEqual({
      ruleId: "input.tap",
      category: "input",
      operation: "tap",
      stateEffect: "ui",
      replayRole: "candidate",
      checkpoint: {
        role: "trigger",
        phase: "after-settle",
        provides: [],
        requiredEvidence: ["screenshot", "native-ui", "device-metadata"],
      },
      confidence: "exact",
    });
  });

  it("classifies screenshots and native UI as passive observations", () => {
    expect(
      annotateWdaRequest("GET", `/session/${session}/screenshot`),
    ).toMatchObject({
      category: "observation",
      operation: "screenshot",
      stateEffect: "none",
      replayRole: "context",
      checkpoint: {
        role: "trigger",
        phase: "observation",
        provides: ["screenshot"],
        requiredEvidence: ["screenshot", "native-ui", "device-metadata"],
      },
    });
    expect(
      annotateWdaRequest("GET", `/session/${session}/source?format=json`),
    ).toMatchObject({
      category: "observation",
      operation: "native-ui-source",
      checkpoint: {
        role: "trigger",
        phase: "observation",
        provides: ["native-ui"],
        requiredEvidence: ["screenshot", "native-ui", "device-metadata"],
      },
    });
  });

  it("treats viewport reads as checkpoint metadata, not new states", () => {
    expect(
      annotateWdaRequest("GET", `/session/${session}/window/rect`),
    ).toMatchObject({
      category: "observation",
      operation: "window-rect",
      checkpoint: {
        role: "metadata",
        phase: "none",
        provides: ["viewport"],
        requiredEvidence: [],
      },
    });
  });

  it("classifies app launch as a replay candidate with a post-state", () => {
    expect(
      annotateWdaRequest("POST", `/session/${session}/wda/apps/launch`),
    ).toMatchObject({
      category: "app-lifecycle",
      operation: "launch-app",
      stateEffect: "app",
      replayRole: "candidate",
      checkpoint: {
        role: "trigger",
        phase: "after-settle",
        requiredEvidence: ["screenshot", "native-ui", "device-metadata"],
      },
    });
  });

  it("keeps unknown endpoints explicit and conservative", () => {
    expect(
      annotateWdaRequest("POST", `/session/${session}/wda/future-command`),
    ).toEqual({
      ruleId: "unknown",
      category: "unknown",
      operation: "unknown",
      stateEffect: "unknown",
      replayRole: "unknown",
      checkpoint: {
        role: "trigger",
        phase: "after-settle",
        provides: [],
        requiredEvidence: ["screenshot", "native-ui", "device-metadata"],
      },
      confidence: "unknown",
    });
  });

  it("normalizes volatile session and element identifiers", () => {
    expect(
      normalizeWdaTarget(
        `/session/${session}/element/20D4BDE8-8C53-4A6C-A564-4B68F2A37C9A/rect`,
      ),
    ).toBe("/session/:sessionId/element/:elementId/rect");
  });

  it("starts with a non-trivial but reviewable rule set", () => {
    expect(protocolRuleCount()).toBeGreaterThanOrEqual(20);
  });
});
