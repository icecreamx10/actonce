import { spawn } from "node:child_process";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  MIDSCENE_ANDROID_WORLD_REPORT,
  selectMidsceneAndroidWorldCases,
  type MidscenePassSelection,
} from "./catalog.js";

type Phase = "plan" | "original" | "compile" | "replay" | "evaluate";
const args = parseArgs(process.argv.slice(2));
const outputDir = resolve(args.output);
const selected = selectMidsceneAndroidWorldCases(args.selection)
  .filter((entry) => !args.task || entry.task === args.task);
if (args.task && selected.length !== 1) throw new Error(`Task is not in ${args.selection}: ${args.task}`);
await mkdir(outputDir, { recursive: true });
if (args.phase === "compile") {
  await run("npm", ["--prefix", "runtime/android", "run", "build"]);
}

for (const entry of selected) {
  for (let sample = 1; sample <= args.samples; sample += 1) {
    const sampleDir = resolve(outputDir, "cases", `${String(entry.id).padStart(3, "0")}-${slug(entry.task)}`, `sample-${sample}`);
    await mkdir(sampleDir, { recursive: true });
    if (args.phase === "original") await runOriginal(entry.task, entry.id, sample, sampleDir);
    else if (args.phase === "compile") await runCompile(sampleDir);
    else if (args.phase === "replay") await runReplay(entry.task, sampleDir);
    else if (args.phase === "evaluate") await runEvaluation(entry.task, sampleDir);
  }
}

async function runCompile(sampleDir: string) {
  const resultPath = resolve(sampleDir, "compiled", "compile-result.json");
  if (!args.force && await exists(resultPath)) return;
  if (!await exists(resolve(sampleDir, "original", "result.json"))) return;
  if (args.force) {
    await Promise.all([
      rm(resolve(sampleDir, "replay"), { recursive: true, force: true }),
      rm(resolve(sampleDir, "evaluation.json"), { force: true }),
    ]);
  }
  await run(resolve("node_modules/.bin/tsx"), [
    resolve("benchmark/android/android-world/compile.ts"),
    "--sample", sampleDir,
  ]);
}

const summary = await summarize();
await writeJson(resolve(outputDir, "suite-result.json"), summary);
console.log(JSON.stringify(summary, null, 2));

async function runOriginal(task: string, taskId: number, sample: number, sampleDir: string) {
  const resultPath = resolve(sampleDir, "original", "result.json");
  if (!args.force && await exists(resultPath)) return;
  if (args.force) {
    await Promise.all([
      rm(resolve(sampleDir, "compiled"), { recursive: true, force: true }),
      rm(resolve(sampleDir, "replay"), { recursive: true, force: true }),
      rm(resolve(sampleDir, "evaluation.json"), { force: true }),
    ]);
  }
  await runBenchmark([
    "--mode", "original", "--task", task, "--seed", String(taskId * 10_000 + sample),
    "--output", sampleDir,
  ]);
}

async function runReplay(task: string, sampleDir: string) {
  const resultPath = resolve(sampleDir, "replay", "benchmark-result.json");
  if (!args.force && await exists(resultPath)) return;
  const replayEntry = resolve(sampleDir, "compiled", "replay.ts");
  if (!await exists(replayEntry)) return;
  if (args.force) await rm(resolve(sampleDir, "evaluation.json"), { force: true });
  await runBenchmark([
    "--mode", "replay", "--task", task, "--output", sampleDir,
    "--replay-entry", replayEntry,
  ]);
}

async function runEvaluation(task: string, sampleDir: string) {
  if (!await exists(resolve(sampleDir, "original", "result.json"))
    || !await exists(resolve(sampleDir, "replay", "benchmark-result.json"))) return;
  if (!args.force && await exists(resolve(sampleDir, "evaluation.json"))) return;
  await runBenchmark(["--mode", "evaluate", "--task", task, "--output", sampleDir]);
}

async function runBenchmark(childArgs: string[]) {
  const command = resolve("node_modules/.bin/tsx");
  const runner = resolve("benchmark/android/android-world/benchmark.ts");
  await new Promise<void>((resolveRun, reject) => {
    const child = spawn(command, [runner, ...childArgs], { cwd: process.cwd(), env: process.env, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", () => resolveRun());
  });
}

async function run(command: string, childArgs: string[]) {
  await new Promise<void>((resolveRun, reject) => {
    const child = spawn(command, childArgs, { cwd: process.cwd(), env: process.env, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", () => resolveRun());
  });
}

async function summarize() {
  const cases = [];
  let originalPassed = 0, compiled = 0, replayCorrect = 0, comparable = 0;
  const comparableCases: Array<{ originalMs: number; replayMs: number; speedup: number }> = [];
  for (const entry of selected) {
    const samples = [];
    const evaluations: Array<Record<string, unknown> | null> = [];
    for (let sample = 1; sample <= args.samples; sample += 1) {
      const sampleDir = resolve(outputDir, "cases", `${String(entry.id).padStart(3, "0")}-${slug(entry.task)}`, `sample-${sample}`);
      const original = await json(resolve(sampleDir, "original", "result.json"));
      const replay = await json(resolve(sampleDir, "replay", "benchmark-result.json"));
      const evaluation = await json(resolve(sampleDir, "evaluation.json"));
      evaluations.push(evaluation);
      const replayEntry = resolve(sampleDir, "compiled", "replay.ts");
      const hasCompiled = await exists(replayEntry);
      if (original?.status === "passed") originalPassed += 1;
      if (hasCompiled) compiled += 1;
      if (replay?.status === "passed") replayCorrect += 1;
      if (object(evaluation?.performance)?.comparable === true) comparable += 1;
      samples.push({
        sample,
        seed: entry.id * 10_000 + sample,
        status: status(original, hasCompiled, replay, evaluation),
        directory: sampleDir,
        originalStatus: original?.status ?? "missing",
        replayStatus: replay?.status ?? "missing",
        correctnessPassed: object(evaluation?.correctness)?.passed ?? false,
      });
    }
    const durations = evaluations.map((evaluation) => {
      const performance = object(evaluation?.performance);
      return {
        comparable: performance?.comparable === true,
        originalMs: finite(performance?.originalExecutionDurationMs),
        replayMs: finite(performance?.replayExecutionDurationMs),
      };
    });
    const caseComparable = durations.length === args.samples && durations.every(
      (value) => value.comparable && value.originalMs !== null && value.replayMs !== null,
    );
    const aggregate = caseComparable ? (() => {
      const originalMs = median(durations.map((value) => value.originalMs!));
      const replayMs = median(durations.map((value) => value.replayMs!));
      const speedup = originalMs / replayMs;
      comparableCases.push({ originalMs, replayMs, speedup });
      return {
        comparable: true,
        originalMedianMs: originalMs,
        replayMedianMs: replayMs,
        speedup,
        reductionPercent: (1 - 1 / speedup) * 100,
      };
    })() : { comparable: false };
    cases.push({ id: entry.id, task: entry.task, rounds: entry.rounds, samples, aggregate });
  }
  const sampleCount = selected.length * args.samples;
  return {
    schemaVersion: 1,
    suite: "AndroidWorld",
    selection: args.selection,
    source: MIDSCENE_ANDROID_WORLD_REPORT,
    phase: args.phase,
    caseCount: selected.length,
    samplesPerCase: args.samples,
    sampleCount,
    coverage: {
      sampleCount,
      originalPassed,
      compiled,
      replayCorrect,
      performanceComparable: comparable,
      comparableCaseCount: comparableCases.length,
    },
    performance: comparableCases.length ? {
      comparableCaseCount: comparableCases.length,
      originalCaseMedianMs: median(comparableCases.map((value) => value.originalMs)),
      replayCaseMedianMs: median(comparableCases.map((value) => value.replayMs)),
      medianCaseSpeedup: median(comparableCases.map((value) => value.speedup)),
      totalOriginalCaseMedianMs: sum(comparableCases.map((value) => value.originalMs)),
      totalReplayCaseMedianMs: sum(comparableCases.map((value) => value.replayMs)),
      totalSpeedup: sum(comparableCases.map((value) => value.originalMs)) /
        sum(comparableCases.map((value) => value.replayMs)),
    } : { comparableCaseCount: 0 },
    cases,
  };
}

function status(
  original: Record<string, unknown> | null,
  hasCompiled: boolean,
  replay: Record<string, unknown> | null,
  evaluation: Record<string, unknown> | null,
) {
  if (!original) return "awaiting_original";
  if (original.status !== "passed") return "original_failed";
  if (!hasCompiled) return "awaiting_compile";
  if (!replay) return "awaiting_replay";
  if (replay.status !== "passed") return "replay_failed";
  if (!evaluation) return "awaiting_evaluation";
  return object(evaluation.correctness)?.passed === true ? "passed" : "incorrect";
}

function parseArgs(values: string[]): {
  phase: Phase;
  selection: MidscenePassSelection;
  output: string;
  samples: number;
  task?: string;
  force: boolean;
} {
  let phase: Phase = "plan", selection: MidscenePassSelection = "pass@3";
  let output = ".cache/android-world/suite", samples = 2, task: string | undefined, force = false;
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] === "--phase") phase = values[++index] as Phase;
    else if (values[index] === "--selection") selection = values[++index] as MidscenePassSelection;
    else if (values[index] === "--output") output = values[++index];
    else if (values[index] === "--samples") samples = Number(values[++index]);
    else if (values[index] === "--task") task = values[++index];
    else if (values[index] === "--force") force = true;
    else throw new Error(`Unknown argument: ${values[index]}`);
  }
  if (!["plan", "original", "compile", "replay", "evaluate"].includes(phase)) throw new Error(`Unknown phase: ${phase}`);
  if (selection !== "pass@1" && selection !== "pass@3") throw new Error(`Unknown selection: ${selection}`);
  if (!Number.isInteger(samples) || samples < 1) throw new Error(`Invalid samples: ${samples}`);
  return { phase, selection, output, samples, task, force };
}

async function exists(path: string) { try { await access(path); return true; } catch { return false; } }
async function json(path: string): Promise<Record<string, unknown> | null> {
  try { return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}
async function writeJson(path: string, value: unknown) { await writeFile(path, `${JSON.stringify(value, null, 2)}\n`); }
function object(value: unknown) { return value && typeof value === "object" ? value as Record<string, unknown> : null; }
function finite(value: unknown) { return typeof value === "number" && Number.isFinite(value) ? value : null; }
function median(values: number[]) { const sorted = [...values].sort((a, b) => a - b); const middle = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2; }
function sum(values: number[]) { return values.reduce((total, value) => total + value, 0); }
function slug(value: string) { return value.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase(); }
