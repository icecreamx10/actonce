import "dotenv/config";

import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { IOSAgent, IOSDevice } from "@byted-lynx/actonce-midscene-adapter";
import {
  type BenchmarkResult,
  type StepMetric,
  measureStep,
  writeBenchmarkResult,
} from "../lib/metrics.js";

const taskId = "ios-settings-about-smoke-001";
const runId = randomUUID();
const startedAt = new Date().toISOString();
const benchmarkStartedAt = performance.now();
const wdaHost = process.env.ACTONCE_WDA_HOST ?? "127.0.0.1";
const wdaPort = Number(process.env.ACTONCE_WDA_PORT ?? "8100");
const steps: StepMetric[] = [];
let agentCalls = 0;
let llmCalls = 0;
let success = false;
let errorMessage: string | undefined;
let device: IOSDevice | undefined;

async function runStep(name: string, operation: () => Promise<void>) {
  const step = await measureStep(name, operation);
  steps.push(step);
  if (!step.success) {
    throw new Error(step.error ?? `${name} failed`);
  }
}

try {
  const connectedDevice = new IOSDevice({ wdaHost, wdaPort });
  device = connectedDevice;
  await connectedDevice.connect();

  const agent = new IOSAgent(connectedDevice, {
    generateReport: true,
    persistExecutionDump: true,
    reportFileName: `${taskId}-${runId}`,
    replanningCycleLimit: 3,
    screenshotShrinkFactor: 2,
    aiActContext:
      "This is the Apple Settings app on a Chinese-language iOS Simulator. 通用 means General and 关于本机 means About. Do not open another app.",
    onLLMUsage: () => {
      llmCalls += 1;
    },
  });

  await runStep("open settings", async () => {
    await connectedDevice.terminate("com.apple.Preferences");
    await connectedDevice.launch("com.apple.Preferences");
  });

  await runStep("open about", async () => {
    agentCalls += 1;
    await agent.aiAct(
      "Tap 通用 (General), then tap 关于本机 (About). Stop when the About page with device information is visible.",
      { abortSignal: AbortSignal.timeout(300_000) },
    );
  });

  await runStep("verify about page", async () => {
    agentCalls += 1;
    await agent.aiAssert(
      "The About page is open and shows iOS device information such as Name, iOS Version, or Model Name.",
    );
  });

  success = true;
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
