import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { MIDSCENE_ANDROID_WORLD_CASES, MIDSCENE_ANDROID_WORLD_REPORT } from "./catalog.js";
import {
  modelProfileProvenance,
  requireAndroidWorldModelProfile,
  type AndroidWorldModelProfile,
} from "./model-profile.js";
import { acquireAndroidWorldDeviceLease } from "./device-lease.js";

type Mode = "all" | "original" | "replay" | "evaluate";
const args = parseArgs(process.argv.slice(2));
const outputDir = resolve(args.output ?? `.cache/android-world/runs/${new Date().toISOString().replaceAll(":", "-")}`);
const python = resolve(".cache/android-world/venv/bin/python");
const taskCli = resolve("benchmark/android/android-world/task.py");
const stateDir = resolve(outputDir, "task-state");
const catalogCase = requireCatalogCase(args.task);
const modelProfile = requireAndroidWorldModelProfile(args.modelProfile);
await mkdir(outputDir, { recursive: true });

const releaseDeviceLease = args.mode === "all" || args.mode === "original" || args.mode === "replay"
  ? await acquireAndroidWorldDeviceLease()
  : undefined;
try {
  if (args.mode === "all" || args.mode === "original") await original();
  if (args.mode === "all" || args.mode === "replay") await replay();
  if (args.mode === "all" || args.mode === "evaluate") {
    const result = await evaluate();
    console.log(JSON.stringify({ ...result, outputDir }, null, 2));
    if (!result.correctness.passed) process.exitCode = 2;
  }
} finally {
  await releaseDeviceLease?.();
}

async function original() {
  const runDir = resolve(outputDir, "original");
  await mkdir(runDir, { recursive: true });
  await releaseStaleCheckpointService();
  const initialized = await task("initialize");
  await suspendAndroidWorldAccessibilityForwarder();
  await prepareInitialTargetApp(initialized.apps);
  const originalEntry = args.originalEntry ?? "benchmark/android/android-world/generic-task.ts";
  const processResult = await run("node_modules/.bin/tsx", [
    "interceptor/src/cli.ts", "record", "midscene-android",
    "--entry", originalEntry,
    "--recordings-dir", outputDir, "--recording-id", "original",
    "--expose-adb-shell", "false",
  ], {
    ...modelProfile.env,
    ACTONCE_ANDROID_WORLD_GOAL: String(initialized.goal),
    ACTONCE_ANDROID_WORLD_APPS: JSON.stringify(initialized.apps ?? []),
    MIDSCENE_RUN_DIR: resolve(runDir, "midscene-run"),
  });
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
    apps: initialized.apps,
    executionDurationMs: duration,
    officialValidator: official,
    processExitCode: processResult.code,
    model: modelProfileProvenance(args.modelProfile),
    executionScaffold: {
      logicalAppMapping: initialized.apps,
      adbShellExposed: false,
    },
  });
}

async function replay() {
  const runDir = resolve(outputDir, "replay");
  await mkdir(runDir, { recursive: true });
  await releaseStaleCheckpointService();
  const initialized = await task("initialize");
  await suspendAndroidWorldAccessibilityForwarder();
  await prepareInitialTargetApp(initialized.apps);
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
    model: originalResult?.model ?? modelProfileProvenance(args.modelProfile),
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

async function releaseStaleCheckpointService() {
  const adb = process.env.MIDSCENE_ADB_PATH || "adb";
  const serial = process.env.ACTONCE_ANDROID_SERIAL || "emulator-5554";
  const systemPort = process.env.ACTONCE_ANDROID_SYSTEM_PORT || "8200";
  for (const packageName of [
    "io.appium.uiautomator2.server",
    "io.appium.uiautomator2.server.test",
  ]) {
    const result = await runCapture(adb, ["-s", serial, "shell", "am", "force-stop", packageName]);
    if (result.code !== 0) {
      throw new Error(`Failed to release stale UIAutomator2 package ${packageName}: ${result.stderr}`);
    }
  }
  // A missing forward is already the desired state, so its exit code is ignored.
  await runCapture(adb, ["-s", serial, "forward", "--remove", `tcp:${systemPort}`]);
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const state = await runCapture(adb, ["-s", serial, "shell", "dumpsys", "accessibility"]);
    if (state.code !== 0) throw new Error(`Failed to inspect Android accessibility state: ${state.stderr}`);
    if (!state.stdout.includes("Ui Automation[")) return;
    await delay(250);
  }
  throw new Error("Timed out waiting for stale UIAutomator2 UiAutomation state to be released");
}

async function suspendAndroidWorldAccessibilityForwarder() {
  const adb = process.env.MIDSCENE_ADB_PATH || "adb";
  const serial = process.env.ACTONCE_ANDROID_SERIAL || "emulator-5554";
  const result = await runCapture(adb, [
    "-s", serial, "shell", "settings", "delete", "secure", "enabled_accessibility_services",
  ]);
  if (result.code !== 0) {
    throw new Error(`Failed to suspend AndroidWorld AccessibilityForwarder: ${result.stderr}`);
  }
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const state = await runCapture(adb, ["-s", serial, "shell", "dumpsys", "accessibility"]);
    if (state.code !== 0) throw new Error(`Failed to inspect Android accessibility state: ${state.stderr}`);
    if (state.stdout.includes("Bound services:{}")) return;
    await delay(250);
  }
  throw new Error("Timed out waiting for AndroidWorld AccessibilityForwarder to unbind");
}

async function prepareInitialTargetApp(value: unknown) {
  if (!Array.isArray(value)) return;
  const adb = process.env.MIDSCENE_ADB_PATH || "adb";
  const serial = process.env.ACTONCE_ANDROID_SERIAL || "emulator-5554";
  const packages = new Set(value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const packageName = (item as Record<string, unknown>).package;
    return typeof packageName === "string" && packageName.length > 0 ? [packageName] : [];
  }));
  for (const packageName of packages) {
    const result = await runCapture(adb, ["-s", serial, "shell", "am", "force-stop", packageName]);
    if (result.code !== 0) throw new Error(`Failed to force-stop target app ${packageName}: ${result.stderr}`);
  }
  const initialPackage = packages.values().next().value as string | undefined;
  if (!initialPackage) return;
  const resolved = await runCapture(adb, [
    "-s", serial, "shell", "cmd", "package", "resolve-activity", "--brief", initialPackage,
  ]);
  const component = resolved.stdout.trim().split("\n").at(-1);
  if (resolved.code !== 0 || !component?.includes("/")) {
    throw new Error(`Failed to resolve launcher activity for ${initialPackage}: ${resolved.stderr || resolved.stdout}`);
  }
  const launched = await runCapture(adb, [
    "-s", serial, "shell", "am", "start-activity", "-W",
    "-a", "android.intent.action.MAIN", "-c", "android.intent.category.LAUNCHER",
    "-f", "0x10200000", "-n", component,
  ]);
  if (launched.code !== 0) throw new Error(`Failed to launch target app ${initialPackage}: ${launched.stderr}`);
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const focus = await runCapture(adb, ["-s", serial, "shell", "dumpsys", "window"]);
    if (focus.code !== 0) throw new Error(`Failed to inspect foreground app: ${focus.stderr}`);
    const current = focus.stdout.split("\n").find((line) => line.includes("mCurrentFocus="));
    if (current?.includes(initialPackage)) return;
    await delay(250);
  }
  throw new Error(`Timed out waiting for target app ${initialPackage} to reach the foreground`);
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
  modelProfile: AndroidWorldModelProfile;
} {
  let mode: Mode = "all", output: string | undefined, task = "SystemBrightnessMax";
  let seed: number | undefined, originalEntry: string | undefined, replayEntry: string | undefined;
  let modelProfile: AndroidWorldModelProfile = "codex-luna";
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] === "--mode") mode = values[++index] as Mode;
    else if (values[index] === "--output") output = values[++index];
    else if (values[index] === "--task") task = values[++index];
    else if (values[index] === "--seed") seed = Number(values[++index]);
    else if (values[index] === "--original-entry") originalEntry = values[++index];
    else if (values[index] === "--replay-entry") replayEntry = values[++index];
    else if (values[index] === "--model-profile") modelProfile = values[++index] as AndroidWorldModelProfile;
    else throw new Error(`Unknown argument: ${values[index]}`);
  }
  if (!["all", "original", "replay", "evaluate"].includes(mode)) throw new Error(`Unknown mode: ${mode}`);
  if (seed !== undefined && !Number.isInteger(seed)) throw new Error(`Invalid seed: ${seed}`);
  requireAndroidWorldModelProfile(modelProfile);
  return { mode, output, task, seed, originalEntry, replayEntry, modelProfile };
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
function delay(ms: number) { return new Promise<void>((resolveDelay) => setTimeout(resolveDelay, ms)); }
function benchmarkId() { return `android-world-${args.task.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase()}`; }
function requireCatalogCase(task: string) {
  const entry = MIDSCENE_ANDROID_WORLD_CASES.find((candidate) => candidate.task === task);
  if (!entry) throw new Error(`Task is absent from the pinned Midscene catalog: ${task}`);
  return entry;
}
