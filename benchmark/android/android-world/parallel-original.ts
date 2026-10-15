import { execFileSync, spawn } from "node:child_process";
import { constants, createWriteStream } from "node:fs";
import { copyFile, mkdir, readFile, statfs, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { selectMidsceneAndroidWorldCases } from "./catalog.js";
import { requireAndroidWorldModelProfile } from "./model-profile.js";

const args = process.argv.slice(2);
function option(name: string, fallback: string) {
  const index = args.indexOf(name);
  return index < 0 ? fallback : args[index + 1];
}
const phase = option("--phase", "plan");
const root = resolve(option("--output", ".cache/android-world/parallel-original-20261009"));
const planPath = resolve(root, "plan.json");
await mkdir(root, { recursive: true });
if (phase === "plan") {
  const retrySource = option("--retry-setup-failures-from", "");
  if (retrySource) {
    const sourceRoot = resolve(retrySource);
    if (sourceRoot === root) throw new Error("Retry output must differ from the original campaign");
    const prior = JSON.parse(await readFile(resolve(sourceRoot, "plan.json"), "utf8"));
    const workers = [];
    for (const worker of prior.workers) {
      const cases = [];
      for (const entry of worker.cases) {
        const attemptPath = resolve(samplePath(worker.output, entry), "original-attempt.json");
        const attempt = JSON.parse(await readFile(attemptPath, "utf8"));
        if (attempt.status === "setup-failed") cases.push({ ...entry, retryEvidence: attemptPath });
      }
      workers.push({ ...worker, output: resolve(root, `worker-${worker.id}`), cases });
    }
    const plan = { ...prior, retrySource: sourceRoot, workers,
      pendingCount: workers.reduce((count, worker) => count + worker.cases.length, 0) };
    await writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`);
    console.log(JSON.stringify({ planPath, pending: plan.pendingCount, retrySource: sourceRoot }));
  } else {
    const successful = new Map<string, string[]>();
    function add(task: string, evidence: string) {
      successful.set(task, [...(successful.get(task) ?? []), evidence]);
    }
    const files = execFileSync("rg", ["--files", "--hidden", "-g", "**/original/result.json", ".cache/android-world"], { encoding: "utf8" });
    for (const path of files.split("\n").filter((path) => path.endsWith("/original/result.json"))) {
      const result = JSON.parse(await readFile(path, "utf8"));
      if (result.status === "passed" && result.officialValidator?.reward === 1) add(result.task, path);
    }
    for (const date of ["2026-08-18", "2026-08-20"]) {
      const reference = `codex/android-midscene-benchmark:benchmark/android/android-world/ARK-REPLAY-RESULTS-${date}.md`;
      const report = execFileSync("git", ["show", reference], { encoding: "utf8" });
      for (const line of report.split("\n")) {
        const cells = line.split("|").map((cell) => cell.trim());
        const index = cells.findIndex((cell) => /^`\w+`$/.test(cell));
        if (index >= 0 && cells[index + 2] === "1") add(cells[index].slice(1, -1), reference);
      }
    }
    const catalog = selectMidsceneAndroidWorldCases("pass@3");
    const pending = catalog.filter((entry) => !successful.has(entry.task));
    const plan = {
      schemaVersion: 1, phase: "original", selection: "pass@3", catalogCount: catalog.length,
      modelProfile: "codex-6-luna", samplesPerCase: 1, requestedDeviceConcurrency: 2,
      excludedSuccessful: catalog.filter((entry) => successful.has(entry.task)).map((entry) => ({ ...entry, evidence: successful.get(entry.task) })),
      pendingCount: pending.length,
      workers: [0, 1].map((id) => ({ id, serial: `emulator-${5554 + id * 2}`, consolePort: 5554 + id * 2,
        grpcPort: 8554 + id, systemPort: 8200 + id, output: resolve(root, `worker-${id}`),
        setup: id === 0 ? resolve(".cache/android-world/setup") : resolve(root, "setup-worker-1"),
        cases: pending.filter((_, index) => index % 2 === id) })),
    };
    await writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`);
    console.log(JSON.stringify({ planPath, catalogCount: catalog.length, excluded: plan.excludedSuccessful.length, pending: pending.length }));
  }
} else if (phase === "run") {
  const plan = JSON.parse(await readFile(planPath, "utf8"));
  const worker = plan.workers.find((worker: { id: number }) => worker.id === Number(option("--worker", "-1")));
  if (!worker) throw new Error("Select --worker 0 or --worker 1");
  requireAndroidWorldModelProfile(plan.modelProfile);
  const setup = JSON.parse(await readFile(resolve(worker.setup, "suite-setup.json"), "utf8"));
  if (setup.ready !== 24 || setup.failed !== 0 || setup.pending !== 0) throw new Error("Worker setup is not 24 ready / 0 failed / 0 pending");
  await mkdir(worker.output, { recursive: true });
  const results = [];
  for (const entry of worker.cases) {
    const disk = await statfs(root);
    if (disk.bavail * disk.bsize < 2 * 1024 ** 3) throw new Error("Stopped before next case: less than 2 GiB disk headroom");
    const sample = samplePath(worker.output, entry);
    const statusPath = resolve(sample, "original-attempt.json");
    try { await readFile(statusPath); continue; } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    await mkdir(sample, { recursive: true });
    if (entry.retryEvidence) {
      // Reuse exact persisted parameters, not just the random seed. Never
      // carry validator lifecycle state: the official initializer reruns.
      await mkdir(resolve(sample, "task-state"), { recursive: true });
      for (const name of ["params.pickle", "task.json"]) {
        const source = resolve(dirname(entry.retryEvidence), "task-state", name);
        const destination = resolve(sample, "task-state", name);
        try { await copyFile(source, destination, constants.COPYFILE_EXCL); }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
          if (!(await readFile(source)).equals(await readFile(destination))) {
            throw new Error(`Retry parameters differ from original: ${destination}`);
          }
        }
      }
    }
    const started = new Date().toISOString();
    const log = createWriteStream(resolve(sample, "original-attempt.log"));
    const code = await new Promise<number | null>((done, reject) => {
      const child = spawn(resolve("node_modules/.bin/tsx"), ["benchmark/android/android-world/benchmark.ts", "--mode", "original", "--task", entry.task,
        "--seed", String(entry.id * 10_000 + 1), "--output", sample, "--model-profile", plan.modelProfile], {
        env: { ...process.env, ACTONCE_ANDROID_SERIAL: worker.serial, ACTONCE_EMULATOR_PORT: String(worker.consolePort),
          ACTONCE_EMULATOR_GRPC_PORT: String(worker.grpcPort), ACTONCE_ANDROID_SYSTEM_PORT: String(worker.systemPort) },
        stdio: ["ignore", "pipe", "pipe"],
      });
      child.stdout.on("data", (data) => { log.write(data); process.stdout.write(data); });
      child.stderr.on("data", (data) => { log.write(data); process.stderr.write(data); });
      child.once("error", reject); child.once("exit", done);
    });
    await new Promise<void>((done) => log.end(done));
    let result = null;
    try { result = JSON.parse(await readFile(resolve(sample, "original/result.json"), "utf8")); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    const attempt = { task: entry.task, started, completed: new Date().toISOString(), exitCode: code,
      status: result?.status ?? "setup-failed", officialReward: result?.officialValidator?.reward ?? null,
      resultPath: result ? resolve(sample, "original/result.json") : null };
    await writeFile(statusPath, `${JSON.stringify(attempt, null, 2)}\n`);
    results.push(attempt);
    await writeFile(resolve(worker.output, "worker-progress.json"), `${JSON.stringify({ worker, attemptsThisRun: results }, null, 2)}\n`);
    console.log(JSON.stringify(attempt));
  }
} else throw new Error(`Unknown phase: ${phase}`);

function samplePath(output: string, entry: { id: number; task: string }) {
  return resolve(output, "cases", `${String(entry.id).padStart(3, "0")}-${entry.task.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase()}`, "sample-1");
}
