import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { MIDSCENE_ANDROID_WORLD_CASES, MIDSCENE_ANDROID_WORLD_REPORT } from "./catalog.js";

type Mode = "all" | "original" | "replay" | "evaluate";
const args = parseArgs(process.argv.slice(2));
const outputDir = resolve(args.output ?? `.cache/android-world/runs/${new Date().toISOString().replaceAll(":", "-")}`);
const python = resolve(".cache/android-world/venv/bin/python");
const taskCli = resolve("benchmark/android/android-world/task.py");
const stateDir = resolve(outputDir, "task-state");
const catalogCase = requireCatalogCase(args.task);
await mkdir(outputDir, { recursive: true });

if (args.mode === "all" || args.mode === "original") await original();
if (args.mode === "all" || args.mode === "replay") await replay();
if (args.mode === "all" || args.mode === "evaluate") {
  const result = await evaluate();
  console.log(JSON.stringify({ ...result, outputDir }, null, 2));
  if (!result.correctness.passed) process.exitCode = 2;
}

async function original() {
  const runDir = resolve(outputDir, "original");
  await mkdir(runDir, { recursive: true });
  const initialized = await task("initialize");
  const originalEntry = args.originalEntry ?? (args.task === "SystemBrightnessMax"
    ? "benchmark/android/android-world/system-brightness-max-task.ts"
    : "benchmark/android/android-world/generic-task.ts");
  const processResult = await run("node_modules/.bin/tsx", [
    "interceptor/src/cli.ts", "record", "midscene-android",
    "--entry", originalEntry,
    "--recordings-dir", outputDir, "--recording-id", "original",
  ], { ACTONCE_ANDROID_WORLD_GOAL: String(initialized.goal) });
  const official = await task("evaluate");
  const manifest = await json(resolve(runDir, "manifest.json"));
  const duration = manifestDuration(manifest) ?? processResult.durationMs;
  await writeJson(resolve(runDir, "result.json"), {
    schemaVersion: 1,
    benchmark: benchmarkId(),
    suite: "AndroidWorld",
    task: args.task,
    mode: "original",
    status: processResult.code === 0 && official.reward === 1 ? "passed" : "failed",
    goal: initialized.goal,
    params: initialized.params,
    executionDurationMs: duration,
    officialValidator: official,
    processExitCode: processResult.code,
  });
}

async function replay() {
  const runDir = resolve(outputDir, "replay");
  await mkdir(runDir, { recursive: true });
  const initialized = await task("initialize");
  const replayEntry = args.replayEntry ?? (args.task === "SystemBrightnessMax"
    ? "benchmark/android/android-world/system-brightness-max-replay.ts"
    : undefined);
  if (!replayEntry) throw new Error(`--replay-entry is required for ${args.task}`);
  const processResult = await run(
    "node_modules/.bin/tsx",
    [replayEntry],
    { ACTONCE_BENCHMARK_OUTPUT_DIR: runDir },
  );
  const official = await task("evaluate");
  const runtime = await json(resolve(runDir, "result.json"));
  await writeJson(resolve(runDir, "benchmark-result.json"), {
    schemaVersion: 1,
    benchmark: benchmarkId(),
    suite: "AndroidWorld",
    task: args.task,
    mode: "replay",
    status: processResult.code === 0 && runtime?.status === "passed" && official.reward === 1 ? "passed" : "failed",
    goal: initialized.goal,
    params: initialized.params,
    executionDurationMs: runtime?.executionDurationMs ?? processResult.durationMs,
    officialValidator: official,
    replayDiagnostics: runtime?.replayDiagnostics ?? null,
    processExitCode: processResult.code,
    runtimeResult: "result.json",
  });
}

async function evaluate() {
  const originalResult = await json(resolve(outputDir, "original/result.json"));
  const replayResult = await json(resolve(outputDir, "replay/benchmark-result.json"));
  const passed = originalResult?.status === "passed" && replayResult?.status === "passed";
  const originalMs = number(originalResult?.executionDurationMs);
  const replayMs = number(replayResult?.executionDurationMs);
  const comparable = passed && originalMs !== null && replayMs !== null && replayMs > 0;
  const speedup = comparable ? originalMs / replayMs : null;
  const result = {
    schemaVersion: 1,
    benchmark: benchmarkId(),
    upstream: {
      suite: "AndroidWorld",
      task: args.task,
      taskId: catalogCase.id,
      commit: MIDSCENE_ANDROID_WORLD_REPORT.androidWorldCommit,
      midscenePublishedRounds: catalogCase.rounds,
      midscenePublishedFinalStatus: catalogCase.finalStatus,
      midscenePublishedReport: MIDSCENE_ANDROID_WORLD_REPORT.url,
    },
    correctness: {
      passed,
      oracle: "official AndroidWorld task.is_successful reward == 1.0",
      original: originalResult?.status ?? "missing",
      replay: replayResult?.status ?? "missing",
      originalReward: object(originalResult?.officialValidator)?.reward ?? null,
      replayReward: object(replayResult?.officialValidator)?.reward ?? null,
    },
    performance: {
      comparable,
      originalExecutionDurationMs: originalMs,
      replayExecutionDurationMs: replayMs,
      speedup,
      reductionPercent: speedup === null ? null : (1 - 1 / speedup) * 100,
    },
    replayDiagnostics: replayResult?.replayDiagnostics ?? null,
  };
  await writeJson(resolve(outputDir, "evaluation.json"), result);
  return result;
}

async function task(command: "initialize" | "evaluate") {
  const taskArgs = [taskCli, command, "--task", args.task, "--state-dir", stateDir];
  if (command === "initialize" && args.seed !== undefined) taskArgs.push("--seed", String(args.seed));
  const result = await runCapture(python, taskArgs, {
    GRPC_VERBOSITY: "ERROR",
  });
  const line = result.stdout.trim().split("\n").at(-1);
  if (result.code !== 0 || !line) throw new Error(`AndroidWorld ${command} failed: ${result.stderr}`);
  return JSON.parse(line) as Record<string, unknown>;
}

function run(command: string, childArgs: string[], extraEnv: Record<string, string> = {}) {
  const started = process.hrtime.bigint();
  return new Promise<{ code: number | null; durationMs: number }>((resolveRun, reject) => {
    const child = spawn(command, childArgs, { cwd: process.cwd(), env: { ...process.env, ...extraEnv }, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => resolveRun({ code, durationMs: elapsed(started) }));
  });
}

function runCapture(command: string, childArgs: string[], extraEnv: Record<string, string> = {}) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolveRun, reject) => {
    const child = spawn(command, childArgs, { cwd: process.cwd(), env: { ...process.env, ...extraEnv }, stdio: ["ignore", "pipe", "pipe"] });
    const stdout: Buffer[] = [], stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.once("error", reject);
    child.once("exit", (code) => resolveRun({ code, stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") }));
  });
}

function parseArgs(values: string[]): {
  mode: Mode;
  output?: string;
  task: string;
  seed?: number;
  originalEntry?: string;
  replayEntry?: string;
} {
  let mode: Mode = "all", output: string | undefined, task = "SystemBrightnessMax";
  let seed: number | undefined, originalEntry: string | undefined, replayEntry: string | undefined;
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] === "--mode") mode = values[++index] as Mode;
    else if (values[index] === "--output") output = values[++index];
    else if (values[index] === "--task") task = values[++index];
    else if (values[index] === "--seed") seed = Number(values[++index]);
    else if (values[index] === "--original-entry") originalEntry = values[++index];
    else if (values[index] === "--replay-entry") replayEntry = values[++index];
    else throw new Error(`Unknown argument: ${values[index]}`);
  }
  if (!["all", "original", "replay", "evaluate"].includes(mode)) throw new Error(`Unknown mode: ${mode}`);
  if (seed !== undefined && !Number.isInteger(seed)) throw new Error(`Invalid seed: ${seed}`);
  return { mode, output, task, seed, originalEntry, replayEntry };
}

async function json(path: string): Promise<Record<string, unknown> | null> {
  try { return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}
async function writeJson(path: string, value: unknown) { await writeFile(path, `${JSON.stringify(value, null, 2)}\n`); }
function manifestDuration(manifest: Record<string, unknown> | null) {
  if (typeof manifest?.startedAt !== "string" || typeof manifest?.completedAt !== "string") return null;
  const value = Date.parse(manifest.completedAt) - Date.parse(manifest.startedAt);
  return Number.isFinite(value) && value > 0 ? value : null;
}
function number(value: unknown) { return typeof value === "number" && Number.isFinite(value) ? value : null; }
function object(value: unknown) { return value && typeof value === "object" ? value as Record<string, unknown> : null; }
function elapsed(started: bigint) { return Number(process.hrtime.bigint() - started) / 1_000_000; }
function benchmarkId() { return `android-world-${args.task.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase()}`; }
function requireCatalogCase(task: string) {
  const entry = MIDSCENE_ANDROID_WORLD_CASES.find((candidate) => candidate.task === task);
  if (!entry) throw new Error(`Task is absent from the pinned Midscene catalog: ${task}`);
  return entry;
}
