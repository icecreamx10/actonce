import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { type AppResult, fixtureRevision, invalidateStaleReady } from "./setup-state.js";

const args = parseArgs(process.argv.slice(2));
const outputDir = resolve(args.output);
const statePath = resolve(outputDir, "suite-setup.json");
const python = resolve(".cache/android-world/venv/bin/python");
const taskCli = resolve("benchmark/android/android-world/task.py");
await mkdir(outputDir, { recursive: true });

const listed = await capture([taskCli, "list-apps"]);
const listing = JSON.parse(lastLine(listed.stdout)) as { apps: string[]; packages: Record<string, string> };
const allApps = listing.apps;
await capture([taskCli, "migrate-fixtures"]);
const inspected = await capture([taskCli, "inspect-fixtures"]);
const snapshots = new Set<string>((JSON.parse(lastLine(inspected.stdout)) as { snapshots: string[] }).snapshots);
const apps = args.app ? allApps.filter((app) => app === args.app) : allApps;
if (args.app && apps.length !== 1) throw new Error(`Unknown AndroidWorld app: ${args.app}`);
const previous = await json(statePath);
const results = new Map<string, AppResult>(
  Array.isArray(previous?.apps)
    ? (previous.apps as AppResult[]).map((result) => [result.app, result])
    : [],
);
// A host manifest can outlive the emulator's data image. Invalidate all stale
// ready entries before reporting counts, even when preparing only one app.
invalidateStaleReady(results, listing.packages, snapshots);
await persist();

for (const app of apps) {
  const revision = fixtureRevision(app);
  if (!args.force && results.get(app)?.status === "ready"
      && (results.get(app)?.fixtureRevision ?? 0) === revision
      && snapshots.has(listing.packages[app])) continue;
  const started = Date.now();
  const code = await inherit([taskCli, "prepare-app", "--app", app]);
  results.set(app, {
    app,
    status: code === 0 ? "ready" : "failed",
    durationMs: Date.now() - started,
    exitCode: code,
    fixtureRevision: revision,
  });
  await persist();
}

await persist();
const failed = [...results.values()].filter((result) => result.status === "failed");
if (failed.length) process.exitCode = 2;

async function persist() {
  const ordered = allApps.map((app) => results.get(app) ?? { app, status: "pending" });
  const value = {
    schemaVersion: 1,
    status: ordered.every((result) => result.status === "ready") ? "ready" : "incomplete",
    ready: ordered.filter((result) => result.status === "ready").length,
    failed: ordered.filter((result) => result.status === "failed").length,
    pending: ordered.filter((result) => result.status === "pending").length,
    apps: ordered,
  };
  await writeFile(statePath, `${JSON.stringify(value, null, 2)}\n`);
  console.log(JSON.stringify({ status: value.status, ready: value.ready,
    failed: value.failed, pending: value.pending, statePath }));
}

function inherit(childArgs: string[]) {
  return new Promise<number | null>((resolveRun, reject) => {
    const child = spawn(python, childArgs, { cwd: process.cwd(), env: { ...process.env, GRPC_VERBOSITY: "ERROR" }, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", resolveRun);
  });
}

function capture(childArgs: string[]) {
  return new Promise<{ stdout: string; stderr: string }>((resolveRun, reject) => {
    const child = spawn(python, childArgs, { cwd: process.cwd(), env: { ...process.env, GRPC_VERBOSITY: "ERROR" }, stdio: ["ignore", "pipe", "pipe"] });
    const stdout: Buffer[] = [], stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.once("error", reject);
    child.once("exit", (code) => code === 0
      ? resolveRun({ stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString() })
      : reject(new Error(Buffer.concat(stderr).toString())));
  });
}

function parseArgs(values: string[]) {
  let output = ".cache/android-world/setup", app: string | undefined, force = false;
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] === "--output") output = values[++index];
    else if (values[index] === "--app") app = values[++index];
    else if (values[index] === "--force") force = true;
    else throw new Error(`Unknown argument: ${values[index]}`);
  }
  return { output, app, force };
}

async function json(path: string): Promise<Record<string, unknown> | null> {
  try { return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}
function lastLine(value: string) { return value.trim().split("\n").at(-1) ?? ""; }
