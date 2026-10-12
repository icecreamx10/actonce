import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { AndroidSession, createAndroidReplayFlow, type AndroidReplayModule, type AndroidSessionOptions } from "@byted-lynx/actonce-android";

export function originalTimingBoundary(result: Record<string, unknown> | null, manifest: Record<string, unknown> | null) {
  if (result?.timingBoundary && typeof result.timingBoundary === "object") return result.timingBoundary;
  if (manifest?.status !== "complete" || manifest.integrity !== "complete") return null;
  if (typeof manifest?.startedAt !== "string" || typeof manifest.completedAt !== "string") return null;
  const duration = Date.parse(manifest.completedAt) - Date.parse(manifest.startedAt);
  if (!Number.isFinite(duration) || duration <= 0 || duration !== result?.executionDurationMs) return null;
  return { scope: "recording-session", managedBy: "recorder-manifest", includesRecorderOverhead: true, provenance: { kind: "legacy-manifest-exact-duration-inference", manifest: "original/manifest.json", startedAt: manifest.startedAt, completedAt: manifest.completedAt } };
}

type Evidence = { screenshot?: Buffer; source?: string };

export const DEVICE_SESSION_TIMING_BOUNDARY = {
  scope: "device-session", clock: "monotonic", managedBy: "benchmark-replay-module-runner",
  start: "before AndroidSession.connect", end: "after AndroidSession.close",
  includes: ["native session setup", "authored execution", "final screenshot and native source capture", "native session teardown"],
  excludes: ["module loading", "all artifact writes"],
} as const;

export function validateReplaySelection(replayModule?: string, replayEntry?: string) {
  if (replayModule && replayEntry) throw new Error("Use only one of --replay-module and --replay-entry");
}

export function validateReplayModule(module: AndroidReplayModule, serial: string) {
  const run = module.default ?? module.run;
  if (typeof run !== "function") throw new Error("Replay module must export a default or named run function");
  const config = module.config;
  if (config !== undefined && (!config || typeof config !== "object" || Array.isArray(config))) throw new Error("Replay module config must be AndroidSessionOptions");
  const validators: Record<string, (value: unknown) => boolean> = {
    serial: v => typeof v === "string" && v.length > 0,
    androidAdbPath: v => typeof v === "string" && v.length > 0,
    displayId: v => Number.isInteger(v) && Number(v) >= 0,
    systemPort: v => Number.isInteger(v) && Number(v) > 0 && Number(v) <= 65535,
    screenshotStrategy: v => v === "auto" || v === "always-yadb",
    appNameMapping: v => !!v && typeof v === "object" && !Array.isArray(v) && Object.values(v).every(x => typeof x === "string"),
  };
  for (const [key, value] of Object.entries(config ?? {})) {
    if (!validators[key] || !validators[key](value)) throw new Error(`Invalid Android session config.${key}`);
  }
  if (!serial || (config?.serial !== undefined && config.serial !== serial)) throw new Error("Replay module serial must match the leased serial");
  return { run, config: { ...config, serial } as AndroidSessionOptions };
}

export async function runReplayModule(options: {
  modulePath: string; serial: string; outputDir: string; args?: string[];
}, dependencies: {
  load?: (path: string) => Promise<AndroidReplayModule>;
  connect?: typeof AndroidSession.connect;
  createFlow?: typeof createAndroidReplayFlow;
  now?: () => bigint;
  writeArtifacts?: (outputDir: string, result: unknown, events: unknown[], evidence: Evidence) => Promise<void>;
} = {}) {
  const scriptPath = resolve(options.modulePath);
  const module = await (dependencies.load ?? (async path => import(pathToFileURL(path).href)))(scriptPath);
  const { run, config } = validateReplayModule(module, options.serial);
  const events: unknown[] = [];
  const now = dependencies.now ?? (() => process.hrtime.bigint());
  let android: AndroidSession | undefined;
  let flow: ReturnType<typeof createAndroidReplayFlow> | undefined;
  const evidence: Evidence = {};
  const errors: Array<{ phase: string; name: string; message: string }> = [];
  const failed = (phase: string, error: unknown) => errors.push({ phase, name: error instanceof Error ? error.name : "Error", message: error instanceof Error ? error.message : String(error) });
  const started = now();
  try {
    android = await (dependencies.connect ?? AndroidSession.connect)(config);
    if (android.serial !== options.serial) throw new Error("Connected session serial does not match the leased serial");
    flow = (dependencies.createFlow ?? createAndroidReplayFlow)(android, { policy: "disabled", emit: event => { events.push(event); } });
    await run({ android, flow, args: options.args ?? [], scriptPath, scriptIndex: 0 });
  } catch (error) { failed("execution", error); }
  finally {
    if (android && android.serial === options.serial) {
      try { evidence.screenshot = Buffer.from(await android.screenshot(), "base64"); } catch (error) { failed("final-screenshot", error); }
      try { android.invalidateObservation(); evidence.source = `${JSON.stringify(JSON.parse(await android.source()), null, 2)}\n`; } catch (error) { failed("final-source", error); }
    }
    if (android) try { await android.close(); } catch (error) { failed("close", error); }
  }
  const executionDurationMs = Number(now() - started) / 1_000_000;
  let replayDiagnostics: unknown = null;
  try { replayDiagnostics = flow?.diagnostics() ?? null; } catch (error) { failed("diagnostics", error); }
  const segments = (replayDiagnostics as { segments?: Array<{ outcome: string }> } | null)?.segments ?? [];
  if (segments.some(segment => !["matched", "recovered"].includes(segment.outcome))) failed("diagnostics", new Error("Replay diagnostics contain an unresolved segment outcome"));
  const artifact = (path: string, bytes: Buffer | string | undefined) => bytes === undefined ? null : { path, sha256: createHash("sha256").update(bytes).digest("hex") };
  const result = { schemaVersion: 1, mode: "replay", status: errors.length ? "failed" : "passed", executionDurationMs, timingBoundary: DEVICE_SESSION_TIMING_BOUNDARY, replayDiagnostics, errors, artifacts: { screenshot: artifact("final.png", evidence.screenshot), source: artifact("final-source.json", evidence.source), events: "events.json" } };
  await (dependencies.writeArtifacts ?? writeArtifacts)(options.outputDir, result, events, evidence);
  return result;
}

async function writeArtifacts(outputDir: string, result: unknown, events: unknown[], evidence: Evidence) {
  await mkdir(outputDir, { recursive: true });
  if (evidence.screenshot) await writeFile(resolve(outputDir, "final.png"), evidence.screenshot);
  if (evidence.source !== undefined) await writeFile(resolve(outputDir, "final-source.json"), evidence.source);
  await writeFile(resolve(outputDir, "events.json"), `${JSON.stringify(events, null, 2)}\n`);
  await writeFile(resolve(outputDir, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
}

export function parseReplayModuleArgs(values: string[]) {
  const separator = values.indexOf("--");
  const flags = separator < 0 ? values : values.slice(0, separator);
  let modulePath: string | undefined, serial: string | undefined, outputDir: string | undefined;
  for (let index = 0; index < flags.length; index += 2) {
    const key = flags[index], value = flags[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${key} requires a value`);
    if (key === "--replay-module") modulePath = value;
    else if (key === "--serial") serial = value;
    else if (key === "--output") outputDir = value;
    else throw new Error(`Unknown argument: ${key}`);
  }
  if (!modulePath || !serial || !outputDir) throw new Error("--replay-module, --serial and --output are required");
  return { modulePath, serial, outputDir, args: separator < 0 ? [] : values.slice(separator + 1) };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const result = await runReplayModule(parseReplayModuleArgs(process.argv.slice(2)));
  console.log(JSON.stringify(result, null, 2));
  if (result.status === "failed") process.exitCode = 2;
}
