import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type SuiteManifest = {
  schemaVersion: 1;
  id: string;
  title: string;
  cases: string[];
  defaultCases?: string[];
};

const benchmarkDir = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(benchmarkDir, "../../..");
const suite = JSON.parse(
  await readFile(join(benchmarkDir, "suite.json"), "utf8"),
) as SuiteManifest;
const requestedCases = parseCaseArgs(process.argv.slice(2));
const caseIds = requestedCases.length
  ? requestedCases
  : suite.defaultCases ?? suite.cases;
for (const id of caseIds) {
  if (!suite.cases.includes(id)) throw new Error(`Unknown suite case: ${id}`);
}

const runId = `${suite.id}-${new Date().toISOString().replaceAll(":", "-")}`;
const outputDir = resolve(
  process.env.ACTONCE_BENCHMARK_OUTPUT_DIR ??
    join(repositoryRoot, "artifacts/benchmarks/lynxtron-fiddle-suites", runId),
);
await mkdir(join(outputDir, "cases"), { recursive: true });
const startedAt = new Date().toISOString();
const startedNs = process.hrtime.bigint();
const results: Array<{
  caseId: string;
  status: "passed" | "failed";
  exitCode: number;
  result: unknown | null;
}> = [];

for (const caseId of caseIds) {
  const caseOutput = join(outputDir, "cases", caseId);
  const exitCode = await runCase(caseId, caseOutput);
  let result: unknown | null = null;
  try {
    result = JSON.parse(await readFile(join(caseOutput, "result.json"), "utf8"));
  } catch {
    // Early platform or dependency failures may happen before result creation.
  }
  results.push({
    caseId,
    status: exitCode === 0 ? "passed" : "failed",
    exitCode,
    result,
  });
}

const passedCases = results.filter((result) => result.status === "passed").length;
const summary = {
  schemaVersion: 1,
  suite: suite.id,
  title: suite.title,
  runId,
  status: passedCases === results.length ? "passed" : "failed",
  startedAt,
  completedAt: new Date().toISOString(),
  durationMs: Number(process.hrtime.bigint() - startedNs) / 1_000_000,
  selectedCases: caseIds,
  counts: {
    passed: passedCases,
    failed: results.length - passedCases,
    total: results.length,
  },
  cases: results.map(({ caseId, status, exitCode }) => ({
    caseId,
    status,
    exitCode,
    result: `cases/${caseId}/result.json`,
  })),
};
await writeFile(join(outputDir, "suite-result.json"), `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify({ ...summary, outputDir }, null, 2));
if (summary.status === "failed") process.exitCode = 2;

function runCase(caseId: string, caseOutput: string): Promise<number> {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(
      join(repositoryRoot, "node_modules/.bin/tsx"),
      [
        join(benchmarkDir, "cli.ts"),
        "run",
        "--mode",
        "original",
        "--case",
        caseId,
        "--output",
        caseOutput,
      ],
      {
        cwd: repositoryRoot,
        stdio: "inherit",
        env: process.env,
      },
    );
    child.once("error", rejectRun);
    child.once("exit", (code, signal) => {
      if (signal) rejectRun(new Error(`Case ${caseId} exited with signal ${signal}`));
      else resolveRun(code ?? 1);
    });
  });
}

function parseCaseArgs(args: string[]): string[] {
  const cases: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== "--case") throw new Error(`Unknown argument: ${args[index]}`);
    const value = args[++index];
    if (!value) throw new Error("--case requires a case id");
    cases.push(value);
  }
  return cases;
}
