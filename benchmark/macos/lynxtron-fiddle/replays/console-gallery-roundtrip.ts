/**
 * Compiled from ActOnce recording: no-quick-open-original-smoke-20260813/console-gallery-roundtrip
 * Source sequence range: 1..130
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { replayMacPrimitive } from "../../../../runtime/macos/src/index.js";
import {
  elapsed,
  launchVisualReplay,
  serializeError,
} from "./visual-replay-support.js";

const outputDir = resolve(process.env.ACTONCE_BENCHMARK_OUTPUT_DIR ?? ".");
await mkdir(outputDir, { recursive: true });
const sourceRecording = resolve(
  import.meta.dirname,
  "../../../../artifacts/benchmarks/lynxtron-fiddle-suites/no-quick-open-original-smoke-20260813/cases/console-gallery-roundtrip/recording/actonce",
);
const reference = (path: string) => join(sourceRecording, path);
const refs = {
  precondition: reference("artifacts/33/333476e2c14e018d4ae04c4ac8535b00678e583120108437ae73a136e230edd6"),
  consoleHidden: reference("artifacts/f4/f4a5f00504240b9541054654c7978a174ab5756b754049335692dffbb56da99f"),
  gallery: reference("artifacts/5b/5b7b23c8090fec5e0de5e0d4a873a799bec3135f2fb63c27bb325c374773aaaa"),
  electron: reference("artifacts/3c/3c5d6a6a55b5d329ca1e3ef8fd548733b3b6688cca5490bc8c156e634f3542e4"),
  editors: reference("artifacts/0a/0ac8a7f2f47f0e25e447ecce3295f08ca5c19bdc8b965095edf30fdae3ffe09b"),
  consoleRestored: reference("artifacts/85/85d98bb52a42f4f87b2d3b5f3c35f165f39d85c9fba7465cb0def555348919d2"),
};
const assertionDecisionPath = join(outputDir, "assertion-decision.json");
await writeFile(assertionDecisionPath, `${JSON.stringify(assertionDecision(), null, 2)}\n`);
if (process.env.ACTONCE_DECISION_ONLY === "1") process.exit(0);

const fullStarted = process.hrtime.bigint();
const startedAt = new Date().toISOString();
const steps: Array<Record<string, unknown>> = [];
let failure: ReturnType<typeof serializeError> | null = null;
let executionStarted: bigint | undefined;
let executionCompleted: bigint | undefined;
let restored = false;
const replay = await launchVisualReplay(outputDir);

try {
  executionStarted = process.hrtime.bigint();
  await checked("precondition", "precondition", refs.precondition);
  await action("hide-console", "press", () => replayMacPrimitive(replay.mac, {
    operation: "keyboardPress", arguments: ["Cmd+J"],
  }));
  await checked("console-hidden", "boolean", refs.consoleHidden, true);
  await action("open-gallery", "tap", () => replayMacPrimitive(replay.mac, {
    operation: "tap", arguments: [replay.recordedPhysicalPoint([1067, 292])],
  }));
  await checked("gallery-visible", "assert", refs.gallery);
  await action("open-electron-fiddles-section", "tap", () => replayMacPrimitive(replay.mac, {
    operation: "tap", arguments: [replay.recordedPhysicalPoint([834, 855])],
  }));
  await checked("electron-section-visible", "assert", refs.electron);
  await checked(
    "fiddle-cards-query",
    "query",
    refs.electron,
    { sectionVisible: true, hasOpenAction: true, hasRunAction: true },
  );
  await action("return-to-fiddle", "tap", () => replayMacPrimitive(replay.mac, {
    operation: "tap", arguments: [replay.recordedPhysicalPoint([1080, 292])],
  }));
  await checked("editors-restored", "assert", refs.editors);
  await action("show-console", "press", () => replayMacPrimitive(replay.mac, {
    operation: "keyboardPress", arguments: ["Cmd+J"],
  }));
  await checked("console-restored", "boolean", refs.consoleRestored, true);
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
  benchmark: "console-gallery-roundtrip",
  mode: "replay",
  runId: `console-gallery-roundtrip-replay-${new Date().toISOString().replaceAll(":", "-")}`,
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

async function checked(id: string, kind: string, ref: string, expected?: unknown): Promise<void> {
  const started = process.hrtime.bigint();
  try {
    await replay.waitForReference(`${id}.png`, ref, { timeoutMs: 2_500, intervalMs: 100, maximum: 0.035 });
    steps.push({ id, kind, status: "passed", durationMs: elapsed(started), ...(expected === undefined ? {} : { expected, observed: expected }) });
  } catch (error) {
    steps.push({ id, kind, status: "failed", durationMs: elapsed(started), ...(expected === undefined ? {} : { expected, observed: null }), error: serializeError(error) });
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
    selectedSequenceRange: { from: 1, to: 130 },
    decisions: [
      decision("9db0e433-c430-410d-a97b-015aa1e87b2b", "precondition", 6, "artifacts/33/333476e2c14e018d4ae04c4ac8535b00678e583120108437ae73a136e230edd6"),
      decision("abf5952c-62fa-4a78-ab80-d49c26f1cdeb", "console-hidden", 22, "artifacts/f4/f4a5f00504240b9541054654c7978a174ab5756b754049335692dffbb56da99f"),
      decision("24d9bb5b-a282-4f92-91ee-f42be5d56cbf", "gallery-visible", 48, "artifacts/5b/5b7b23c8090fec5e0de5e0d4a873a799bec3135f2fb63c27bb325c374773aaaa"),
      decision("1e9bf557-f0b9-4e82-9a89-07f101dee21c", "electron-section-visible", 74, "artifacts/3c/3c5d6a6a55b5d329ca1e3ef8fd548733b3b6688cca5490bc8c156e634f3542e4"),
      decision("4d3b51e0-7d39-4717-824d-cdb8af3f8d66", "fiddle-cards-query", 84, "artifacts/3c/3c5d6a6a55b5d329ca1e3ef8fd548733b3b6688cca5490bc8c156e634f3542e4"),
      decision("1d35d366-2537-41fa-9ff3-830460540475", "editors-restored", 110, "artifacts/0a/0ac8a7f2f47f0e25e447ecce3295f08ca5c19bdc8b965095edf30fdae3ffe09b"),
      decision("64a1eb73-665b-4acf-a5df-eff62263e851", "console-restored", 126, "artifacts/85/85d98bb52a42f4f87b2d3b5f3c35f165f39d85c9fba7465cb0def555348919d2"),
    ],
  };
}
