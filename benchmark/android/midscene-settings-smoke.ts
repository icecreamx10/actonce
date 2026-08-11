import "dotenv/config";

import { randomUUID } from "node:crypto";
import { join } from "node:path";
import {
  AndroidAgent,
  AndroidDevice,
  getConnectedDevices,
} from "@midscene/android";
import {
  type BenchmarkResult,
  measureStep,
  writeBenchmarkResult,
} from "../lib/metrics.js";

const taskId = "android-settings-dark-theme-smoke-001";
const runId = randomUUID();
const startedAt = new Date().toISOString();
const benchmarkStartedAt = performance.now();
const requestedSerial = process.env.ACTONCE_ANDROID_SERIAL;
const steps = [];
let agentCalls = 0;
let llmCalls = 0;
let success = false;
let errorMessage: string | undefined;
let device: AndroidDevice | undefined;

try {
  const devices = await getConnectedDevices();
  const selected = requestedSerial
    ? devices.find((candidate) => candidate.udid === requestedSerial)
    : devices[0];

  if (!selected) {
    throw new Error(
      requestedSerial
        ? `Android device ${requestedSerial} is not connected`
        : "No Android device is connected",
    );
  }

  const connectedDevice = new AndroidDevice(selected.udid, {
    imeStrategy: "always-yadb",
    keyboardDismissStrategy: "back-first",
  });
  device = connectedDevice;
  await connectedDevice.connect();

  const agent = new AndroidAgent(connectedDevice, {
    generateReport: true,
    persistExecutionDump: true,
    reportFileName: `${taskId}-${runId}`,
    replanningCycleLimit: 8,
    screenshotShrinkFactor: 2,
    onLLMUsage: () => {
      llmCalls += 1;
    },
  });

  steps.push(
    await measureStep("open settings", async () => {
      await connectedDevice.launch("com.android.settings");
    }),
  );

  steps.push(
    await measureStep("enable dark theme", async () => {
      agentCalls += 1;
      await agent.aiAct(
        "Open Display settings, then turn on Dark theme. Stop when Dark theme is visibly enabled.",
      );
    }),
  );

  steps.push(
    await measureStep("verify dark theme", async () => {
      agentCalls += 1;
      await agent.aiAssert(
        "The Android system is using dark theme and the Dark theme setting is enabled.",
      );
    }),
  );

  success = steps.every((step) => step.success);
  errorMessage = steps.find((step) => !step.success)?.error;
} catch (error) {
  errorMessage = error instanceof Error ? error.message : String(error);
} finally {
  await device?.destroy();
}

const result: BenchmarkResult = {
  schemaVersion: 1,
  taskId,
  mode: "ai",
  startedAt,
  durationMs: Math.round(performance.now() - benchmarkStartedAt),
  success,
  agentCalls,
  aiFallbacks: 0,
  steps,
  ...(errorMessage === undefined ? {} : { error: errorMessage }),
};

const resultPath = join(
  "artifacts",
  "benchmarks",
  `${taskId}-midscene-${runId}.json`,
);
await writeBenchmarkResult(resultPath, result);

console.log(JSON.stringify({ resultPath, llmCalls, ...result }, null, 2));
process.exitCode = success ? 0 : 1;
