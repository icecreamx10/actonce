/**
 * Compiled from ActOnce recording: editor-undo-redo-roundtrip-formal-original-1-retry2-20260813
 * Source sequence range: 1..106
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { replayMacPrimitive } from "../../../../runtime/macos/src/index.js";
import { elapsed, launchVisualReplay, serializeError } from "./visual-replay-support.js";

const PROBE = `// ActOnce undo redo probe
const { app, LynxWindow } = require('lynxtron');

app.whenReady().then(() => {
  const win = new LynxWindow({
    width: 640,
    height: 480,
    title: 'ActOnce Undo Redo Probe',
  });
});
`;
const outputDir = resolve(process.env.ACTONCE_BENCHMARK_OUTPUT_DIR ?? ".");
await mkdir(outputDir, { recursive: true });
const sourceRecording = resolve(
  import.meta.dirname,
  "../../../../artifacts/benchmarks/lynxtron-fiddle/editor-undo-redo-roundtrip-formal-original-1-retry2-20260813/recording/actonce",
);
const reference = (path: string) => join(sourceRecording, path);
const refs = {
  precondition: reference("artifacts/af/af04e6ee26da71ece84e26a766f0d3dd27a8e9f05a73a3744f4fc7312f3b8e9e"),
  probe: reference("artifacts/cb/cb92b5f2356dea39419f6114c5f217612dde11c5b4fadb2e123093f29ca494f8"),
  restoredFirst: reference("artifacts/9e/9e61b3230e4dbd9cdd40e92dedfc7635bb3e31e971b2d592c90b226aa37d78fe"),
  redone: reference("artifacts/bb/bb8e90ca07a9a56f905973506f5d38d211f4eb62f1285b23e72bc976a7049323"),
  restoredFinal: reference("artifacts/00/00aeb8b784b297c4e725bed6a50bdb3af7afe2fc8e2c0dcb4405f75aae533d3e"),
};
await writeFile(join(outputDir, "assertion-decision.json"), `${JSON.stringify(assertionDecision(), null, 2)}\n`);
if (process.env.ACTONCE_DECISION_ONLY === "1") process.exit(0);

const fullStarted = process.hrtime.bigint();
const startedAt = new Date().toISOString();
const steps: Array<Record<string, unknown>> = [];
let failure: ReturnType<typeof serializeError> | null = null;
let executionStarted: bigint | undefined;
let executionCompleted: bigint | undefined;
let restored = false;
const replay = await launchVisualReplay(outputDir);
const inputTarget = replay.recordedLogicalTarget([721, 479], "recorded top-left main.js editor");

try {
  executionStarted = process.hrtime.bigint();
  await checked("precondition", "precondition", refs.precondition);
  await action("apply-probe-source", "input", () => replayMacPrimitive(replay.mac, {
    operation: "typeText", arguments: [PROBE, { target: inputTarget, replace: true }],
  }));
  await checked("probe-source-applied", "assert", refs.probe);
  await press("undo-paste-first", "Cmd+Z");
  await press("undo-clear-first", "Cmd+Z");
  await checked("first-restore", "assert", refs.restoredFirst);
  await press("redo-clear", "Cmd+Shift+Z");
  await press("redo-paste", "Cmd+Shift+Z");
  await checked("redo-source-visible", "assert", refs.redone);
  await press("final-undo-paste", "Cmd+Z");
  await press("final-undo-clear", "Cmd+Z");
  await checked("final-source-restored", "assert", refs.restoredFinal);
  restored = true;
} catch (error) {
  failure = serializeError(error);
} finally {
  if (executionStarted) executionCompleted = process.hrtime.bigint();
  await replay.close();
}

const passed = failure === null && restored;
const result = {
  schemaVersion: 1,
  benchmark: "editor-undo-redo-roundtrip",
  mode: "replay",
  runId: `editor-undo-redo-roundtrip-replay-${new Date().toISOString().replaceAll(":", "-")}`,
  status: passed ? "passed" : "failed",
  startedAt,
  completedAt: new Date().toISOString(),
  durationMs: elapsed(fullStarted),
  executionDurationMs: executionStarted && executionCompleted ? Number(executionCompleted - executionStarted) / 1_000_000 : null,
  steps,
  replayDiagnostics: {
    strategy: "deterministic",
    fallbackCount: 0,
    fallbackDurationMs: 0,
    ...replay.metrics,
    visualEvaluator: "recorded-screenshot-region-comparison",
  },
  assertionDecision: "assertion-decision.json",
  artifacts: { screenshots: replay.screenshots, assertionDecision: "assertion-decision.json" },
  cleanup: { saved: false, restored },
  error: failure,
};
await writeFile(join(outputDir, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
if (!passed) process.exitCode = 2;

async function press(id: string, key: string): Promise<void> {
  await action(id, "press", () => replayMacPrimitive(replay.mac, {
    operation: "keyboardPress", arguments: [key],
  }));
}

async function checked(id: string, kind: string, ref: string): Promise<void> {
  const started = process.hrtime.bigint();
  try {
    await replay.waitForReference(`${id}.png`, ref, { timeoutMs: 1_500, intervalMs: 75, maximum: 0.035 });
    steps.push({ id, kind, status: "passed", durationMs: elapsed(started) });
  } catch (error) {
    steps.push({ id, kind, status: "failed", durationMs: elapsed(started), error: serializeError(error) });
    throw error;
  }
}

async function action(id: string, kind: string, run: () => Promise<void>): Promise<void> {
  const started = process.hrtime.bigint();
  try {
    await run();
    steps.push({ id, kind, status: "passed", durationMs: elapsed(started) });
  } catch (error) {
    steps.push({ id, kind, status: "failed", durationMs: elapsed(started), error: serializeError(error) });
    throw error;
  }
}

function assertionDecision() {
  const rejected = [
    { type: "macos-ax", reason: "selected range contains no native UI evidence" },
    { type: "dom", reason: "Midscene observations declared domIncluded=false" },
    { type: "wda", reason: "recording platform is macOS" },
    { type: "visual-ai", reason: "window-relative screenshot comparison establishes the recorded state without a model" },
  ];
  const decision = (observationTaskId: string, stepId: string, sequence: number, artifact: string) => ({
    observationTaskId,
    stepId,
    recordedMode: "visual",
    evidence: [{ sequence, artifact }],
    compiledEvaluator: "recorded-screenshot-region-comparison",
    rejectedEvaluators: rejected,
  });
  return {
    schemaVersion: 1,
    recording: sourceRecording,
    selectedSequenceRange: { from: 1, to: 106 },
    decisions: [
      decision("faaf426c-74b8-48ff-9ab4-dd0d86802ffc", "precondition", 6, "artifacts/af/af04e6ee26da71ece84e26a766f0d3dd27a8e9f05a73a3744f4fc7312f3b8e9e"),
      decision("51e9b2e3-678a-4d6a-917d-496e5a53da11", "probe-source-applied", 36, "artifacts/cb/cb92b5f2356dea39419f6114c5f217612dde11c5b4fadb2e123093f29ca494f8"),
      decision("dfc9b69b-f450-457d-9afb-23adef34ac9f", "first-restore", 58, "artifacts/9e/9e61b3230e4dbd9cdd40e92dedfc7635bb3e31e971b2d592c90b226aa37d78fe"),
      decision("1c144f19-6402-4da2-9361-daffbb434621", "redo-source-visible", 80, "artifacts/bb/bb8e90ca07a9a56f905973506f5d38d211f4eb62f1285b23e72bc976a7049323"),
      decision("1714191d-71c7-4dfa-8f30-1c6f00f75211", "final-source-restored", 102, "artifacts/00/00aeb8b784b297c4e725bed6a50bdb3af7afe2fc8e2c0dcb4405f75aae533d3e"),
    ],
  };
}
