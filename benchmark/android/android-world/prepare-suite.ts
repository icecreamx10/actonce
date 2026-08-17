import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const args = parseArgs(process.argv.slice(2));
const outputDir = resolve(args.output);
const statePath = resolve(outputDir, "suite-setup.json");
const python = resolve(".cache/android-world/venv/bin/python");
const taskCli = resolve("benchmark/android/android-world/task.py");
await mkdir(outputDir, { recursive: true });

const listed = await capture([taskCli, "list-apps"]);
const allApps = (JSON.parse(lastLine(listed.stdout)) as { apps: string[] }).apps;
const apps = args.app ? allApps.filter((app) => app === args.app) : allApps;
if (args.app && apps.length !== 1) throw new Error(`Unknown AndroidWorld app: ${args.app}`);
const previous = await json(statePath);
const results = new Map<string, AppResult>(
  Array.isArray(previous?.apps)
    ? (previous.apps as AppResult[]).map((result) => [result.app, result])
    : [],
);

for (const app of apps) {
  if (!args.force && results.get(app)?.status === "ready") continue;
  const started = Date.now();
  const code = await inherit([taskCli, "prepare-app", "--app", app]);
  results.set(app, {
    app,
    status: code === 0 ? "ready" : "failed",
    durationMs: Date.now() - started,
    exitCode: code,
  });
  await persist();
}

await persist();
const failed = [...results.values()].filter((result) => result.status === "failed");
if (failed.length) process.exitCode = 2;

interface AppResult {
  app: string;
  status: "ready" | "failed";
  durationMs: number;
  exitCode: number | null;
}

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
  console.log(JSON.stringify({ ...value, statePath }, null, 2));
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
