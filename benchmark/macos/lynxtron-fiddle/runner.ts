import "dotenv/config";
import { spawn, execFile, type ChildProcess } from "node:child_process";
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
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ComputerAgent, ComputerDevice } from "@midscene/computer";
import { agentForRecordedComputer } from "../../../interceptor/src/macos/recording-computer-device.js";

type TestCase = {
  schemaVersion: 1;
  id: string;
  title: string;
  naturalLanguageTask: string;
  setup: { readyAssertion: string };
  precondition: string;
  input: { target: string; value: string };
  observations: {
    syntaxError: string;
    hoverTarget: string;
    tooltipQuery: string;
  };
  expected: {
    syntaxErrorVisible: boolean;
    tooltipVisible: boolean;
    tooltipMessage: string;
  };
  cleanup: { undoCount: number; save: false };
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
const testCase = JSON.parse(
  await readFile(join(benchmarkDir, "testcase.json"), "utf8"),
) as TestCase;
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
  repositoryRoot,
  ".cache/benchmarks/lynxtron-fiddle",
  provenance.archiveSha256.slice(0, 12),
);
const desktopBundle = join(fixtureRoot, "desktop");
const fixtureArchive = join(benchmarkDir, "fixture", provenance.archive);
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
    NODE_PATH: [benchmarkNodeModules, process.env.NODE_PATH]
      .filter(Boolean)
      .join(":"),
  },
});
let stoppingApp = false;
let recorded: Awaited<ReturnType<typeof agentForRecordedComputer>> | undefined;
let editorChanged = false;
let hasRedSquiggle: boolean | null = null;
let hover: { visible: boolean; message: string | null } | null = null;
let failure: { name: string; message: string; stack?: string } | null = null;

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
  await execFilePromise("/usr/bin/open", ["-a", lynxtronApp]);
  await activateProcess(appProcess.pid!);
  await delay(1500);
  await verifyFixtureReady();
  recorded = await agentForRecordedComputer(
    {
      displayId,
      aiActionContext:
        "You are testing the visible Lynxtron Fiddle desktop app. Work only inside its source-code editors.",
    },
    { rootDir: recordingRoot, recordingId: "actonce" },
  );
  const { agent } = recorded;
  await agent.aiAssert(testCase.precondition);
  await agent.aiInput(testCase.input.target, { value: testCase.input.value });
  editorChanged = true;
  await delay(2500);
  hasRedSquiggle = await agent.aiBoolean(testCase.observations.syntaxError);
  await agent.aiHover(testCase.observations.hoverTarget);
  await delay(1200);
  hover = await agent.aiQuery(testCase.observations.tooltipQuery);
} catch (error) {
  failure = serializeError(error);
} finally {
  try {
    if (recorded && editorChanged) {
      for (let index = 0; index < testCase.cleanup.undoCount; index += 1) {
        await recorded.device.inputPrimitives.keyboard.keyboardPress("Cmd+Z");
      }
    }
  } catch (error) {
    failure ??= serializeError(error);
  } finally {
    try {
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

const passed =
  failure === null &&
  hasRedSquiggle === testCase.expected.syntaxErrorVisible &&
  hover?.visible === testCase.expected.tooltipVisible &&
  hover?.message === testCase.expected.tooltipMessage;
const report = await copyNewReport(reportsBefore, outputDir);
const result = {
  schemaVersion: 1,
  benchmark: testCase.id,
  runId,
  status: passed ? "passed" : "failed",
  startedAt,
  completedAt: new Date().toISOString(),
  durationMs: Number(process.hrtime.bigint() - startedNs) / 1_000_000,
  naturalLanguageTask: testCase.naturalLanguageTask,
  fixture: {
    upstreamCommit: provenance.commit,
    archiveSha256: provenance.archiveSha256,
    lynxtronVersion: provenance.lynxtronVersion,
    platform: process.platform,
    architecture: process.arch,
    displayId,
  },
  expected: testCase.expected,
  observed: {
    syntaxErrorVisible: hasRedSquiggle,
    tooltipVisible: hover?.visible ?? null,
    tooltipMessage: hover?.message ?? null,
  },
  artifacts: {
    result: "result.json",
    lynxtronLog: "lynxtron.log",
    recording: recorded ? relative(outputDir, recorded.writer.recordingDir) : null,
    midsceneReport: report ? relative(outputDir, report) : null,
  },
  cleanup: {
    undoCount: editorChanged ? testCase.cleanup.undoCount : 0,
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
    return;
  } catch {
    await rm(fixtureRoot, { recursive: true, force: true });
    await mkdir(fixtureRoot, { recursive: true });
    await execFilePromise("/usr/bin/tar", ["-xzf", fixtureArchive, "-C", fixtureRoot]);
  }
}

async function verifyFixtureReady(): Promise<void> {
  const focusDevice = new ComputerDevice({ displayId });
  await focusDevice.connect();
  try {
    const focusAgent = new ComputerAgent(focusDevice, {
      aiActionContext:
        "Prepare the benchmark fixture only. Activate Lynxtron Fiddle without editing content.",
    });
    await focusAgent.aiAssert(testCase.setup.readyAssertion);
  } finally {
    await focusDevice.destroy();
  }
}

async function activateProcess(pid: number): Promise<void> {
  try {
    await execFilePromise("/usr/bin/osascript", [
      "-e",
      `tell application \"System Events\" to set frontmost of first process whose unix id is ${pid} to true`,
    ]);
  } catch (error) {
    throw new Error(
      "Unable to activate the Lynxtron process through System Events. Grant Accessibility permission to the benchmark host and /usr/bin/osascript, and do not run from another application's full-screen Space.",
      { cause: error },
    );
  }
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
