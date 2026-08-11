import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { PlaywrightAgent } from "@midscene/web/playwright";
import { chromium } from "playwright";
import {
  type BenchmarkResult,
  measureStep,
  writeBenchmarkResult,
} from "./lib/metrics.js";
import { startFixtureServer } from "./fixture/server.js";

const taskId = "web-create-ticket-001";
const runId = randomUUID();
const startedAt = new Date().toISOString();
const benchmarkStartedAt = performance.now();
const steps = [];
let agentCalls = 0;
let success = false;
let errorMessage: string | undefined;

const fixture = await startFixtureServer(0);
const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(fixture.url);

  const agent = new PlaywrightAgent(page, { generateReport: true });

  steps.push(
    await measureStep("fill ticket title", async () => {
      agentCalls += 1;
      await agent.aiAct(
        'Enter "Payment button fails on checkout" in the Title field.',
      );
    }),
  );

  steps.push(
    await measureStep("configure ticket", async () => {
      agentCalls += 1;
      await agent.aiAct(
        'Set Priority to High and enable the "Include diagnostics" checkbox.',
      );
    }),
  );

  steps.push(
    await measureStep("submit ticket", async () => {
      agentCalls += 1;
      await agent.aiAct('Click the "Create ticket" button.');
    }),
  );

  steps.push(
    await measureStep("verify result", async () => {
      agentCalls += 1;
      await agent.aiAssert(
        'Ticket T-1001 was created with high priority and diagnostics included.',
      );
    }),
  );

  success = steps.every((step) => step.success);
  const failedStep = steps.find((step) => !step.success);
  errorMessage = failedStep?.error;
} catch (error) {
  errorMessage = error instanceof Error ? error.message : String(error);
} finally {
  await browser.close();
  await fixture.close();
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

console.log(JSON.stringify({ resultPath, ...result }, null, 2));
process.exitCode = success ? 0 : 1;
