import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const validator = resolve("skills/synthesize-device-replay/scripts/validate-synthesis.mjs");
const attemptInspector = resolve("skills/synthesize-device-replay/scripts/inspect-attempts.mjs");
const extractor = resolve("skills/synthesize-device-replay/scripts/extract-segment.mjs");
const summarizer = resolve("skills/synthesize-device-replay/scripts/summarize-recording.mjs");

describe("synthesize-device-replay contract", () => {
  it("validates a selected content dwell and forbids shortening its recorded duration", () => {
    const fixture = createFixture("Sleep", "sleep");
    const path = join(fixture.root, "events.ndjson");
    const events = readFileSync(path, "utf8").trim().split("\n").map(line => JSON.parse(line));
    events[2].normalizedArguments = { timeMs: 3000 };
    writeFileSync(path, events.map(event => JSON.stringify(event)).join("\n") + "\n");
    fixture.planValue.segments[0].action.arguments = [3000];
    writeFileSync(fixture.plan, JSON.stringify(fixture.planValue));
    expect(run(fixture.root, fixture.ledger).status).toBe(0);
    expect(run(fixture.root, fixture.ledger, fixture.plan).status).toBe(0);
    fixture.planValue.segments[0].action.arguments = [1];
    writeFileSync(fixture.plan, JSON.stringify(fixture.planValue));
    expect(run(fixture.root, fixture.ledger, fixture.plan).status).toBe(1);
  });
  it("requires explicit selector evidence and retains the recorded coordinate in the plan", () => {
    const fixture = createFixture();
    const path = join(fixture.root, "events.ndjson");
    const events = readFileSync(path, "utf8").trim().split("\n").map(line => JSON.parse(line));
    events[0].evidence.nativeUi = { status: "available" };
    events[2].normalizedArguments = { locate: { center: [10, 20] } };
    writeFileSync(path, events.map(event => JSON.stringify(event)).join("\n") + "\n");
    const ledger = JSON.parse(JSON.stringify(fixture.ledgerValue));
    ledger.segments[0].loweredOperation = "tapUniqueNode";
    writeFileSync(fixture.ledger, JSON.stringify(ledger));
    expect(run(fixture.root, fixture.ledger).status).toBe(1);
    ledger.segments[0].optimization = {
      kind: "native-selector", selector: { type: "android.widget.Button", text: "Next" },
      coordinateFallback: { x: 10, y: 20 }, uniqueness: "exactly-one",
      evidence: [{ sequence: 1, modality: "native" }], rationale: "Unique Next control verified in its own native evidence",
    };
    writeFileSync(fixture.ledger, JSON.stringify(ledger));
    expect(run(fixture.root, fixture.ledger).status).toBe(0);
    const plan = JSON.parse(JSON.stringify(fixture.planValue));
    plan.segments[0].action = { operation: "tapUniqueNode", arguments: [ledger.segments[0].optimization.selector, { x: 10, y: 20 }] };
    writeFileSync(fixture.plan, JSON.stringify(plan));
    expect(run(fixture.root, fixture.ledger, fixture.plan).status).toBe(0);
    // Both files are parsed independently; relational equality is structural,
    // not reference equality or JSON key-order equality.
    ledger.segments[0].optimization.selector.withinParent = {
      selector: { type: "Row" }, sibling: { type: "Label", text: "Selected item" },
    };
    plan.segments[0].action.arguments[0] = {
      ...ledger.segments[0].optimization.selector,
      withinParent: { sibling: { text: "Selected item", type: "Label" }, selector: { type: "Row" } },
    };
    writeFileSync(fixture.ledger, JSON.stringify(ledger));
    writeFileSync(fixture.plan, JSON.stringify(plan));
    expect(run(fixture.root, fixture.ledger).status).toBe(0);
    expect(run(fixture.root, fixture.ledger, fixture.plan).status).toBe(0);
    for (const field of ["selector", "sibling"]) {
      const original = plan.segments[0].action.arguments[0].withinParent[field].type;
      plan.segments[0].action.arguments[0].withinParent[field].type = "Wrong";
      writeFileSync(fixture.plan, JSON.stringify(plan));
      expect(run(fixture.root, fixture.ledger, fixture.plan).status).toBe(1);
      plan.segments[0].action.arguments[0].withinParent[field].type = original;
    }
    for (const bad of [{ selector: { type: "Row", index: 0 }, sibling: { type: "Label", text: "Item" } },
      { selector: { type: "Row" }, sibling: { type: "Label" } },
      { selector: { type: "Row" }, sibling: { type: "Label", text: "Item", withinParent: {} } }]) {
      const original = ledger.segments[0].optimization.selector.withinParent;
      ledger.segments[0].optimization.selector.withinParent = bad;
      writeFileSync(fixture.ledger, JSON.stringify(ledger));
      expect(run(fixture.root, fixture.ledger).status).toBe(1);
      expect(run(fixture.root, fixture.ledger, fixture.plan).status).toBe(1);
      ledger.segments[0].optimization.selector.withinParent = original;
    }
    writeFileSync(fixture.ledger, JSON.stringify(ledger));
    plan.segments[0].action.arguments[1].x = 11;
    writeFileSync(fixture.plan, JSON.stringify(plan));
    expect(run(fixture.root, fixture.ledger, fixture.plan).status).toBe(1);
    ledger.segments[0].optimization.evidence[0].sequence = 2;
    writeFileSync(fixture.ledger, JSON.stringify(ledger));
    expect(run(fixture.root, fixture.ledger).status).toBe(1);
  });

  it("accepts recorded Android Launch only as launchApp through both gates", () => {
    const fixture = createFixture("Launch", "launchApp");
    expect(run(fixture.root, fixture.ledger).status).toBe(0);
    expect(run(fixture.root, fixture.ledger, fixture.plan).status).toBe(0);

    fixture.planValue.segments[0].action.operation = "tap";
    writeFileSync(fixture.plan, JSON.stringify(fixture.planValue));
    expect(run(fixture.root, fixture.ledger, fixture.plan).status).toBe(1);
  });

  it("accepts one agent-authored segment per recorded action", () => {
    const fixture = createFixture();
    const result = run(fixture.root, fixture.ledger, fixture.plan);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).phase).toBe("executable-plan");
  });

  it.each([
    { segment: 0, side: "postcondition" as const, borrowed: 4 },
    { segment: 1, side: "precondition" as const, borrowed: 2 },
    { segment: 0, side: "postcondition" as const, borrowed: 1 },
  ])("rejects borrowed checkpoint $borrowed even alongside the own $side", ({ segment, side, borrowed }) => {
    const fixture = createFixture();
    fixture.ledgerValue.segments[segment][side].evidence.push({ sequence: borrowed, modality: "screenshot" });
    writeFileSync(fixture.ledger, JSON.stringify(fixture.ledgerValue));
    for (const plan of [undefined, fixture.plan]) {
      const result = run(fixture.root, fixture.ledger, plan);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(`must not borrow checkpoint ${borrowed}`);
    }
  });

  it("allows multiple modalities from the same own checkpoint", () => {
    const fixture = createFixture();
    fixture.ledgerValue.segments[0].postcondition.evidence.push({ sequence: 2, modality: "native" });
    writeFileSync(fixture.ledger, JSON.stringify(fixture.ledgerValue));
    expect(run(fixture.root, fixture.ledger, fixture.plan).status).toBe(0);
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

  it("reports separate attempts when sequence numbers restart", () => {
    const fixture = createMultiAttemptFixture();
    const result = spawnSync(process.execPath, [attemptInspector, fixture.root], { encoding: "utf8" });
    expect(result.status).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report.attemptCount).toBe(2);
    expect(report.selectionRequired).toBe(true);
    expect(report.attempts.map((attempt: { key: string }) => attempt.key)).toEqual(["attempt-1", "attempt-2"]);
    expect(report.attempts[0].status).toBe("superseded-incomplete");
    expect(report.attempts[1].status).toBe("complete");
  });

  it("fails sequence-only extraction when a recording contains multiple attempts", () => {
    const fixture = createMultiAttemptFixture();
    const output = join(fixture.root, "segment.json");
    const result = spawnSync(process.execPath, [
      extractor, fixture.root, "--from", "1", "--to", "3", "--output", output,
    ], { encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Recording contains 2 attempts");
    expect(result.stderr).toContain("pass --attempt <key>");
  });

  it("requires attempt selection before summarizing a multi-attempt recording", () => {
    const fixture = createMultiAttemptFixture();
    const ambiguous = spawnSync(process.execPath, [summarizer, fixture.root], { encoding: "utf8" });
    expect(ambiguous.status).toBe(1);
    expect(ambiguous.stderr).toContain("Recording contains 2 attempts");

    const selected = spawnSync(process.execPath, [summarizer, fixture.root, "--attempt", "attempt-2"], {
      encoding: "utf8",
    });
    expect(selected.status).toBe(0);
    const summary = JSON.parse(selected.stdout);
    expect(summary.selectedAttempt.key).toBe("attempt-2");
    expect(summary.actions.map((action: { actionId: string }) => action.actionId)).toEqual(["success-action"]);
  });

  it("extracts only the selected successful attempt and preserves append indexes", () => {
    const fixture = createMultiAttemptFixture();
    const output = join(fixture.root, "segment.json");
    const result = spawnSync(process.execPath, [
      extractor, fixture.root, "--attempt", "attempt-2", "--from", "1", "--to", "3", "--output", output,
    ], { encoding: "utf8" });
    expect(result.status).toBe(0);
    const segment = JSON.parse(readFileSync(output, "utf8"));
    expect(segment.source.attempt.key).toBe("attempt-2");
    expect(segment.events.map((event: { actionId?: string }) => event.actionId).filter(Boolean)).toEqual([
      "success-action", "success-action", "success-action",
    ]);
    expect(segment.events.map((event: { recordingAppendIndex: number }) => event.recordingAppendIndex)).toEqual([5, 6, 7]);
  });

  it("validates repeated sequences across attempts only after selecting one attempt", () => {
    const fixture = createMultiAttemptFixture();
    const result = run(fixture.root, fixture.ledger);
    expect(result.status).toBe(0);
    const output = JSON.parse(result.stdout);
    expect(output.selectedAttempt).toBe("attempt-2");
    expect(output.completedActionCount).toBe(1);
  });
});

function run(root: string, ledger: string, plan?: string) {
  return spawnSync(process.execPath, [validator, root, "--ledger", ledger, ...(plan ? ["--plan", plan] : [])], {
    encoding: "utf8",
  });
}

function createFixture(firstOperation = "Tap", firstLowered = "tap") {
  const root = mkdtempSync(join(tmpdir(), "actonce-synthesis-"));
  const actions = [
    { id: "action-1", operation: firstOperation, lowered: firstLowered, before: 1, after: 2, completed: 3 },
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
      action: { operation: segment.loweredOperation, arguments: [] as unknown[] },
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

function createMultiAttemptFixture() {
  const root = mkdtempSync(join(tmpdir(), "actonce-multi-attempt-"));
  const events = [
    attemptStart(0, "2026-08-20T08:51:00.000Z"),
    checkpoint(1, "failed-action", "before-action"),
    checkpoint(2, "failed-action", "after-action"),
    completedAction(3, "failed-action"),
    attemptStart(0, "2026-08-20T08:55:00.000Z"),
    checkpoint(1, "success-action", "before-action"),
    checkpoint(2, "success-action", "after-action"),
    completedAction(3, "success-action"),
    {
      sequence: 4,
      kind: "midscene.progress",
      progress: { scope: "aiAct", phase: "complete" },
      wallTime: "2026-08-20T08:56:00.000Z",
    },
  ];
  writeFileSync(join(root, "manifest.json"), JSON.stringify({ recordingId: "multi", status: "complete", platform: "android" }));
  writeFileSync(join(root, "events.ndjson"), `${events.map((event) => JSON.stringify(event)).join("\n")}\n`);

  const ledger = join(root, "synthesis-ledger.json");
  writeFileSync(ledger, JSON.stringify({
    schemaVersion: 1,
    kind: "actonce.replay-synthesis-ledger",
    recordingId: "multi",
    selectedAttempt: "attempt-2",
    selectedSequenceRange: { from: 1, to: 3 },
    segments: [{
      id: "success",
      kind: "action",
      actionId: "success-action",
      recordedOperation: "Tap",
      loweredOperation: "tap",
      precondition: decision("before", 1, "before success"),
      postcondition: decision("after", 2, "after success"),
      idempotency: "safe",
      rationale: "The successful attempt contains this state transition",
    }],
    exclusions: [],
  }));
  return { root, ledger };
}

function attemptStart(sequence: number, wallTime: string) {
  return {
    sequence,
    kind: "midscene.progress",
    progress: { scope: "aiAct", phase: "start" },
    wallTime,
  };
}

function completedAction(sequence: number, actionId: string) {
  return {
    sequence,
    kind: "logical.action.completed",
    operation: "Tap",
    actionId,
    correlation: { logicalActionId: actionId },
  };
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
