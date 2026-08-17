import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { runReplayPlan } from "@byted-lynx/actonce-replay";
import {
  IOSSession,
  createIOSReplayFlow,
  loadIOSPlan,
  replayIOSPrimitive,
} from "../../runtime/ios/src/index.js";
import type { RecordedIOSPrimitive } from "../../runtime/ios/src/index.js";

const SETTINGS = "com.apple.Preferences";
const planPath = resolve(process.env.ACTONCE_PLAN ?? resolve(import.meta.dirname, "settings-about.plan.json"));
const outputDir = resolve(process.env.ACTONCE_BENCHMARK_OUTPUT_DIR ?? ".cache/ios-runtime/settings-about-replay");
await mkdir(outputDir, { recursive: true });
const startedAt = new Date().toISOString();
const started = process.hrtime.bigint();
const events: unknown[] = [];
let status: "passed" | "failed" = "passed";
let error: { name: string; message: string } | undefined;
let failedCheckpoint: unknown;
let ios: IOSSession | undefined;

try {
  // Compile is a separate stage; here we only load the compiled product.
  const plan = await loadIOSPlan(planPath);
  ios = await IOSSession.connect({
    wdaHost: process.env.ACTONCE_WDA_HOST ?? "127.0.0.1",
    wdaPort: Number(process.env.ACTONCE_WDA_PORT ?? "8100"),
  });
  const flow = createIOSReplayFlow(ios, {
    policy: "disabled",
    emit: (event) => { events.push(event); },
  });

  await resetToSettingsRoot(ios);
  const result = await runReplayPlan(flow, plan, (action) => replayIOSPrimitive(ios!, action as RecordedIOSPrimitive));
  if (result.status === "failed") {
    status = "failed";
    failedCheckpoint = result.failedCheckpoint;
  }

  await ios.screenshot(resolve(outputDir, "about.png"));
  await resetToSettingsRoot(ios);
  const restoredSource = await ios.source();
  if (!restoredSource.includes("com.apple.settings.general")) {
    throw new Error("Settings cleanup did not restore the root page");
  }

  await writeFile(resolve(outputDir, "result.json"), `${JSON.stringify({
    schemaVersion: 1,
    benchmark: "ios-settings-about",
    mode: "replay",
    status,
    startedAt,
    completedAt: new Date().toISOString(),
    executionDurationMs: elapsed(started),
    replayDiagnostics: flow.diagnostics(),
    result,
    assertions: {
      settingsRoot: true,
      generalVisible: status === "passed",
      aboutVisible: status === "passed",
      deviceInformationVisible: status === "passed",
      restored: true,
    },
    events,
    artifacts: { screenshot: "about.png" },
  }, null, 2)}\n`);
} catch (caught) {
  status = "failed";
  error = serialize(caught);
  await writeFile(resolve(outputDir, "result.json"), `${JSON.stringify({
    schemaVersion: 1,
    benchmark: "ios-settings-about",
    mode: "replay",
    status,
    startedAt,
    completedAt: new Date().toISOString(),
    executionDurationMs: elapsed(started),
    error,
    failedCheckpoint,
    events,
  }, null, 2)}\n`);
} finally {
  await ios?.close();
}

console.log(JSON.stringify({ status, outputDir, executionDurationMs: elapsed(started), failedCheckpoint, error }, null, 2));
if (status === "failed") process.exitCode = 2;

async function resetToSettingsRoot(session: IOSSession): Promise<void> {
  await session.terminate(SETTINGS).catch(() => undefined);
  await session.launch(SETTINGS);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const source = await session.source();
    if (source.includes("com.apple.settings.general")) return;
    if (!source.includes('name="BackButton"')) break;
    await replayIOSPrimitive(session, { operation: "tap", arguments: [{ x: 25, y: 59 }] });
  }
  const source = await session.source();
  if (!source.includes("com.apple.settings.general")) {
    throw new Error("Could not normalize Settings to its root page");
  }
}

function elapsed(value: bigint): number {
  return Number(process.hrtime.bigint() - value) / 1_000_000;
}
function serialize(value: unknown): { name: string; message: string } {
  return value instanceof Error ? { name: value.name, message: value.message } : { name: "Error", message: String(value) };
}
