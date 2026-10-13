import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { MIDSCENE_ANDROID_WORLD_CASES, MIDSCENE_ANDROID_WORLD_REPORT } from "./catalog.js";
import {
  modelProfileProvenance,
  requireAndroidWorldModelProfile,
  type AndroidWorldModelProfile,
} from "./model-profile.js";
import { acquireAndroidWorldDeviceLease } from "./device-lease.js";
import {
  CHROME_PACKAGE,
  isChromeReady,
  nextChromeFixtureAction,
} from "./chrome-fixture.js";
import { captureRuntimePermissionFixture, restoreRuntimePermissionFixture } from "./permission-fixture.js";
import { initialTargetPolicy, isInitialTargetForeground } from "./initial-target.js";
import { originalTimingBoundary, validateReplaySelection } from "./replay-module.js";
import { normalizeStartEnvironment, permissionPolicy, startEnvironmentParity, verifyStartEnvironment, verifyStableForeground } from "./start-environment.js";

type Mode = "all" | "original" | "replay" | "evaluate" | "setup";
const args = parseArgs(process.argv.slice(2));
const outputDir = resolve(args.output ?? `.cache/android-world/runs/${new Date().toISOString().replaceAll(":", "-")}`);
const python = resolve(".cache/android-world/venv/bin/python");
const taskCli = resolve("benchmark/android/android-world/task.py");
const stateDir = resolve(outputDir, "task-state");
const catalogCase = requireCatalogCase(args.task);
const modelProfile = requireAndroidWorldModelProfile(args.modelProfile);
await mkdir(outputDir, { recursive: true });

const releaseDeviceLease = args.mode !== "evaluate"
  ? await acquireAndroidWorldDeviceLease()
  : undefined;
try {
  if (args.mode === "setup") {
    await releaseStaleCheckpointService();
    const initialized = await task("initialize", true);
    await suspendAndroidWorldAccessibilityForwarder();
    const setup = await prepareBoundary("setup", initialized.apps);
    await writeJson(resolve(outputDir, "setup.json"), { status: "ready", task: args.task, ...setup });
    console.log(JSON.stringify({ status: "ready", task: args.task, outputDir }));
  }
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
  const initialized = await task("initialize", true);
  await suspendAndroidWorldAccessibilityForwarder();
  const { permissionFixture, startEnvironment } = await prepareBoundary("original", initialized.apps);
  const originalEntry = args.originalEntry ?? "benchmark/android/android-world/generic-task.ts";
  const processResult = await run("node_modules/.bin/tsx", [
    "interceptor/src/cli.ts", "record", "midscene-android",
    "--entry", originalEntry,
    "--recordings-dir", outputDir, "--recording-id", "original",
    "--serial", process.env.ACTONCE_ANDROID_SERIAL || "emulator-5554",
    "--expose-adb-shell", "false",
  ], {
    ...modelProfile.env,
    ACTONCE_ANDROID_WORLD_GOAL: String(initialized.goal),
    ACTONCE_ANDROID_WORLD_APPS: JSON.stringify(initialized.apps ?? []),
    ACTONCE_ANDROID_WORLD_START_STATE: initialTargetPolicy(args.task, initialized.apps).initialPackage ? "target-app" : "official-home",
    MIDSCENE_RUN_DIR: resolve(runDir, "midscene-run"),
  });
  const official = await task("evaluate");
  const manifest = await json(resolve(runDir, "manifest.json"));
  const duration = manifestDuration(manifest) ?? processResult.durationMs;
  if (processResult.code !== 0 || official.reward !== 1) process.exitCode = 2;
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
    permissionFixture,
    startEnvironment,
    fixtureRng: initialized.fixtureRng ?? "unknown",
    executionDurationMs: duration,
    childProcessDurationMs: processResult.durationMs,
    timingBoundary: { scope: manifestDuration(manifest) !== null ? "recording-session" : "child-process", managedBy: "recorder-manifest", includesRecorderOverhead: true },
    officialValidator: official,
    processExitCode: processResult.code,
    model: modelProfileProvenance(args.modelProfile),
    executionScaffold: {
      logicalAppMapping: initialized.apps,
      startState: initialTargetPolicy(args.task, initialized.apps).initialPackage ? "target-app" : "official-home",
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
  const { permissionFixture, startEnvironment } = await prepareBoundary("replay", initialized.apps);
  const replayEntry = args.replayEntry ?? (args.task === "SystemBrightnessMax"
    ? "benchmark/android/android-world/system-brightness-max-replay.ts"
    : undefined);
  if (!replayEntry && !args.replayModule) throw new Error(`--replay-module or --replay-entry is required for ${args.task}`);
  const processResult = await run(
    "node_modules/.bin/tsx",
    args.replayModule ? ["benchmark/android/android-world/replay-module.ts", "--replay-module", args.replayModule, "--serial", process.env.ACTONCE_ANDROID_SERIAL || "emulator-5554", "--output", runDir] : [replayEntry!],
    { ACTONCE_BENCHMARK_OUTPUT_DIR: runDir },
  );
  const official = await task("evaluate");
  const runtime = await json(resolve(runDir, "result.json"));
  if (processResult.code !== 0 || runtime?.status !== "passed" || official.reward !== 1) process.exitCode = 2;
  await writeJson(resolve(runDir, "benchmark-result.json"), {
    schemaVersion: 1,
    benchmark: benchmarkId(),
    suite: "AndroidWorld",
    task: args.task,
    mode: "replay",
    status: processResult.code === 0 && runtime?.status === "passed" && official.reward === 1 ? "passed" : "failed",
    goal: initialized.goal,
    params: initialized.params,
    permissionFixture,
    startEnvironment,
    fixtureRng: initialized.fixtureRng ?? "unknown",
    executionDurationMs: runtime?.executionDurationMs ?? processResult.durationMs,
    childProcessDurationMs: processResult.durationMs,
    timingBoundary: args.replayModule ? runtime?.timingBoundary ?? null : { scope: "legacy-entry-reported", managedBy: "authored-entry", reportedBoundary: runtime?.timingBoundary ?? null },
    officialValidator: official,
    replayDiagnostics: runtime?.replayDiagnostics ?? null,
    checkpointCaptureBreakdown: runtime?.checkpointCaptureBreakdown ?? null,
    processExitCode: processResult.code,
    runtimeResult: "result.json",
  });
}

async function evaluate() {
  const originalResult = await json(resolve(outputDir, "original/result.json"));
  const replayResult = await json(resolve(outputDir, "replay/benchmark-result.json"));
  const environmentParity = startEnvironmentParity(originalResult?.startEnvironment, replayResult?.startEnvironment);
  const passed = originalResult?.status === "passed" && replayResult?.status === "passed"
    && (!environmentParity.required || environmentParity.matched);
  const originalMs = number(originalResult?.executionDurationMs);
  const replayMs = number(replayResult?.executionDurationMs);
  const originalBoundary = object(originalTimingBoundary(originalResult, await json(resolve(outputDir, "original/manifest.json"))));
  const replayBoundary = object(replayResult?.timingBoundary);
  const knownTimingScopes = originalBoundary?.scope === "recording-session" && replayBoundary?.scope === "device-session";
  const comparable = passed && knownTimingScopes && originalMs !== null && replayMs !== null && replayMs > 0;
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
    startEnvironmentParity: environmentParity,
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
      originalTimingBoundary: originalBoundary,
      replayTimingBoundary: replayBoundary,
      timingCaveat: knownTimingScopes ? "Recorded original includes recorder overhead; replay measures native device-session setup, execution and teardown. These are documented, not identical, scopes." : "Timing scopes are legacy, missing, or otherwise unverified; no formal speedup is asserted.",
      originalExecutionDurationMs: originalMs,
      replayExecutionDurationMs: replayMs,
      speedup,
      reductionPercent: speedup === null ? null : (1 - 1 / speedup) * 100,
    },
    replayDiagnostics: replayResult?.replayDiagnostics ?? null,
    checkpointCaptureBreakdown: replayResult?.checkpointCaptureBreakdown ?? null,
  };
  await writeJson(resolve(outputDir, "evaluation.json"), result);
  return result;
}

async function task(command: "initialize" | "evaluate", recordFixtureRng = false) {
  const taskArgs = [taskCli, command, "--task", args.task, "--state-dir", stateDir];
  if (command === "initialize" && args.seed !== undefined) taskArgs.push("--seed", String(args.seed));
  if (command === "initialize" && recordFixtureRng) taskArgs.push("--record-fixture-rng");
  const result = await runCapture(python, taskArgs, {
    GRPC_VERBOSITY: "ERROR",
    ACTONCE_EMULATOR_GRPC_PORT: process.env.ACTONCE_EMULATOR_GRPC_PORT || "8554",
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

async function preparePermissionFixture(mode: "original" | "replay", value: unknown) {
  const apps = Array.isArray(value) ? value as Array<{ package?: string | null }> : [];
  const defaultPath = resolve(stateDir, "runtime-permissions.json");
  const path = args.fixturePermissions ? resolve(args.fixturePermissions) : defaultPath;
  const fixture = await json(path);
  const adb = process.env.MIDSCENE_ADB_PATH || "adb";
  const serial = process.env.ACTONCE_ANDROID_SERIAL || "emulator-5554";
  const command = async (values: string[]) => {
    const result = await runCapture(adb, ["-s", serial, ...values]);
    if (result.code !== 0) throw new Error(`Permission fixture command failed: ${result.stderr || result.stdout}`);
    return result.stdout;
  };
  if (fixture) {
    await restoreRuntimePermissionFixture(fixture, apps, command);
    if (mode === "original" && path !== defaultPath) await writeJson(defaultPath, fixture);
    return { status: "restored", path, sha256: createHash("sha256").update(await readFile(path)).digest("hex") };
  }
  if (args.fixturePermissions) throw new Error(`Explicit permission fixture not found: ${path}`);
  if (mode === "replay") return { status: "unavailable", reason: "Legacy original has no permission baseline; supply an evidence-backed --fixture-permissions file if needed" };
  await writeJson(defaultPath, await captureRuntimePermissionFixture(apps, command));
  return { status: "captured", path: defaultPath, sha256: createHash("sha256").update(await readFile(defaultPath)).digest("hex") };
}

async function prepareBoundary(mode: "original" | "replay" | "setup", apps: unknown) {
  const contractPath = resolve(stateDir, "start-environment.json");
  const saved = await json(contractPath);
  const policy = permissionPolicy(args.task, args.permissionPolicy, saved ?? undefined);
  if (policy === "recorded") {
    const permissionFixture = await preparePermissionFixture(mode === "replay" ? "replay" : "original", apps);
    await prepareInitialTargetApp(apps);
    return { permissionFixture, startEnvironment: { status: "legacy-recorded", permissionPolicy: policy } };
  }
  if (args.fixturePermissions) throw new Error("Stable permission policy cannot be combined with --fixture-permissions");
  if (!saved && mode === "replay") throw new Error("Stable replay requires the original task-state/start-environment.json; do not reinterpret a legacy recording");
  if (!saved && await json(resolve(outputDir, "original/manifest.json"))) throw new Error("Cannot change an existing recording's start environment; use a fresh output");
  const adb = process.env.MIDSCENE_ADB_PATH || "adb";
  const serial = process.env.ACTONCE_ANDROID_SERIAL || "emulator-5554";
  const command = async (values: string[]) => {
    const result = await runCapture(adb, ["-s", serial, ...values]);
    if (result.code !== 0) throw new Error(`Stable setup command failed: ${result.stderr || result.stdout}`);
    return result.stdout;
  };
  const actual = await normalizeStartEnvironment(args.task, apps, policy, command);
  if (saved) verifyStartEnvironment(saved, actual);
  else await writeJson(contractPath, actual);
  const permissionsPath = resolve(stateDir, "runtime-permissions.json");
  const existingPermissions = await json(permissionsPath);
  if (existingPermissions && !isDeepStrictEqual(existingPermissions, actual.permissions)) throw new Error("Saved permission fixture conflicts with stable setup contract");
  if (!existingPermissions) await writeJson(permissionsPath, actual.permissions);
  await prepareInitialTargetApp(apps);
  verifyStableForeground(policy, await command(["shell", "dumpsys", "window"]));
  // App startup must not silently replace the permanent grants with a new
  // request; verify once more before recording/replay clocks can start.
  const launchedPermissions = await captureRuntimePermissionFixture(Array.isArray(apps) ? apps : [], command);
  if (!isDeepStrictEqual(launchedPermissions, actual.permissions)) throw new Error("Permission baseline changed during app startup");
  return {
    permissionFixture: { status: "normalized", permissionPolicy: policy, path: resolve(stateDir, "runtime-permissions.json") },
    startEnvironment: { status: "verified", permissionPolicy: policy, path: contractPath, sha256: createHash("sha256").update(await readFile(contractPath)).digest("hex") },
  };
}

async function prepareInitialTargetApp(value: unknown) {
  const adb = process.env.MIDSCENE_ADB_PATH || "adb";
  const serial = process.env.ACTONCE_ANDROID_SERIAL || "emulator-5554";
  const { packages, initialPackage } = initialTargetPolicy(args.task, value);
  for (const packageName of packages) {
    const result = await runCapture(adb, ["-s", serial, "shell", "am", "force-stop", packageName]);
    if (result.code !== 0) throw new Error(`Failed to force-stop target app ${packageName}: ${result.stderr}`);
  }
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
    const activities = await runCapture(adb, ["-s", serial, "shell", "dumpsys", "activity", "activities"]);
    if (activities.code !== 0) throw new Error(`Failed to inspect foreground activity: ${activities.stderr}`);
    if (isInitialTargetForeground(initialPackage, focus.stdout, activities.stdout)) {
      await canonicalizeInitialAppState(adb, serial, initialPackage);
      return;
    }
    await delay(250);
  }
  throw new Error(`Timed out waiting for target app ${initialPackage} to reach the foreground`);
}

async function canonicalizeInitialAppState(adb: string, serial: string, packageName: string) {
  if (packageName !== CHROME_PACKAGE) return;
  const deadline = Date.now() + 30_000;
  const actionCounts = new Map<string, number>();
  while (Date.now() < deadline) {
    const dump = await runCapture(adb, ["-s", serial, "exec-out", "uiautomator", "dump", "/dev/tty"]);
    if (dump.code !== 0) throw new Error(`Failed to inspect Chrome fixture state: ${dump.stderr}`);
    if (isChromeReady(dump.stdout)) return;
    const action = nextChromeFixtureAction(dump.stdout);
    if (action) {
      const count = actionCounts.get(action.resourceId) ?? 0;
      if (count >= 4) {
        throw new Error(`Chrome fixture control ${action.resourceId} remained visible after four bounded attempts`);
      }
      // `uiautomator dump` briefly owns UiAutomation after its process exits. Give
      // Android time to release it before injecting the setup-only touch.
      await delay(500);
      const tapped = await runCapture(adb, [
        "-s", serial, "shell", "input", "touchscreen", "tap", String(action.point.x), String(action.point.y),
      ]);
      if (tapped.code !== 0) throw new Error(`Failed to advance Chrome fixture state: ${tapped.stderr}`);
      actionCounts.set(action.resourceId, count + 1);
      await delay(750);
      continue;
    }
    await delay(250);
  }
  throw new Error(
    "Chrome fixture did not reach a normal browser surface; refusing a non-reproducible benchmark",
  );
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
  replayModule?: string;
  fixturePermissions?: string;
  permissionPolicy?: string;
  modelProfile: AndroidWorldModelProfile;
} {
  let mode: Mode = "all", output: string | undefined, task = "SystemBrightnessMax";
  let seed: number | undefined, originalEntry: string | undefined, replayEntry: string | undefined;
  let fixturePermissions: string | undefined;
  let startPermissionPolicy: string | undefined;
  let replayModule: string | undefined;
  let modelProfile: AndroidWorldModelProfile = "codex-luna";
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] === "--mode") mode = values[++index] as Mode;
    else if (values[index] === "--output") output = values[++index];
    else if (values[index] === "--task") task = values[++index];
    else if (values[index] === "--seed") seed = Number(values[++index]);
    else if (values[index] === "--original-entry") originalEntry = values[++index];
    else if (values[index] === "--replay-entry") replayEntry = values[++index];
    else if (values[index] === "--replay-module") {
      replayModule = values[++index];
      if (!replayModule || replayModule.startsWith("--")) throw new Error("--replay-module requires a path");
    }
    else if (values[index] === "--fixture-permissions") {
      fixturePermissions = values[++index];
      if (!fixturePermissions || fixturePermissions.startsWith("--")) throw new Error("--fixture-permissions requires a path");
    }
    else if (values[index] === "--permission-policy") {
      startPermissionPolicy = values[++index];
      if (!startPermissionPolicy || !["recorded", "grant-all", "first-request"].includes(startPermissionPolicy)) throw new Error("--permission-policy requires recorded, grant-all or first-request");
    }
    else if (values[index] === "--model-profile") modelProfile = values[++index] as AndroidWorldModelProfile;
    else throw new Error(`Unknown argument: ${values[index]}`);
  }
  if (!["all", "original", "replay", "evaluate", "setup"].includes(mode)) throw new Error(`Unknown mode: ${mode}`);
  if (seed !== undefined && !Number.isInteger(seed)) throw new Error(`Invalid seed: ${seed}`);
  requireAndroidWorldModelProfile(modelProfile);
  validateReplaySelection(replayModule, replayEntry);
  return { mode, output, task, seed, originalEntry, replayEntry, replayModule, fixturePermissions, permissionPolicy: startPermissionPolicy, modelProfile };
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
