import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const validator = resolve("skills/synthesize-device-replay/scripts/validate-synthesis.mjs");

describe("synthesize-device-replay contract", () => {
  it("accepts one agent-authored segment per recorded action", () => {
    const fixture = createFixture();
    const result = run(fixture.root, fixture.ledger, fixture.plan);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).phase).toBe("executable-plan");
  });

  it("rejects task-level start/end coverage that omits an intermediate action", () => {
    const fixture = createFixture();
    const ledger = JSON.parse(JSON.stringify(fixture.ledgerValue));
    ledger.segments.pop();
    writeFileSync(fixture.ledger, JSON.stringify(ledger));
    const result = run(fixture.root, fixture.ledger);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("is neither replayed nor explicitly excluded");
  });

  it("rejects an executable plan that merges ledger-authored segments", () => {
    const fixture = createFixture();
    const plan = JSON.parse(JSON.stringify(fixture.planValue));
    plan.segments.pop();
    writeFileSync(fixture.plan, JSON.stringify(plan));
    const result = run(fixture.root, fixture.ledger, fixture.plan);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("must contain exactly 2 ledger-authored segments");
  });

  it("rejects a task-wide wrapper disguised as one lowered action", () => {
    const fixture = createFixture();
    const ledger = JSON.parse(JSON.stringify(fixture.ledgerValue));
    ledger.segments[0].loweredOperation = "replayRecordedPrimitives";
    writeFileSync(fixture.ledger, JSON.stringify(ledger));
    const result = run(fixture.root, fixture.ledger);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("loweredOperation must be tap for recorded Tap");
  });
});

function run(root: string, ledger: string, plan?: string) {
  return spawnSync(process.execPath, [validator, root, "--ledger", ledger, ...(plan ? ["--plan", plan] : [])], {
    encoding: "utf8",
  });
}

function createFixture() {
  const root = mkdtempSync(join(tmpdir(), "actonce-synthesis-"));
  const actions = [
    { id: "action-1", operation: "Tap", lowered: "tap", before: 1, after: 2, completed: 3 },
    { id: "action-2", operation: "Input", lowered: "typeText", before: 4, after: 5, completed: 6 },
  ];
  const events = actions.flatMap((action) => [
    checkpoint(action.before, action.id, "before-action"),
    checkpoint(action.after, action.id, "after-action"),
    {
      sequence: action.completed,
      kind: "logical.action.completed",
      operation: action.operation,
      actionId: action.id,
      correlation: { logicalActionId: action.id },
    },
  ]);
  writeFileSync(join(root, "manifest.json"), JSON.stringify({ recordingId: "fixture", status: "complete", platform: "android" }));
  writeFileSync(join(root, "events.ndjson"), `${events.map((event) => JSON.stringify(event)).join("\n")}\n`);

  const ledgerValue = {
    schemaVersion: 1,
    kind: "actonce.replay-synthesis-ledger",
    recordingId: "fixture",
    selectedSequenceRange: { from: 1, to: 6 },
    segments: actions.map((action, index) => ({
      id: `segment-${index + 1}`,
      kind: "action",
      actionId: action.id,
      recordedOperation: action.operation,
      loweredOperation: action.lowered,
      precondition: decision(`before-${index + 1}`, action.before, "before state"),
      postcondition: decision(`after-${index + 1}`, action.after, "after state"),
      idempotency: "safe",
      rationale: "Agent-authored recorded state transition",
    })),
    exclusions: [],
  };
  const planValue = {
    schemaVersion: 1,
    recordingId: "fixture",
    version: 1,
    platform: "android",
    segments: ledgerValue.segments.map((segment) => ({
      id: segment.id,
      precondition: { id: segment.precondition.checkpointId, expected: { source: { includes: ["before"] } } },
      action: { operation: segment.loweredOperation, arguments: [] },
      postcondition: { id: segment.postcondition.checkpointId, expected: { source: { includes: ["after"] } } },
      idempotency: segment.idempotency,
    })),
  };
  const ledger = join(root, "synthesis-ledger.json");
  const plan = join(root, "replay-plan.json");
  writeFileSync(ledger, JSON.stringify(ledgerValue));
  writeFileSync(plan, JSON.stringify(planValue));
  return { root, ledger, plan, ledgerValue, planValue };
}

function checkpoint(sequence: number, actionId: string, phase: "before-action" | "after-action") {
  return {
    sequence,
    kind: "checkpoint.captured",
    phase,
    actionId,
    correlation: { logicalActionId: actionId },
    evidence: { screenshot: { path: `artifacts/${sequence}.png` } },
  };
}

function decision(checkpointId: string, sequence: number, fact: string) {
  return {
    checkpointId,
    evidence: [{ sequence, modality: "screenshot" }],
    facts: [fact],
  };
}
