import "dotenv/config";

import { randomUUID } from "node:crypto";
import { join } from "node:path";
import {
  AndroidAgent,
  AndroidDevice,
  getConnectedDevices,
} from "@byted-lynx/actonce-midscene-adapter";
import {
  type BenchmarkResult,
  measureStep,
  writeBenchmarkResult,
} from "../lib/metrics.js";
import { prepareMarkorFixture } from "./markor-fixture.js";

const taskId = "android-markor-create-note-001";
const runId = randomUUID();
const requestedSerial = process.env.ACTONCE_ANDROID_SERIAL;

const fixture = await prepareMarkorFixture();
const startedAt = new Date().toISOString();
const benchmarkStartedAt = performance.now();
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
    replanningCycleLimit: 12,
    screenshotShrinkFactor: 2,
    aiActContext:
      "This is Markor 2.16.1 on a fixed Android 15 emulator. Do not leave Markor or change any file other than actonce-benchmark.md.",
    onLLMUsage: () => {
      llmCalls += 1;
    },
  });

  steps.push(
    await measureStep("create note", async () => {
      agentCalls += 1;
      await agent.aiAct(
        'Create a new Markdown file named "actonce-benchmark.md" in the current Documents folder.',
      );
    }),
  );

  steps.push(
    await measureStep("enter content", async () => {
      agentCalls += 1;
      await agent.aiAct(
        'Enter exactly "Replay this task without AI." as the document content, then save the file.',
      );
    }),
  );

  steps.push(
    await measureStep("reopen note", async () => {
      agentCalls += 1;
      await agent.aiAct(
        'Return to the Documents file list, then reopen "actonce-benchmark.md".',
      );
    }),
  );

  steps.push(
    await measureStep("verify note", async () => {
      agentCalls += 1;
      await agent.aiAssert(
        'The open file is named "actonce-benchmark.md" and its content is exactly "Replay this task without AI.".',
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

console.log(
  JSON.stringify({ resultPath, fixture, llmCalls, ...result }, null, 2),
);
process.exitCode = success ? 0 : 1;
