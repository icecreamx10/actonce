import "dotenv/config";
import { fork, spawn, execFile, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  access,
  chmod,
  copyFile,
  mkdir,
  open as openFile,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { agentForRecordedComputer } from "../../../interceptor/src/macos/recording-computer-device.js";
import type { RecorderContext } from "../../../interceptor/src/core/source-interceptor.js";
import {
  setupMacWindow,
  type MacWindowSetupResult,
} from "../../../runtime/macos/src/index.js";

type InteractionStep =
  | { id: string; kind: "assert"; prompt: string; optional?: boolean }
  | { id: string; kind: "boolean"; prompt: string; expect: boolean; optional?: boolean }
  | { id: string; kind: "query"; prompt: string; expect: unknown; optional?: boolean }
  | { id: string; kind: "tap" | "hover"; target: string; optional?: boolean }
  | { id: string; kind: "input"; target: string; value: string; optional?: boolean }
  | { id: string; kind: "press"; key: string; optional?: boolean }
  | { id: string; kind: "wait"; durationMs: number; optional?: boolean };

type TestCase = {
  schemaVersion: 1;
  id: string;
  benchmarkId?: string;
  title: string;
  complexity: "basic" | "intermediate" | "advanced" | "deep";
  dimensions: string[];
  estimatedDurationMs: number;
  naturalLanguageTask: string;
  setup: { readyAssertion: string };
  precondition: string;
  steps: InteractionStep[];
  cleanup: {
    mode: "always" | "on-failure";
    save: false;
    steps: InteractionStep[];
  };
};

type StepResult = {
  id: string;
  kind: InteractionStep["kind"] | "precondition";
  status: "passed" | "failed" | "skipped";
  durationMs: number;
  expected?: unknown;
  observed?: unknown;
  error?: ReturnType<typeof serializeError>;
};

type FixtureProvenance = {
  archive: string;
  archiveSha256: string;
  commit: string;
  lynxtronVersion: string;
  lynxtronArchiveSha256: string;
  platform: string;
  architecture: string;
};

const benchmarkDir = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(benchmarkDir, "../../..");
const caseId = readCaseId(process.argv.slice(2));
const testCase = JSON.parse(
  await readFile(join(benchmarkDir, "cases", `${caseId}.json`), "utf8"),
) as TestCase;
validateTestCase(testCase, caseId);
const provenance = JSON.parse(
  await readFile(join(benchmarkDir, "fixture/provenance.json"), "utf8"),
) as FixtureProvenance;
const displayId = process.env.ACTONCE_DISPLAY_ID ?? "0";
const runId = `${testCase.id}-${new Date().toISOString().replaceAll(":", "-")}`;
const outputDir = resolve(
  process.env.ACTONCE_BENCHMARK_OUTPUT_DIR ??
    join(repositoryRoot, "artifacts/benchmarks/lynxtron-fiddle", runId),
);
const recordingRoot = join(outputDir, "recording");
const fixtureRoot = join(
  process.env.ACTONCE_LYNXTRON_FIXTURE_ROOT ??
    join(
      repositoryRoot,
      ".cache/benchmarks/lynxtron-fiddle",
      provenance.archiveSha256.slice(0, 12),
    ),
);
const desktopBundle = process.env.ACTONCE_LYNXTRON_DESKTOP_BUNDLE ?? join(fixtureRoot, "desktop");
const fixtureArchive = join(benchmarkDir, "fixture", provenance.archive);
const fixtureConfig = process.env.ACTONCE_LYNXTRON_CONFIG_PATH ?? join(outputDir, "fixture-config.json");
const benchmarkNodeModules = join(benchmarkDir, "node_modules");
const lynxtronExecutable = join(
  repositoryRoot,
  ".cache/benchmarks/lynxtron-host",
  `${provenance.lynxtronVersion}-${provenance.lynxtronArchiveSha256.slice(0, 12)}`,
  "Lynxtron.app/Contents/MacOS/lynxtron",
);
const lynxtronApp = resolve(lynxtronExecutable, "../../..");
const require = createRequire(import.meta.url);
const midsceneComputerRoot = dirname(
  require.resolve("@midscene/computer/package.json"),
);
const displayInfoHelper = join(
  midsceneComputerRoot,
  "bin/darwin/display-info",
);

if (process.platform !== provenance.platform || process.arch !== provenance.architecture) {
  throw new Error(
    `Fixture requires ${provenance.platform}/${provenance.architecture}; current host is ${process.platform}/${process.arch}`,
  );
}
await mkdir(outputDir, { recursive: true });
await ensureExecutable(displayInfoHelper);
await ensureExecutable(lynxtronExecutable).catch(() => {
  throw new Error(
    `Benchmark dependencies are missing. Run: npm run benchmark:macos:lynxtron:prepare`,
  );
});
await prepareFixture();
await resetFixtureState();
await verifyLanguageService();

const startedAt = new Date().toISOString();
const startedNs = process.hrtime.bigint();
const reportsBefore = await reportFiles();
const appLog = await openFile(join(outputDir, "lynxtron.log"), "a");
const appProcess = spawn(lynxtronExecutable, [desktopBundle], {
  cwd: fixtureRoot,
  detached: true,
  stdio: ["ignore", appLog.fd, appLog.fd],
  env: {
    ...process.env,
    // Benchmark runs own their Lynxtron process. Avoid forwarding the fixture
    // to an unrelated, already-running Fiddle instance through Electron's
    // global singleton lock.
    LYNXTRON_ALLOW_MULTI: "1",
    LYNXTRON_FIDDLE_DEV: "1",
    ACTONCE_LYNXTRON_CONFIG_PATH: fixtureConfig,
    TMPDIR: process.env.ACTONCE_LYNXTRON_TMPDIR ?? process.env.TMPDIR,
    NODE_PATH: [benchmarkNodeModules, process.env.NODE_PATH]
      .filter(Boolean)
      .join(":"),
  },
});
let stoppingApp = false;
let recorded: Awaited<ReturnType<typeof agentForRecordedComputer>> | undefined;
let benchmarkSource: RecorderContext | undefined;
let windowSetup: MacWindowSetupResult | null = null;
let failure: { name: string; message: string; stack?: string } | null = null;
const stepResults: StepResult[] = [];
const cleanupResults: StepResult[] = [];
let executionStartedNs: bigint | undefined;
let executionCompletedNs: bigint | undefined;

const stopOpenedApp = async (): Promise<void> => {
  if (stoppingApp || !appProcess.pid) return;
  stoppingApp = true;
  signalProcessGroup(appProcess, "SIGTERM");
  if (!(await waitForExit(appProcess, 3000))) {
    signalProcessGroup(appProcess, "SIGKILL");
    await waitForExit(appProcess, 1000);
  }
};
const interrupt = (exitCode: number) => {
  void stopOpenedApp().finally(() => process.exit(exitCode));
};
const onSigint = () => interrupt(130);
const onSigterm = () => interrupt(143);
process.once("SIGINT", onSigint);
process.once("SIGTERM", onSigterm);

try {
  await waitForLaunch(appProcess, 3500);
  await waitForAppWindow(appProcess.pid!, 15_000);
  await waitForLogMarker(
    join(outputDir, "lynxtron.log"),
    "[IDE] ide:* listeners registered",
    15_000,
  );
  windowSetup = await setupMacWindow({
    pid: appProcess.pid!,
    displayId: parseDisplayId(displayId),
    width: 1372,
    height: 880,
    margin: 40,
    placement: "center",
  });
  recorded = await agentForRecordedComputer(
    {
      displayId,
      aiActionContext:
        `You are executing the '${testCase.title}' benchmark in the visible Lynxtron Fiddle desktop app. Follow each requested interaction literally, stay inside Lynxtron and its preview windows, and never save files.`,
    },
    { rootDir: recordingRoot, recordingId: "actonce" },
  );
  const { agent } = recorded;
  benchmarkSource = recorded.writer.source({
    type: "benchmark-case",
    instanceId: testCase.id,
    version: "1",
  });
  benchmarkSource.emit({
    kind: "benchmark.case.started",
    lifecycle: "started",
    caseId: testCase.id,
    title: testCase.title,
    complexity: testCase.complexity,
    dimensions: testCase.dimensions,
    naturalLanguageTask: testCase.naturalLanguageTask,
  });
  windowSetup = await setupMacWindow({
    pid: appProcess.pid!,
    displayId: parseDisplayId(displayId),
    width: 1372,
    height: 880,
    margin: 40,
    placement: "center",
  });
  executionStartedNs = process.hrtime.bigint();
  await executePrecondition(agent);
  for (const step of testCase.steps) {
    const result = await executeStep(agent, step, "case");
    stepResults.push(result);
    if (result.status === "failed") {
      throw new Error(`Case step failed: ${step.id}: ${result.error?.message ?? "unknown error"}`);
    }
  }
} catch (error) {
  failure = serializeError(error);
} finally {
  try {
    if (recorded && (testCase.cleanup.mode === "always" || failure !== null)) {
      for (const step of testCase.cleanup.steps) {
        const result = await executeStep(recorded.agent, step, "cleanup");
        cleanupResults.push(result);
        if (result.status === "failed" && !step.optional && failure === null) {
          failure = result.error ?? serializeError(new Error(`Cleanup step failed: ${step.id}`));
        }
      }
    }
  } catch (error) {
    failure ??= serializeError(error);
  } finally {
    if (executionStartedNs && !executionCompletedNs) {
      executionCompletedNs = process.hrtime.bigint();
    }
    try {
      benchmarkSource?.emit({
        kind: "benchmark.case.completed",
        lifecycle: failure === null ? "completed" : "failed",
        caseId: testCase.id,
        status: failure === null ? "passed" : "failed",
        completedSteps: stepResults.filter((step) => step.status === "passed").length,
        totalSteps: testCase.steps.length + 1,
        cleanupSteps: cleanupResults.length,
      });
      await recorded?.close();
    } catch (error) {
      failure ??= serializeError(error);
    } finally {
      process.off("SIGINT", onSigint);
      process.off("SIGTERM", onSigterm);
      await stopOpenedApp();
      await appLog.close();
    }
  }
}

const passed = failure === null && stepResults.every((step) => step.status === "passed");
const report = await copyNewReport(reportsBefore, outputDir);
const result = {
  schemaVersion: 1,
  benchmark: testCase.id,
  mode: "original",
  suite: "lynxtron-fiddle-macos",
  title: testCase.title,
  complexity: testCase.complexity,
  dimensions: testCase.dimensions,
  runId,
  status: passed ? "passed" : "failed",
  startedAt,
  completedAt: new Date().toISOString(),
  durationMs: Number(process.hrtime.bigint() - startedNs) / 1_000_000,
  executionDurationMs:
    executionStartedNs && executionCompletedNs
      ? Number(executionCompletedNs - executionStartedNs) / 1_000_000
      : null,
  naturalLanguageTask: testCase.naturalLanguageTask,
  fixture: {
    upstreamCommit: provenance.commit,
    archiveSha256: provenance.archiveSha256,
    lynxtronVersion: provenance.lynxtronVersion,
    platform: process.platform,
    architecture: process.arch,
    displayId,
    windowSetup,
  },
  ...legacyDiagnosticFields(testCase.id, stepResults),
  steps: stepResults,
  artifacts: {
    result: "result.json",
    lynxtronLog: "lynxtron.log",
    recording: recorded ? relative(outputDir, recorded.writer.recordingDir) : null,
    midsceneReport: report ? relative(outputDir, report) : null,
  },
  cleanup: {
    mode: testCase.cleanup.mode,
    steps: cleanupResults,
    saved: false,
    fixtureProcessStopped: appProcess.exitCode !== null || appProcess.signalCode !== null,
  },
  error: failure,
};
await writeFile(
  join(outputDir, "result.json"),
  `${JSON.stringify(result, null, 2)}\n`,
  "utf8",
);
console.log(JSON.stringify({ ...result, outputDir }, null, 2));
if (!passed) process.exitCode = 2;

function legacyDiagnosticFields(
  id: string,
  steps: StepResult[],
): Record<string, unknown> {
  if (id !== "diagnostic-hover") return {};
  const redSquiggle = steps.find((step) => step.id === "red-squiggle");
  const tooltip = steps.find((step) => step.id === "tooltip-message")?.observed as
    | { visible?: boolean; message?: string | null }
    | undefined;
  return {
    // Compatibility with the original/replay evaluator developed alongside
    // the first benchmark. Generic suite consumers should use `steps`.
    expected: {
      syntaxErrorVisible: true,
      tooltipVisible: true,
      tooltipMessage: "Expression expected.",
    },
    observed: {
      syntaxErrorVisible:
        typeof redSquiggle?.observed === "boolean" ? redSquiggle.observed : null,
      tooltipVisible: typeof tooltip?.visible === "boolean" ? tooltip.visible : null,
      tooltipMessage: typeof tooltip?.message === "string" ? tooltip.message : null,
    },
  };
}

type RecordedAgent = NonNullable<typeof recorded>["agent"];

async function executePrecondition(agent: RecordedAgent): Promise<void> {
  const started = process.hrtime.bigint();
  benchmarkSource?.emit({
    kind: "benchmark.step.started",
    lifecycle: "started",
    caseId: testCase.id,
    stepId: "precondition",
    stepKind: "assert",
    phase: "precondition",
    instruction: { prompt: testCase.precondition },
  });
  try {
    await agent.aiAssert(testCase.precondition);
    const result: StepResult = {
      id: "precondition",
      kind: "precondition",
      status: "passed",
      durationMs: elapsedMs(started),
    };
    stepResults.push(result);
    emitStepCompleted(result, "precondition");
  } catch (error) {
    const result: StepResult = {
      id: "precondition",
      kind: "precondition",
      status: "failed",
      durationMs: elapsedMs(started),
      error: serializeError(error),
    };
    stepResults.push(result);
    emitStepCompleted(result, "precondition");
    throw error;
  }
}

async function executeStep(
  agent: RecordedAgent,
  step: InteractionStep,
  phase: "case" | "cleanup",
): Promise<StepResult> {
  const started = process.hrtime.bigint();
  let observed: unknown;
  benchmarkSource?.emit({
    kind: "benchmark.step.started",
    lifecycle: "started",
    caseId: testCase.id,
    stepId: step.id,
    stepKind: step.kind,
    phase,
    instruction: stepInstruction(step),
  });
  try {
    switch (step.kind) {
      case "assert":
        await agent.aiAssert(step.prompt);
        observed = true;
        break;
      case "boolean":
        observed = await agent.aiBoolean(step.prompt);
        if (observed !== step.expect) {
          throw new Error(
            `Step ${step.id} expected ${JSON.stringify(step.expect)}, got ${JSON.stringify(observed)}`,
          );
        }
        break;
      case "query":
        observed = await agent.aiQuery(step.prompt);
        if (!matchesExpected(observed, step.expect)) {
          throw new Error(
            `Step ${step.id} query mismatch: expected ${JSON.stringify(step.expect)}, got ${JSON.stringify(observed)}`,
          );
        }
        break;
      case "tap":
        await agent.aiTap(step.target);
        break;
      case "hover":
        await agent.aiHover(step.target);
        break;
      case "input":
        await agent.aiInput(step.target, { value: step.value });
        break;
      case "press":
        await recorded!.device.inputPrimitives.keyboard.keyboardPress(step.key);
        break;
      case "wait":
        await delay(step.durationMs);
        break;
    }
    const result: StepResult = {
      id: step.id,
      kind: step.kind,
      status: "passed",
      durationMs: elapsedMs(started),
      ...(step.kind === "boolean" || step.kind === "query"
        ? { expected: step.expect, observed }
        : {}),
    };
    emitStepCompleted(result, phase);
    return result;
  } catch (error) {
    const result: StepResult = {
      id: step.id,
      kind: step.kind,
      status: step.optional ? "skipped" : "failed",
      durationMs: elapsedMs(started),
      ...(step.kind === "boolean" || step.kind === "query"
        ? { expected: step.expect, observed }
        : {}),
      error: serializeError(error),
    };
    emitStepCompleted(result, phase);
    return result;
  }
}

function emitStepCompleted(
  result: StepResult,
  phase: "precondition" | "case" | "cleanup",
): void {
  benchmarkSource?.emit({
    kind: "benchmark.step.completed",
    lifecycle: result.status === "failed" ? "failed" : "completed",
    caseId: testCase.id,
    stepId: result.id,
    stepKind: result.kind,
    phase,
    status: result.status,
    durationMs: result.durationMs,
    expected: result.expected,
    observed: result.observed,
    error: result.error,
  });
}

function stepInstruction(step: InteractionStep): Record<string, unknown> {
  switch (step.kind) {
    case "assert":
    case "boolean":
    case "query":
      return { prompt: step.prompt };
    case "tap":
    case "hover":
      return { target: step.target };
    case "input":
      return { target: step.target, value: step.value };
    case "press":
      return { key: step.key };
    case "wait":
      return { durationMs: step.durationMs };
  }
}

function matchesExpected(observed: unknown, expected: unknown): boolean {
  if (expected === null || typeof expected !== "object") return observed === expected;
  if (Array.isArray(expected)) {
    return Array.isArray(observed) && expected.length === observed.length &&
      expected.every((value, index) => matchesExpected(observed[index], value));
  }
  if (observed === null || typeof observed !== "object" || Array.isArray(observed)) return false;
  return Object.entries(expected).every(([key, value]) =>
    matchesExpected((observed as Record<string, unknown>)[key], value),
  );
}

function elapsedMs(started: bigint): number {
  return Number(process.hrtime.bigint() - started) / 1_000_000;
}

function readCaseId(args: string[]): string {
  const index = args.indexOf("--case");
  if (index === -1) return process.env.ACTONCE_BENCHMARK_CASE ?? "diagnostic-hover";
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error("--case requires a case id");
  if (!/^[a-z0-9-]+$/.test(value)) throw new Error(`Invalid case id: ${value}`);
  return value;
}

function validateTestCase(value: TestCase, requestedId: string): void {
  if (value.schemaVersion !== 1 || value.id !== requestedId) {
    throw new Error(`Case file identity mismatch for ${requestedId}`);
  }
  if (!value.steps.length) throw new Error(`Case ${requestedId} has no steps`);
  const ids = ["precondition", ...value.steps.map((step) => step.id)];
  if (new Set(ids).size !== ids.length) throw new Error(`Case ${requestedId} has duplicate step ids`);
  if (value.cleanup.save !== false) throw new Error(`Case ${requestedId} must never save`);
}

async function prepareFixture(): Promise<void> {
  const archiveBytes = await readFile(fixtureArchive);
  const sha256 = createHash("sha256").update(archiveBytes).digest("hex");
  if (sha256 !== provenance.archiveSha256) {
    throw new Error(
      `Fixture archive checksum mismatch: expected ${provenance.archiveSha256}, got ${sha256}`,
    );
  }
  try {
    await access(join(desktopBundle, "main.js"));
  } catch {
    await rm(fixtureRoot, { recursive: true, force: true });
    await mkdir(fixtureRoot, { recursive: true });
    await execFilePromise("/usr/bin/tar", ["-xzf", fixtureArchive, "-C", fixtureRoot]);
  }
  await linkRuntimeDependency("typescript");
  await patchFixtureConfigPath();
}

async function patchFixtureConfigPath(): Promise<void> {
  const preloadPath = join(desktopBundle, "preload.js");
  const original =
    'D=k().join(_().homedir(),".lynxtron-ide.".concat(T,".json"))';
  const isolated =
    'D=process.env.ACTONCE_LYNXTRON_CONFIG_PATH||k().join(_().homedir(),".lynxtron-ide.".concat(T,".json"))';
  const source = await readFile(preloadPath, "utf8");
  if (source.includes(isolated)) return;
  if (!source.includes(original)) {
    throw new Error("Pinned Lynxtron preload config hook no longer matches the fixture");
  }
  await writeFile(preloadPath, source.replace(original, isolated), "utf8");
}

async function resetFixtureState(): Promise<void> {
  await writeFile(
    fixtureConfig,
    `${JSON.stringify(
      {
        "fiddle.settings": {
          theme: "dark",
          fontSize: 13,
          blockAccelerators: false,
          runtimeFlags: "",
          githubToken: "",
          showWelcomeTour: false,
        },
        "fiddle.tour.seen": true,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

async function linkRuntimeDependency(packageName: string): Promise<void> {
  const source = join(benchmarkNodeModules, packageName);
  const target = join(desktopBundle, "node_modules", packageName);
  const sourceManifest = JSON.parse(
    await readFile(join(source, "package.json"), "utf8"),
  ) as { version?: string };
  try {
    const targetManifest = JSON.parse(
      await readFile(join(target, "package.json"), "utf8"),
    ) as { version?: string };
    if (targetManifest.version !== sourceManifest.version) {
      throw new Error(
        `${packageName} runtime version mismatch: expected ${sourceManifest.version}, got ${targetManifest.version}`,
      );
    }
  } catch {
    await rm(target, { recursive: true, force: true });
    await symlink(source, target, "dir");
  }
}

async function verifyLanguageService(): Promise<void> {
  const hostPath = join(desktopBundle, "extension-host.js");
  const probeUri = join(fixtureRoot, "diagnostic-preflight.js");
  const expectedMessage = "Expression expected.";
  await new Promise<void>((resolveProbe, rejectProbe) => {
    const child = fork(hostPath, [], {
      silent: true,
      env: { ...process.env, LYNXTRON_RUN_AS_NODE: "1" },
    });
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      rejectProbe(new Error("Lynxtron language-service preflight timed out"));
    }, 5000);
    const finish = (error?: Error) => {
      clearTimeout(timer);
      child.removeAllListeners();
      child.kill();
      if (error) rejectProbe(error);
      else resolveProbe();
    };
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.once("error", (error) => finish(error));
    child.once("exit", (code, signal) => {
      finish(
        new Error(
          `Lynxtron language-service exited during preflight (code=${code}, signal=${signal}): ${stderr.trim()}`,
        ),
      );
    });
    child.on("message", (message: unknown) => {
      const value = message as {
        type?: string;
        markers?: Array<{ message?: string }>;
      };
      if (value.type === "ready") {
        child.send({
          type: "textChanged",
          uri: probeUri,
          text: "const actOnceSyntaxProbe = (",
          version: 1,
          languageId: "javascript",
        });
      } else if (value.type === "diagnostics") {
        const messages = value.markers?.map((marker) => marker.message) ?? [];
        finish(
          messages.includes(expectedMessage)
            ? undefined
            : new Error(
                `Lynxtron language-service preflight did not return ${JSON.stringify(expectedMessage)}; got ${JSON.stringify(messages)}`,
              ),
        );
      }
    });
  });
}

function parseDisplayId(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`ACTONCE_DISPLAY_ID must be a non-negative integer; received ${JSON.stringify(value)}`);
  }
  return parsed;
}

async function waitForLogMarker(
  path: string,
  marker: string,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await readFile(path, "utf8")).includes(marker)) return;
    } catch {
      // The log file may not be visible to the reader immediately after spawn.
    }
    await delay(100);
  }
  throw new Error(`Lynxtron did not emit readiness marker ${JSON.stringify(marker)}`);
}

async function waitForAppWindow(pid: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await execFilePromise("/usr/bin/osascript", [
        "-e",
        `tell application \"System Events\" to tell first process whose unix id is ${pid} to if (count of windows) is 0 then error \"Lynxtron window is not ready\"`,
      ]);
      return;
    } catch {
      await delay(250);
    }
  }
  throw new Error(`Lynxtron did not create a window within ${timeoutMs}ms`);
}

async function reportFiles(): Promise<Set<string>> {
  const directory = join(repositoryRoot, "midscene_run/report");
  try {
    return new Set(
      (await readdir(directory))
        .filter((name) => name.endsWith(".html"))
        .map((name) => join(directory, name)),
    );
  } catch {
    return new Set();
  }
}

async function copyNewReport(
  before: Set<string>,
  destination: string,
): Promise<string | null> {
  const candidates = [...(await reportFiles())].filter((path) => !before.has(path));
  if (!candidates.length) return null;
  const withTimes = await Promise.all(
    candidates.map(async (path) => ({ path, mtimeMs: (await stat(path)).mtimeMs })),
  );
  withTimes.sort((left, right) => right.mtimeMs - left.mtimeMs);
  const output = join(destination, "midscene-report.html");
  await copyFile(withTimes[0].path, output);
  return output;
}

function execFilePromise(command: string, args: string[]): Promise<void> {
  return new Promise((resolveExec, rejectExec) => {
    execFile(command, args, (error) => (error ? rejectExec(error) : resolveExec()));
  });
}

function signalProcessGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  if (!child.pid) return;
  try {
    process.kill(-child.pid, signal);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) {
      throw error;
    }
  }
}

async function waitForLaunch(child: ChildProcess, settleMs: number): Promise<void> {
  if (!child.pid) throw new Error("Failed to start Lynxtron Fiddle");
  await new Promise<void>((resolveLaunch, rejectLaunch) => {
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      clearTimeout(timer);
      rejectLaunch(
        new Error(`Lynxtron exited during launch (code=${code}, signal=${signal})`),
      );
    };
    const timer = setTimeout(() => {
      child.off("exit", onExit);
      resolveLaunch();
    }, settleMs);
    child.once("exit", onExit);
  });
}

async function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return true;
  return new Promise<boolean>((resolveExit) => {
    const onExit = () => {
      clearTimeout(timer);
      resolveExit(true);
    };
    const timer = setTimeout(() => {
      child.off("exit", onExit);
      resolveExit(false);
    }, timeoutMs);
    child.once("exit", onExit);
  });
}

async function ensureExecutable(path: string): Promise<void> {
  try {
    await access(path, constants.X_OK);
  } catch {
    await chmod(path, 0o755);
  }
}

function serializeError(error: unknown) {
  return error instanceof Error
    ? { name: error.name, message: error.message, stack: error.stack }
    : { name: "Error", message: String(error) };
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}
