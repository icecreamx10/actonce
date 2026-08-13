#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildEvidenceManifest, type EvidenceManifest } from "./evidence.js";
import {
  evaluateLynxtronBenchmark,
  type LynxtronAiReview,
  type LynxtronRunResult,
} from "./evaluation.js";
import { resetBenchmarkFixture } from "./fixture-state.js";
import { validateMacObservationDecisionsFile } from "../../../runtime/macos/src/observation-compiler.js";

const [command, ...values] = process.argv.slice(2);
if (command === "run") await runCommand(values);
else if (command === "evidence") await evidenceCommand(values);
else if (command === "review") await reviewCommand(values);
else if (command === "evaluate") await evaluateCommand(values);
else {
  console.log(`Lynxtron benchmark CLI

Commands:
  run --mode <original|replay> --case <id> [--output <directory>] [--runner <replay-runner>] [--source-recording <directory>]
  evidence --original <result> --original <result> --replay <result> --replay <result> --output <directory>
  review --manifest <review-manifest.json> --decision <passed|failed> --reason <text> --output <review.json>
  evaluate --original <result> --original <result> --replay <result> --replay <result> --review <review.json> [--output <evaluation.json>]`);
  if (command && command !== "help" && command !== "--help") process.exitCode = 2;
}

async function runCommand(args: string[]): Promise<void> {
  const options = keyValues(args);
  const mode = required(options, "--mode");
  if (mode !== "original" && mode !== "replay") throw new Error("--mode must be original or replay");
  const caseId = required(options, "--case");
  const benchmarkDir = dirname(fileURLToPath(import.meta.url));
  const repositoryRoot = resolve(benchmarkDir, "../../..");
  const output = resolve(
    options.get("--output") ??
      join(
        repositoryRoot,
        "artifacts/benchmarks/lynxtron-fiddle",
        `${caseId}-${new Date().toISOString().replaceAll(":", "-")}`,
      ),
  );
  const runner = mode === "original"
    ? join(benchmarkDir, "runner.ts")
    : resolve(required(options, "--runner"));
  await mkdir(output, { recursive: true });
  const fixture = await resetBenchmarkFixture(output);
  const executable = extname(runner) === ".ts"
    ? join(repositoryRoot, "node_modules/.bin/tsx")
    : process.execPath;
  const exitCode = await spawnAndWait(executable, [runner, "--case", caseId], {
    ...process.env,
    ACTONCE_BENCHMARK_OUTPUT_DIR: output,
    ACTONCE_LYNXTRON_FIXTURE_ROOT: fixture.fixtureRoot,
    ACTONCE_LYNXTRON_DESKTOP_BUNDLE: fixture.desktopBundle,
    ACTONCE_LYNXTRON_CONFIG_PATH: fixture.configPath,
    ACTONCE_LYNXTRON_TMPDIR: fixture.temporaryDirectory,
  });
  const resultPath = join(output, "result.json");
  if (exitCode !== 0) {
    process.exitCode = exitCode;
    return;
  }
  const result = await readResult(resultPath);
  if (result.mode !== mode) throw new Error(`Runner emitted mode=${result.mode}; expected ${mode}`);
  if (result.benchmark !== caseId) throw new Error(`Runner emitted benchmark=${result.benchmark}; expected ${caseId}`);
  if (mode === "replay") {
    validateReplayDiagnostics(result);
    await validateReplayObservationProvenance(
      resultPath,
      result,
      options.get("--source-recording"),
    );
  }
  if (!(typeof result.executionDurationMs === "number" && result.executionDurationMs > 0)) {
    throw new Error("Runner did not emit a positive executionDurationMs");
  }
  console.log(JSON.stringify({ result: resultPath, mode, benchmark: caseId, executionDurationMs: result.executionDurationMs }, null, 2));
}

function validateReplayDiagnostics(result: LynxtronRunResult): void {
  const diagnostics = result.replayDiagnostics;
  if (!diagnostics) throw new Error("Replay runner did not emit replayDiagnostics");
  if (diagnostics.strategy !== "deterministic" && diagnostics.strategy !== "hybrid") {
    throw new Error(`Invalid replay strategy: ${String(diagnostics.strategy)}`);
  }
  if (!Number.isInteger(diagnostics.fallbackCount) || diagnostics.fallbackCount < 0) {
    throw new Error("Replay fallbackCount must be a non-negative integer");
  }
  if (!Number.isFinite(diagnostics.fallbackDurationMs) || diagnostics.fallbackDurationMs < 0) {
    throw new Error("Replay fallbackDurationMs must be a non-negative number");
  }
  for (const key of ["checkpointPollCount", "checkpointTimeoutCount"] as const) {
    const value = diagnostics[key];
    if (value !== undefined && (!Number.isInteger(value) || value < 0)) {
      throw new Error(`Replay ${key} must be a non-negative integer`);
    }
  }
  if (diagnostics.checkpointWaitDurationMs !== undefined &&
    (!Number.isFinite(diagnostics.checkpointWaitDurationMs) || diagnostics.checkpointWaitDurationMs < 0)) {
    throw new Error("Replay checkpointWaitDurationMs must be a non-negative number");
  }
  if (diagnostics.strategy === "deterministic" &&
    (diagnostics.fallbackCount !== 0 || diagnostics.fallbackDurationMs !== 0)) {
    throw new Error("Deterministic replay cannot report fallback activity");
  }
}

async function evidenceCommand(args: string[]): Promise<void> {
  const parsed = parseRuns(args);
  if (!parsed.output) throw new Error("--output is required");
  const originals = await Promise.all(parsed.originals.map(readResult));
  const replays = await Promise.all(parsed.replays.map(readResult));
  await Promise.all(parsed.replays.map((path, index) =>
    validateReplayObservationProvenance(resolve(path), replays[index])));
  const cliGate = evaluateLynxtronBenchmark(originals, replays);
  if (!cliGate.dimensions.correctness.cliPassed) {
    console.log(JSON.stringify(cliGate, null, 2));
    throw new Error("Structured assertion gate failed; AI review was not prepared");
  }
  const output = resolve(parsed.output);
  const manifest = await buildEvidenceManifest(
    [...parsed.originals, ...parsed.replays],
    output,
  );
  const path = resolve(output, "review-manifest.json");
  await writeJson(path, manifest);
  console.log(JSON.stringify({ manifest: path, screenshots: manifest.runs.flatMap((run) => run.screenshots.map((item) => resolve(output, item.path))) }, null, 2));
}

async function validateReplayObservationProvenance(
  resultPath: string,
  result: LynxtronRunResult,
  sourceRecordingOverride?: string,
): Promise<void> {
  const decisionReference = result.assertionDecision ?? result.artifacts?.assertionDecision;
  if (!decisionReference) throw new Error("Replay result is missing assertionDecision");
  const decisionPath = resolve(dirname(resultPath), decisionReference);
  const decision = JSON.parse(await readFile(decisionPath, "utf8")) as { recording?: string };
  const sourceRecording = sourceRecordingOverride
    ? resolve(sourceRecordingOverride)
    : decision.recording
      ? resolve(dirname(dirname(resultPath)), decision.recording)
      : undefined;
  if (!sourceRecording) {
    throw new Error("Assertion decision record is missing its source recording; pass --source-recording");
  }
  await validateMacObservationDecisionsFile(sourceRecording, decisionPath);
}

async function reviewCommand(args: string[]): Promise<void> {
  const options = keyValues(args);
  const manifestPath = required(options, "--manifest");
  const output = required(options, "--output");
  const decision = required(options, "--decision");
  if (decision !== "passed" && decision !== "failed") throw new Error("--decision must be passed or failed");
  const manifest = JSON.parse(await readFile(resolve(manifestPath), "utf8")) as EvidenceManifest;
  const review: LynxtronAiReview = {
    schemaVersion: 1,
    benchmark: manifest.benchmark,
    reviewer: "ai",
    decision,
    reason: required(options, "--reason"),
  };
  await writeJson(resolve(output), review);
  console.log(JSON.stringify(review, null, 2));
}

async function evaluateCommand(args: string[]): Promise<void> {
  const parsed = parseRuns(args);
  const review = JSON.parse(await readFile(resolve(optionValue(args, "--review")), "utf8")) as LynxtronAiReview;
  const evaluation = evaluateLynxtronBenchmark(
    await Promise.all(parsed.originals.map(readResult)),
    await Promise.all(parsed.replays.map(readResult)),
    review,
  );
  if (parsed.output) await writeJson(resolve(parsed.output), evaluation);
  console.log(JSON.stringify(evaluation, null, 2));
  if (!evaluation.dimensions.correctness.passed || !evaluation.dimensions.speed.comparable) process.exitCode = 2;
}

function optionValue(values: string[], key: string): string {
  const index = values.indexOf(key);
  if (index < 0 || !values[index + 1]) throw new Error(`${key} is required`);
  return values[index + 1];
}

function parseRuns(values: string[]): { originals: string[]; replays: string[]; output?: string } {
  const originals: string[] = [];
  let output: string | undefined;
  const replays: string[] = [];
  for (let index = 0; index < values.length; index += 1) {
    const token = values[index];
    if (token === "--review" || token === "--manifest" || token === "--decision" || token === "--reason") {
      index += 1;
      continue;
    }
    const value = values[++index];
    if (!value) throw new Error(`${token} requires a value`);
    if (token === "--original") originals.push(value);
    else if (token === "--replay") replays.push(value);
    else if (token === "--output") output = value;
    else throw new Error(`Unknown argument: ${token}`);
  }
  if (originals.length !== 2) throw new Error("Exactly two --original results are required");
  if (replays.length !== 2) throw new Error("Exactly two --replay results are required");
  return { originals, replays, output };
}

function keyValues(values: string[]): Map<string, string> {
  const result = new Map<string, string>();
  for (let index = 0; index < values.length; index += 2) {
    if (!values[index + 1]) throw new Error(`${values[index]} requires a value`);
    result.set(values[index], values[index + 1]);
  }
  return result;
}

function required(options: Map<string, string>, key: string): string {
  const value = options.get(key);
  if (!value) throw new Error(`${key} is required`);
  return value;
}

async function readResult(path: string): Promise<LynxtronRunResult> {
  return JSON.parse(await readFile(resolve(path), "utf8")) as LynxtronRunResult;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function spawnAndWait(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<number> {
  return new Promise((resolveExit, reject) => {
    const child = spawn(command, args, { cwd: process.cwd(), env, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) reject(new Error(`Benchmark runner exited with signal ${signal}`));
      else resolveExit(code ?? 1);
    });
  });
}
