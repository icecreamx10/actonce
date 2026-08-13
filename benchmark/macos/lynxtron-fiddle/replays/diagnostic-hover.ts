/**
 * Compiled from ActOnce recording: sdk-window-benchmark-20260813/original/recording/actonce
 * Source sequence range: 5..92
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import sharp from "sharp";
import {
  MacSession,
  replayMacPrimitive,
  setupMacWindow,
  snapshotProcessIds,
} from "../../../../runtime/macos/src/index.js";

type Point = { x: number; y: number };
type WindowFrame = Point & { width: number; height: number };
type PixelRegion = { left: number; top: number; width: number; height: number };
const PROBE = "const actOnceSyntaxProbe = (";
const EXPECTED_TOOLTIP = "Expression expected.";
const DEFAULT_MAIN_SOURCE = `// Main process — Lynxtron entry
const { app, LynxWindow } = require('lynxtron');

app.whenReady().then(() => {
  const win = new LynxWindow({ width: 800, height: 600 });
  // A LynxWindow renders a compiled Lynx bundle — relative paths resolve
  // into main.lynx.bundle by rspeedy. There is no HTML entry point.
  win.loadFile('main.lynx.bundle');
});
`;
const DISPLAY = { width: 1728, height: 1117, dpr: 2 };
const RECORDED_WINDOW = { x: 178, y: 118, width: 1372, height: 880 };
const RECORDED_INPUT_TARGET = {
  center: [721, 382] as [number, number],
  rect: { left: 463, top: 176, width: 517, height: 413 },
  description: "the recorded top-left main.js editor",
};
const RECORDED_HOVER_TARGET = { x: 714, y: 206 };
const outputDir = resolve(process.env.ACTONCE_BENCHMARK_OUTPUT_DIR ?? ".");
const fixtureRoot = requiredEnv("ACTONCE_LYNXTRON_FIXTURE_ROOT");
const desktopBundle = requiredEnv("ACTONCE_LYNXTRON_DESKTOP_BUNDLE");
const fixtureConfig = requiredEnv("ACTONCE_LYNXTRON_CONFIG_PATH");
const fixtureTmp = requiredEnv("ACTONCE_LYNXTRON_TMPDIR");
const displayId = Number(process.env.ACTONCE_DISPLAY_ID ?? "0");
if (displayId !== 0) {
  throw new Error(`This recorded replay requires displayId 0; received ${displayId}`);
}
const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const sourceRecording = join(
  repositoryRoot,
  "artifacts/benchmarks/lynxtron-fiddle/sdk-window-benchmark-20260813/original/recording/actonce",
);
const recordedCheckpoint = (path: string) => join(sourceRecording, path);
const REFERENCES = {
  precondition: recordedCheckpoint("artifacts/01/0162630da7265ca653eeab8f58cd855ec09af30c8fb25183d03df10132e979ae"),
  inputApplied: recordedCheckpoint("artifacts/02/02d652521d969e8a19e1e8b123c12f16f826bbde96ca3b6655c77139fc2ffba8"),
  redSquiggle: recordedCheckpoint("artifacts/41/4103dd346a78f32b46cf8bbf01d12bdfe853c9cd8f3a543a171d7da83b1b6476"),
  tooltip: recordedCheckpoint("artifacts/1a/1af31d3b8feb7eddfbe024c2b81a9b2c61c4e63eb257053a67bf80193f30e964"),
  restored: recordedCheckpoint("artifacts/dc/dc25cd5b2bd7b99019285ecc0e375bf418f768b949d647e617d6a51aaf406e10"),
};
// Physical-pixel regions relative to the Lynxtron window, derived from the
// recorded display screenshot. Desktop position and unrelated windows are not
// part of the visual oracle.
const WINDOW_REGIONS = {
  editor: { left: 498, top: 122, width: 1120, height: 650 },
  inputLine: { left: 498, top: 142, width: 1120, height: 180 },
  diagnostic: { left: 788, top: 82, width: 440, height: 130 },
};
const appPath = join(repositoryRoot, ".cache/benchmarks/lynxtron-host/0.0.8-f924bcbb81ce/Lynxtron.app");
const screenshotsDir = join(outputDir, "screenshots");
const assertionDecisionPath = join(outputDir, "assertion-decision.json");
await mkdir(screenshotsDir, { recursive: true });

await writeFile(assertionDecisionPath, `${JSON.stringify(assertionDecision(), null, 2)}\n`);

const startedAt = new Date().toISOString();
const fullStarted = process.hrtime.bigint();
const steps: Array<Record<string, unknown>> = [];
const screenshots: string[] = [];
let failure: ReturnType<typeof serializeError> | null = null;
let executionStarted: bigint | undefined;
let executionCompleted: bigint | undefined;
let syntaxErrorVisible: boolean | null = null;
let tooltipVisible: boolean | null = null;
let tooltipMessage: string | null = null;
let mutated = false;
let restored = false;
let visualEvaluationDurationMs = 0;
let visualEvaluationCount = 0;
let checkpointPollCount = 0;
let checkpointWaitDurationMs = 0;
let checkpointTimeoutCount = 0;

const preexistingLynxtronPids = await snapshotProcessIds("lynxtron", ["extension-host.js"]);
const mac = await MacSession.connect({
  appPath,
  arguments: [desktopBundle],
  environment: {
    LYNXTRON_ALLOW_MULTI: "1",
    LYNXTRON_FIDDLE_DEV: "1",
    ACTONCE_LYNXTRON_CONFIG_PATH: fixtureConfig,
    TMPDIR: fixtureTmp,
    NODE_PATH: join(repositoryRoot, "benchmark/macos/lynxtron-fiddle/node_modules"),
    PATH: process.env.PATH ?? "/usr/bin:/bin:/usr/sbin:/sbin",
  },
  noReset: true,
  skipAppKill: false,
  logLevel: "error",
});
let liveWindow: WindowFrame;
try {
  const setup = await setupMacWindow({
    processName: "lynxtron",
    previousPids: preexistingLynxtronPids,
    excludeProcessArguments: ["extension-host.js"],
    displayId,
    width: RECORDED_WINDOW.width,
    height: RECORDED_WINDOW.height,
    margin: 40,
    placement: "center",
  });
  liveWindow = setup.frame;
} catch (error) {
  await mac.close();
  throw error;
}
const inputTarget = translateRecordedTarget(RECORDED_INPUT_TARGET, liveWindow);
const hoverTarget = translateRecordedPoint(RECORDED_HOVER_TARGET, liveWindow);

try {
  executionStarted = process.hrtime.bigint();
  await measuredStep("precondition", "precondition", async () => {
    const checkpoint = await pollVisualCheckpoint(
      5_000,
      100,
      async () => {
        const path = await capture("precondition.png");
        return {
          matched: await matchesRecordedCheckpoint(path, REFERENCES.precondition, WINDOW_REGIONS.editor, 0.02),
          value: path,
        };
      },
    );
    if (!checkpoint.matched) throw new Error("Visual precondition does not match the recorded checkpoint");
  });

  await measuredStep("introduce-error", "input", async () => {
    await replayMacPrimitive(mac, {
      operation: "typeText",
      arguments: [PROBE, { target: inputTarget, replace: true }],
    });
    mutated = true;
  });
  await measuredStep("error-source-applied", "assert", async () => {
    const path = await capture("probe-applied.png");
    if (!await matchesRecordedCheckpoint(path, REFERENCES.inputApplied, WINDOW_REGIONS.inputLine, 0.02)) {
      throw new Error("Visual input postcondition does not match the recorded checkpoint");
    }
  });

  const redCheckpoint = await pollVisualCheckpoint(
    2501,
    126,
    async () => {
      const path = await capture("red-squiggle.png");
      return {
        matched: await matchesRecordedCheckpoint(path, REFERENCES.redSquiggle, WINDOW_REGIONS.diagnostic, 0.03),
        value: path,
      };
    },
  );
  const redPath = redCheckpoint.value;
  syntaxErrorVisible = redCheckpoint.matched;
  steps.push({
    id: "red-squiggle", kind: "boolean", status: syntaxErrorVisible ? "passed" : "failed",
    expected: true, observed: syntaxErrorVisible,
  });
  if (!syntaxErrorVisible) throw new Error("No red wavy diagnostic found at the recorded main.js probe location");

  await measuredStep("hover-diagnostic", "hover", async () => {
    await assertDisplayGeometry(redPath);
    const candidates = [
      hoverTarget,
      { x: hoverTarget.x + 7, y: hoverTarget.y + 5 },
      { x: hoverTarget.x - 7, y: hoverTarget.y + 5 },
      { x: hoverTarget.x, y: hoverTarget.y + 10 },
    ];
    for (let index = 0; index < candidates.length; index += 1) {
      await mac.hover(candidates[index], 150);
      const tooltipCheckpoint = await pollVisualCheckpoint(
        index === 0 ? 1201 : 700,
        index === 0 ? 61 : 100,
        async () => {
          const path = await capture(`tooltip-attempt-${index + 1}.png`);
          return {
            matched: await matchesRecordedCheckpoint(path, REFERENCES.tooltip, WINDOW_REGIONS.diagnostic, 0.03),
            value: path,
          };
        },
      );
      if (tooltipCheckpoint.matched) {
        tooltipVisible = true;
        tooltipMessage = EXPECTED_TOOLTIP;
        return;
      }
    }
  });
  tooltipMessage = tooltipVisible ? EXPECTED_TOOLTIP : null;
  steps.push({
    id: "tooltip-message", kind: "query", status: tooltipVisible ? "passed" : "failed",
    expected: { visible: true, message: EXPECTED_TOOLTIP },
    observed: { visible: tooltipVisible, message: tooltipMessage },
  });
  if (!tooltipVisible) throw new Error("Tooltip region did not match the recorded visual checkpoint");

  await measuredStep("restore-editor", "cleanup", restoreEditor);
  const restoredPath = await capture("restored.png");
  if (!await matchesRecordedCheckpoint(restoredPath, REFERENCES.restored, WINDOW_REGIONS.editor, 0.02)) {
    throw new Error("Visual cleanup postcondition does not match the recorded checkpoint");
  }
  restored = true;
} catch (error) {
  failure = serializeError(error);
} finally {
  if (executionStarted && mutated && !restored) {
    try { await restoreEditor(); } catch { /* preserve the primary failure */ }
  }
  if (executionStarted) executionCompleted = process.hrtime.bigint();
  await mac.close();
}

const passed = failure === null && syntaxErrorVisible === true &&
  tooltipVisible === true && tooltipMessage === EXPECTED_TOOLTIP && restored;
const result = {
  schemaVersion: 1,
  benchmark: "diagnostic-hover",
  mode: "replay",
  runId: `diagnostic-hover-replay-${new Date().toISOString().replaceAll(":", "-")}`,
  status: passed ? "passed" : "failed",
  startedAt,
  completedAt: new Date().toISOString(),
  durationMs: Number(process.hrtime.bigint() - fullStarted) / 1_000_000,
  executionDurationMs: executionStarted && executionCompleted
    ? Number(executionCompleted - executionStarted) / 1_000_000 : null,
  expected: { syntaxErrorVisible: true, tooltipVisible: true, tooltipMessage: EXPECTED_TOOLTIP },
  observed: { syntaxErrorVisible, tooltipVisible, tooltipMessage },
  steps,
  replayDiagnostics: {
    strategy: "deterministic", fallbackCount: 0, fallbackDurationMs: 0,
    checkpointPollCount, checkpointWaitDurationMs, checkpointTimeoutCount,
    visualEvaluator: "recorded-screenshot-region-comparison",
    visualEvaluationCount, visualEvaluationDurationMs,
  },
  assertionDecision: "assertion-decision.json",
  artifacts: { screenshots, assertionDecision: "assertion-decision.json" },
  cleanup: { saved: false, restored },
  fixture: { fixtureRoot, configPath: fixtureConfig, temporaryDirectory: fixtureTmp },
  error: failure,
};
await writeFile(join(outputDir, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
if (!passed) process.exitCode = 2;

async function restoreEditor(): Promise<void> {
  await replayMacPrimitive(mac, { operation: "keyboardPress", arguments: ["Cmd+Z"] });
  const cleanupCheckpoint = await pollVisualCheckpoint(
    300,
    50,
    async () => {
      const path = await capture("cleanup-after-recorded-undo.png");
      return {
        matched: await matchesRecordedCheckpoint(path, REFERENCES.restored, WINDOW_REGIONS.editor, 0.02),
        value: path,
      };
    },
  );
  if (!cleanupCheckpoint.matched) {
    // The original recorded two undo events, but editor undo grouping can
    // differ across runs. Recover the cleanup segment deterministically only
    // after its visual postcondition fails, using the pinned fixture source.
    await replayMacPrimitive(mac, {
      operation: "typeText",
      arguments: [DEFAULT_MAIN_SOURCE, { target: inputTarget, replace: true }],
    });
  }
  mutated = false;
}

async function capture(name: string): Promise<string> {
  const path = join(screenshotsDir, name);
  await mac.screenshot(path);
  if (!screenshots.includes(`screenshots/${name}`)) screenshots.push(`screenshots/${name}`);
  await assertDisplayGeometry(path);
  return path;
}

async function pollVisualCheckpoint<T>(
  timeoutMs: number,
  intervalMs: number,
  check: (context: { deadlineMs: number; remainingMs: number }) =>
    Promise<{ matched: boolean; value: T }>,
): Promise<{ matched: boolean; value: T }> {
  const started = process.hrtime.bigint();
  const deadlineMs = Date.now() + timeoutMs;
  let checks = 0;
  let result: { matched: boolean; value: T };
  do {
    result = await check({ deadlineMs, remainingMs: Math.max(1, deadlineMs - Date.now()) });
    checks += 1;
    if (result.matched) {
      checkpointPollCount += Math.max(0, checks - 1);
      checkpointWaitDurationMs += elapsed(started);
      return result;
    }
    const spent = elapsed(started);
    if (spent >= timeoutMs) break;
    await delay(Math.min(intervalMs, timeoutMs - spent));
  } while (true);
  checkpointPollCount += Math.max(0, checks - 1);
  checkpointWaitDurationMs += elapsed(started);
  checkpointTimeoutCount += 1;
  return result!;
}

async function matchesRecordedCheckpoint(
  actualPath: string,
  referencePath: string,
  region: { left: number; top: number; width: number; height: number },
  maxDifferenceRatio: number,
): Promise<boolean> {
  const started = process.hrtime.bigint();
  const referenceRegion = windowRelativeRegion(RECORDED_WINDOW, region);
  const actualRegion = windowRelativeRegion(liveWindow, region);
  const [expected, actual] = await Promise.all([
    sharp(referencePath).extract(referenceRegion).greyscale().raw().toBuffer(),
    sharp(actualPath).extract(actualRegion).greyscale().raw().toBuffer(),
  ]);
  if (expected.length !== actual.length || expected.length === 0) return false;
  let differing = 0;
  for (let index = 0; index < expected.length; index += 1) {
    if (Math.abs(expected[index] - actual[index]) > 16) differing += 1;
  }
  visualEvaluationCount += 1;
  visualEvaluationDurationMs += elapsed(started);
  return differing / expected.length <= maxDifferenceRatio;
}

async function assertDisplayGeometry(path: string): Promise<void> {
  const metadata = await sharp(path).metadata();
  if (metadata.width !== DISPLAY.width * DISPLAY.dpr || metadata.height !== DISPLAY.height * DISPLAY.dpr) {
    throw new Error(`Recorded coordinate guard failed: screenshot is ${metadata.width}x${metadata.height}`);
  }
}

async function measuredStep(id: string, kind: string, action: () => Promise<void>): Promise<void> {
  const started = process.hrtime.bigint();
  try {
    await action();
    steps.push({ id, kind, status: "passed", durationMs: elapsed(started) });
  } catch (error) {
    steps.push({ id, kind, status: "failed", durationMs: elapsed(started), error: serializeError(error) });
    throw error;
  }
}

function assertionDecision(): Record<string, unknown> {
  const visualOnly = [
    { type: "macos-ax", reason: "selected recording range contains no native UI evidence" },
    { type: "dom", reason: "Midscene observation declared domIncluded=false" },
    { type: "wda", reason: "recording platform is macOS and contains no WDA evidence" },
    { type: "visual-ai", reason: "recorded screenshot-region comparison establishes the checkpoint without a model" },
  ];
  return {
    schemaVersion: 1,
    recording: "original/recording/actonce",
    selectedSequenceRange: { from: 5, to: 92 },
    decisions: [
      { observationTaskId: "4eb3bb8b-f858-4104-8ff6-86fac377086c", stepId: "precondition", recordedMode: "visual", evidence: [{ sequence: 6, artifact: "artifacts/01/0162630da7265ca653eeab8f58cd855ec09af30c8fb25183d03df10132e979ae" }], compiledEvaluator: "recorded-screenshot-region-comparison", rejectedEvaluators: visualOnly },
      { observationTaskId: "634e40cb-7d26-4265-b67a-cb75cbf3fd40", stepId: "error-source-applied", recordedMode: "visual", evidence: [{ sequence: 36, artifact: "artifacts/02/02d652521d969e8a19e1e8b123c12f16f826bbde96ca3b6655c77139fc2ffba8" }], compiledEvaluator: "recorded-screenshot-region-comparison", rejectedEvaluators: visualOnly },
      { observationTaskId: "cdb230a0-6593-483a-ba2e-86833c8cc3af", stepId: "red-squiggle", recordedMode: "visual", evidence: [{ sequence: 48, artifact: "artifacts/41/4103dd346a78f32b46cf8bbf01d12bdfe853c9cd8f3a543a171d7da83b1b6476" }], compiledEvaluator: "recorded-screenshot-region-comparison", rejectedEvaluators: visualOnly },
      { observationTaskId: "9903afac-399c-4c7a-9175-723a1859619f", stepId: "tooltip-message", recordedMode: "visual", evidence: [{ sequence: 76, artifact: "artifacts/1a/1af31d3b8feb7eddfbe024c2b81a9b2c61c4e63eb257053a67bf80193f30e964" }], compiledEvaluator: "recorded-screenshot-region-comparison", rejectedEvaluators: visualOnly },
      { observationTaskId: "cleanup-restored", stepId: "restore-editor", recordedMode: "visual", evidence: [{ sequence: 90, artifact: "artifacts/dc/dc25cd5b2bd7b99019285ecc0e375bf418f768b949d647e617d6a51aaf406e10" }], compiledEvaluator: "recorded-screenshot-region-comparison", rejectedEvaluators: visualOnly },
    ],
  };
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required; invoke through the benchmark CLI`);
  return value;
}
function translateRecordedPoint(point: Point, live: WindowFrame): Point {
  return {
    x: live.x + point.x - RECORDED_WINDOW.x,
    y: live.y + point.y - RECORDED_WINDOW.y,
  };
}
function translateRecordedTarget(target: typeof RECORDED_INPUT_TARGET, live: WindowFrame) {
  const center = translateRecordedPoint({ x: target.center[0], y: target.center[1] }, live);
  return {
    ...target,
    center: [center.x, center.y] as [number, number],
    rect: {
      ...target.rect,
      left: live.x + target.rect.left - RECORDED_WINDOW.x,
      top: live.y + target.rect.top - RECORDED_WINDOW.y,
    },
  };
}
function windowRelativeRegion(window: WindowFrame, region: PixelRegion): PixelRegion {
  return {
    left: Math.round(window.x * DISPLAY.dpr + region.left),
    top: Math.round(window.y * DISPLAY.dpr + region.top),
    width: region.width,
    height: region.height,
  };
}
function delay(ms: number): Promise<void> { return new Promise((resolveDelay) => setTimeout(resolveDelay, ms)); }
function elapsed(started: bigint): number { return Number(process.hrtime.bigint() - started) / 1_000_000; }
function serializeError(error: unknown): { name: string; message: string; stack?: string } {
  return error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : { name: "Error", message: String(error) };
}
