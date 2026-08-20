import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { AndroidSession } from "../../../runtime/android/src/index.js";

type Mode = "all" | "original" | "replay" | "evaluate";

type OracleResult = {
  passed: boolean;
  durationMs: number;
  screenshot: string;
  checks: Record<string, boolean>;
  missing: string[];
};

type RunResult = {
  mode: "original" | "replay";
  status: "passed" | "failed";
  executionDurationMs: number | null;
  measurementSource: string;
  processExitCode: number | null;
  oracle: OracleResult | null;
  recordingAssertions?: { completed: number; passed: number };
  fallbackCount?: number | null;
  checkpoint?: {
    captureDurationMs: number | null;
    settleDelayMs: number | null;
    pollCount: number | null;
  };
};

const args = parseArgs(process.argv.slice(2));
const outputDir = resolve(
  args.output ??
    `.cache/android-benchmarks/checkout-${new Date().toISOString().replaceAll(":", "-")}`,
);
await mkdir(outputDir, { recursive: true });

if (args.mode === "all" || args.mode === "original") {
  await runOriginal();
}
if (args.mode === "all" || args.mode === "replay") {
  await runReplay();
}
if (args.mode === "all" || args.mode === "evaluate") {
  const evaluation = await evaluate();
  console.log(JSON.stringify({ ...evaluation, outputDir }, null, 2));
  if (!evaluation.correctness.passed) process.exitCode = 2;
}

async function runOriginal(): Promise<void> {
  const runDir = resolve(outputDir, "original");
  await mkdir(runDir, { recursive: true });
  await run("npm", ["run", "android:reset:demo-app"]);
  const processResult = await run("node_modules/.bin/tsx", [
    "interceptor/src/cli.ts",
    "record",
    "midscene-android",
    "--entry",
    "benchmark/android/my-demo-app/checkout-task.ts",
    "--recordings-dir",
    outputDir,
    "--recording-id",
    "original",
  ]);
  const manifest = await json(resolve(runDir, "manifest.json"));
  const assertions = await recordingAssertions(resolve(runDir, "events.ndjson"));
  const oracle = processResult.code === 0 ? await inspectOracle(runDir) : null;
  const duration = manifestDuration(manifest);
  const result: RunResult = {
    mode: "original",
    status:
      processResult.code === 0 &&
      manifest?.status === "complete" &&
      assertions.completed >= 2 &&
      assertions.completed === assertions.passed &&
      oracle?.passed
        ? "passed"
        : "failed",
    executionDurationMs: duration ?? processResult.durationMs,
    measurementSource: duration === null ? "process-wall-clock" : "recording-manifest",
    processExitCode: processResult.code,
    oracle,
    recordingAssertions: assertions,
  };
  await writeJson(resolve(runDir, "result.json"), result);
}

async function runReplay(): Promise<void> {
  const runDir = resolve(outputDir, "replay");
  await mkdir(runDir, { recursive: true });
  await run("npm", ["run", "android:reset:demo-app"]);
  const processResult = await run(
    "node_modules/.bin/tsx",
    ["benchmark/android/my-demo-app/checkout-replay.ts"],
    { ACTONCE_BENCHMARK_OUTPUT_DIR: runDir },
  );
  const native = await json(resolve(runDir, "result.json"));
  const oracle = processResult.code === 0 ? await inspectOracle(runDir) : null;
  const diagnostics = object(native?.replayDiagnostics);
  const checkpoint = object(diagnostics?.checkpoint);
  const result: RunResult = {
    mode: "replay",
    status: processResult.code === 0 && native?.status === "passed" && oracle?.passed ? "passed" : "failed",
    executionDurationMs: number(native?.durationMs) ?? processResult.durationMs,
    measurementSource: number(native?.durationMs) === null ? "process-wall-clock" : "replay-runtime",
    processExitCode: processResult.code,
    oracle,
    fallbackCount: number(diagnostics?.fallbackCount),
    checkpoint: {
      captureDurationMs:
        number(checkpoint?.captureDurationMs) ?? number(diagnostics?.checkpointCaptureDurationMs),
      settleDelayMs:
        number(checkpoint?.settleDelayMs) ?? number(diagnostics?.checkpointSettleDelayMs),
      pollCount: number(checkpoint?.pollCount) ?? number(diagnostics?.checkpointPollCount),
    },
  };
  await writeJson(resolve(runDir, "benchmark-result.json"), result);
}

async function evaluate() {
  const original = (await json(resolve(outputDir, "original/result.json"))) as RunResult | null;
  const replay = (await json(resolve(outputDir, "replay/benchmark-result.json"))) as RunResult | null;
  const semanticPassed = original?.status === "passed" && replay?.status === "passed";
  const originalMs = original?.executionDurationMs ?? null;
  const replayMs = replay?.executionDurationMs ?? null;
  const originalScreenshotSha256 = await fileSha256(original?.oracle?.screenshot);
  const replayScreenshotSha256 = await fileSha256(replay?.oracle?.screenshot);
  const screenshotExactMatch =
    originalScreenshotSha256 !== null &&
    originalScreenshotSha256 === replayScreenshotSha256;
  const passed = semanticPassed && screenshotExactMatch;
  const comparable = passed && originalMs !== null && replayMs !== null && replayMs > 0;
  const speedup = comparable ? originalMs / replayMs : null;
  const evaluation = {
    schemaVersion: 1,
    benchmark: "android-midscene-demo-checkout",
    case: "Sauce Labs My Demo App checkout to shipping address",
    correctness: {
      passed,
      original: original?.status ?? "missing",
      replay: replay?.status ?? "missing",
      screenshotExactMatch,
    },
    performance: {
      comparable,
      originalExecutionDurationMs: originalMs,
      replayExecutionDurationMs: replayMs,
      speedup,
      reductionPercent: speedup === null ? null : (1 - 1 / speedup) * 100,
    },
    replay: {
      fallbackCount: replay?.fallbackCount ?? null,
      checkpoint: replay?.checkpoint ?? null,
    },
    artifacts: {
      original: "original/result.json",
      replay: "replay/benchmark-result.json",
      originalScreenshot: original?.oracle?.screenshot ?? null,
      replayScreenshot: replay?.oracle?.screenshot ?? null,
      originalScreenshotSha256,
      replayScreenshotSha256,
    },
  };
  await writeJson(resolve(outputDir, "evaluation.json"), evaluation);
  return evaluation;
}

async function inspectOracle(runDir: string): Promise<OracleResult> {
  const started = process.hrtime.bigint();
  const screenshot = resolve(runDir, "oracle-shipping-address.png");
  const android = await AndroidSession.connect();
  try {
    const source = await android.source();
    await android.screenshot(screenshot);
    const expected = [
      "Checkout",
      "Enter a shipping address",
      "Rebecca Winter",
      "Mandorley 112",
      "Truro",
      "Cornwall",
      "89750",
      "United Kingdom",
      "To Payment",
    ];
    const checks = Object.fromEntries(expected.map((value) => [value, source.includes(value)]));
    checks["cart quantity 3"] = source.includes('"text":"3"');
    const missing = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
    return {
      passed: missing.length === 0,
      durationMs: elapsed(started),
      screenshot,
      checks,
      missing,
    };
  } finally {
    await android.close();
  }
}

async function recordingAssertions(path: string) {
  const text = await readFile(path, "utf8").catch(() => "");
  const observations = text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { kind?: string; operation?: string; result?: unknown })
    .filter((event) => event.kind === "observation.completed" && event.operation === "Assert");
  return { completed: observations.length, passed: observations.filter((event) => event.result === true).length };
}

function manifestDuration(manifest: Record<string, unknown> | null): number | null {
  if (typeof manifest?.startedAt !== "string" || typeof manifest?.completedAt !== "string") return null;
  const duration = Date.parse(manifest.completedAt) - Date.parse(manifest.startedAt);
  return Number.isFinite(duration) && duration > 0 ? duration : null;
}

function run(command: string, childArgs: string[], extraEnv: Record<string, string> = {}) {
  const started = process.hrtime.bigint();
  return new Promise<{ code: number | null; durationMs: number }>((resolveRun, reject) => {
    const child = spawn(command, childArgs, {
      cwd: process.cwd(),
      env: { ...process.env, ...extraEnv },
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code) => resolveRun({ code, durationMs: elapsed(started) }));
  });
}

function parseArgs(values: string[]): { mode: Mode; output?: string } {
  let mode: Mode = "all";
  let output: string | undefined;
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] === "--mode") mode = values[++index] as Mode;
    else if (values[index] === "--output") output = values[++index];
    else throw new Error(`Unknown argument: ${values[index]}`);
  }
  if (!["all", "original", "replay", "evaluate"].includes(mode)) throw new Error(`Unknown mode: ${mode}`);
  return { mode, output };
}

async function json(path: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function fileSha256(path: string | undefined): Promise<string | null> {
  if (!path) return null;
  try {
    return createHash("sha256").update(await readFile(path)).digest("hex");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function writeJson(path: string, value: unknown) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function elapsed(started: bigint) {
  return Number(process.hrtime.bigint() - started) / 1_000_000;
}
