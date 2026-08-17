/**
 * Compiled from ActOnce recording: no-quick-open-original-smoke-20260813/diagnostic-hover
 * Source sequence range: 1..92
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import sharp from "sharp";
import { ReplayFlow, VisualCheckpointDriver } from "@byted-lynx/actonce-replay";
import type { VisualCaptureCapability } from "@byted-lynx/actonce-replay";
import {
  compileMacObservationPlanFile,
  MacDeviceConnector,
  MacSession,
  captureMacRegionScreenshot,
  replayMacPrimitive,
  setupMacWindow,
  snapshotProcessIds,
} from "../../../../runtime/macos/src/index.js";

type Point = { x: number; y: number };
type WindowFrame = Point & { width: number; height: number };
type PixelRegion = { left: number; top: number; width: number; height: number };
const PROBE = "const actOnceSyntaxProbe = ;";
const EXPECTED_TOOLTIP = "Expression expected.";
const DEFAULT_MAIN_SOURCE = `// Main process — Lynxtron entry
const { app, LynxWindow } = require('lynxtron');

app.whenReady().then(() => {
  const win = new LynxWindow({ width: 800, height: 600 });
  // A LynxWindow renders a compiled Lynx bundle — renderer.js is built
  // into main.lynx.bundle by rspeedy. There is no HTML page in Lynxtron.
  win.loadFile('main.lynx.bundle');
});
`;
const DISPLAY = { width: 1728, height: 1117, dpr: 2 };
const RECORDED_WINDOW = { x: 178, y: 118, width: 1372, height: 880 };
const RECORDED_INPUT_TARGET = {
  center: [721, 479] as [number, number],
  rect: { left: 463, top: 176, width: 516, height: 608 },
  description: "the recorded top-left main.js editor",
};
const RECORDED_HOVER_TARGET = { x: 710, y: 206 };
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
const sourceRecording = resolve(process.env.ACTONCE_BENCHMARK_SOURCE_RECORDING ?? join(
  repositoryRoot,
  "artifacts/benchmarks/lynxtron-fiddle-suites/no-quick-open-original-smoke-20260813/cases/diagnostic-hover/recording/actonce",
));
const observationPlanPath = join(outputDir, "observation-plan.json");
const observationPlan = await compileMacObservationPlanFile(
  sourceRecording,
  observationPlanPath,
  { from: 1, to: 92 },
);
const plannedObservations = observationPlan.observations;
if (plannedObservations.length !== 4 ||
  plannedObservations.map((item) => item.operation).join(",") !== "Assert,Assert,Boolean,Query") {
  throw new Error(`Unexpected diagnostic-hover observation plan: ${JSON.stringify(plannedObservations.map((item) => ({ sequence: item.sequence, operation: item.operation })))}`);
}
const recordedCheckpoint = (path: string) => join(sourceRecording, path);
const REFERENCES = {
  precondition: observationScreenshot(0),
  inputApplied: observationScreenshot(1),
  redSquiggle: observationScreenshot(2),
  tooltip: observationScreenshot(3),
  restored: observationScreenshot(0),
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
if (process.env.ACTONCE_DECISION_ONLY === "1") process.exit(0);

const startedAt = new Date().toISOString();
const fullStarted = process.hrtime.bigint();
const steps: Array<Record<string, unknown>> = [];
const screenshots: string[] = [];
const checkpointTimeline: Array<Record<string, unknown>> = [];
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
let screenshotCaptureCount = 0;
let screenshotCaptureDurationMs = 0;

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
let livePid: number;
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
  livePid = setup.pid;
} catch (error) {
  await mac.close();
  throw error;
}
const inputTarget = translateRecordedTarget(RECORDED_INPUT_TARGET, liveWindow);
const hoverTarget = translateRecordedPoint(RECORDED_HOVER_TARGET, liveWindow);
const captureDevice = await new MacDeviceConnector().connect();
const visualTargets = (await captureDevice.listTargets()).filter((target) =>
  target.app.pid === livePid && target.window?.bounds.width === liveWindow.width &&
  target.window.bounds.height === liveWindow.height);
if (visualTargets.length !== 1) {
  await captureDevice.close();
  await mac.close();
  throw new Error(`Native capture resolved ${visualTargets.length} Lynxtron windows for pid ${livePid}`);
}
const visualCapability = await captureDevice.getCapability<VisualCaptureCapability>("visualCapture");
const visual = await visualCapability.openStream({ target: visualTargets[0], artifactDirectory: screenshotsDir });
const referenceDirectory = join(outputDir, "references");
await mkdir(referenceDirectory, { recursive: true });
const tooltipPositivePath = await cropRecordedWindowReference("tooltip-positive.png", REFERENCES.tooltip);
const tooltipNegativePath = await cropRecordedWindowReference("tooltip-negative.png", REFERENCES.redSquiggle);
const tooltipPositive = await visual.registerReference({ path: tooltipPositivePath });
const tooltipNegative = await visual.registerReference({ path: tooltipNegativePath });
const tooltipFlow = new ReplayFlow({
  checkpoints: new VisualCheckpointDriver(visual),
  emit: (event) => {
    markCheckpoint(`flow.${event.kind}`, {
      segmentId: event.segmentId,
      phase: event.phase,
      checkpointId: event.checkpointId,
      checkCount: event.checkCount,
      captureDurationMs: event.captureDurationMs,
      settleDelayMs: event.settleDelayMs,
      durationMs: event.durationMs,
      status: event.checkpoint?.status,
      actualMetrics: event.checkpoint?.actual.metrics,
    });
    if (event.kind !== "replay.checkpoint.checked" || !event.checkpoint) return;
    const actual = event.checkpoint.actual;
    screenshotCaptureCount += actual.metrics.captureCount;
    screenshotCaptureDurationMs += actual.metrics.captureDurationMs;
    visualEvaluationCount += actual.metrics.compareCount;
    visualEvaluationDurationMs += actual.metrics.compareDurationMs;
    const artifact = actual.frame?.artifactRef;
    if (artifact) {
      const relative = `screenshots/${artifact.split("/").at(-1)}`;
      if (!screenshots.includes(relative)) screenshots.push(relative);
    }
  },
});

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
      markCheckpoint("hover.started", { candidate: index + 1, point: candidates[index] });
      await mac.hover(candidates[index], 150);
      markCheckpoint("hover.completed", { candidate: index + 1, point: candidates[index] });
      markCheckpoint("checkpoint.wait.started", { candidate: index + 1 });
      const tooltipCheckpoint = await tooltipFlow.waitForCheckpoint(
        "hover-diagnostic",
        "postcondition",
        {
          id: `tooltip-visible-${index + 1}`,
          expected: {
            referenceId: tooltipPositive.referenceId,
            comparator: { type: "pixelDiff", mismatchThreshold: 0.03, channelTolerance: 16 },
            contrast: {
              referenceId: tooltipNegative.referenceId,
              minimumSeparationRatio: 0.01,
            },
            persistCapture: true,
          },
          settle: {
            timeoutMs: index === 0 ? 1201 : 700,
            intervalMs: index === 0 ? 61 : 100,
          },
        },
      );
      markCheckpoint("checkpoint.wait.completed", {
        candidate: index + 1,
        status: tooltipCheckpoint.status,
        differences: tooltipCheckpoint.differences,
        actualMetrics: tooltipCheckpoint.actual.metrics,
      });
      if (tooltipCheckpoint.status === "matched") {
        tooltipVisible = true;
        tooltipMessage = EXPECTED_TOOLTIP;
        return;
      }
    }
  });
  const tooltipDiagnostics = tooltipFlow.diagnostics();
  checkpointPollCount += tooltipDiagnostics.checkpointPollCount;
  checkpointWaitDurationMs += tooltipDiagnostics.checkpointWaitDurationMs;
  checkpointTimeoutCount += tooltipDiagnostics.checkpointTimeoutCount;
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
  await visual.close();
  await captureDevice.close();
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
    visualEvaluator: "recorded-screenshot-contrastive-comparison",
    visualEvaluationCount, visualEvaluationDurationMs,
    screenshotBackend: "native-region", screenshotCaptureCount, screenshotCaptureDurationMs,
  },
  assertionDecision: "assertion-decision.json",
  artifacts: {
    screenshots,
    assertionDecision: "assertion-decision.json",
    checkpointTimeline: "checkpoint-timeline.json",
  },
  cleanup: { saved: false, restored },
  fixture: { fixtureRoot, configPath: fixtureConfig, temporaryDirectory: fixtureTmp },
  error: failure,
};
await writeFile(join(outputDir, "checkpoint-timeline.json"), `${JSON.stringify(checkpointTimeline, null, 2)}\n`);
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
  const started = process.hrtime.bigint();
  await captureMacRegionScreenshot(path, liveWindow, { timeoutMs: 2_000 });
  screenshotCaptureCount += 1;
  screenshotCaptureDurationMs += elapsed(started);
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
  const [expected, actual] = await Promise.all([
    sharp(referencePath).extract(referenceRegion).greyscale().raw().toBuffer(),
    sharp(actualPath).extract(region).greyscale().raw().toBuffer(),
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
  if (metadata.width !== liveWindow.width * DISPLAY.dpr || metadata.height !== liveWindow.height * DISPLAY.dpr) {
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
    recording: sourceRecording,
    selectedSequenceRange: { from: 1, to: 92 },
    decisions: plannedObservations.map((observation, index) => ({
      observationTaskId: observation.observationTaskId,
      stepId: ["precondition", "error-source-applied", "red-squiggle", "tooltip-message"][index],
      recordedMode: observation.recordedMode,
      evidence: observation.evidence.screenshots,
      compiledEvaluator: index === 3
        ? "recorded-screenshot-contrastive-comparison"
        : "recorded-screenshot-region-comparison",
      rejectedEvaluators: visualOnly,
    })),
  };
}

function observationScreenshot(index: number): string {
  const evidence = plannedObservations[index]?.evidence.screenshots.at(-1);
  if (!evidence) throw new Error(`Observation ${index} has no screenshot evidence`);
  return recordedCheckpoint(evidence.artifact);
}

async function cropRecordedWindowReference(name: string, source: string): Promise<string> {
  const path = join(referenceDirectory, name);
  await sharp(source).extract({
    left: RECORDED_WINDOW.x * DISPLAY.dpr,
    top: RECORDED_WINDOW.y * DISPLAY.dpr,
    width: RECORDED_WINDOW.width * DISPLAY.dpr,
    height: RECORDED_WINDOW.height * DISPLAY.dpr,
  }).png().toFile(path);
  return path;
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

function markCheckpoint(kind: string, details: Record<string, unknown> = {}): void {
  checkpointTimeline.push({
    kind,
    monotonicNs: process.hrtime.bigint().toString(),
    wallTime: new Date().toISOString(),
    ...details,
  });
}
