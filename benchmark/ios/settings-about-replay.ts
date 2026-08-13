import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  IOSSession,
  createIOSReplayFlow,
  replayIOSPrimitive,
} from "../../runtime/ios/src/index.js";

const SETTINGS = "com.apple.Preferences";
const outputDir = resolve(process.env.ACTONCE_BENCHMARK_OUTPUT_DIR ?? ".cache/ios-runtime/settings-about-replay");
await mkdir(outputDir, { recursive: true });
const startedAt = new Date().toISOString();
const started = process.hrtime.bigint();
const events: unknown[] = [];
let status: "passed" | "failed" = "passed";
let error: { name: string; message: string } | undefined;
let ios: IOSSession | undefined;

try {
  ios = await IOSSession.connect({
    wdaHost: process.env.ACTONCE_WDA_HOST ?? "127.0.0.1",
    wdaPort: Number(process.env.ACTONCE_WDA_PORT ?? "8100"),
  });
  const flow = createIOSReplayFlow(ios, {
    policy: "disabled",
    emit: (event) => { events.push(event); },
  });

  await resetToSettingsRoot(ios);
  await flow.segment({
    id: "open-general",
    precondition: {
      id: "settings-root",
      expected: { source: { includes: ["com.apple.settings.general", "通用"] } },
    },
    deterministic: () => replayIOSPrimitive(ios!, {
      operation: "tap",
      // Normalized logical-device point from completed recording sequence 98.
      arguments: [{ x: 218, y: 328 }],
    }),
    postcondition: {
      id: "general-visible",
      expected: { source: { includes: ["About", "关于本机"] } },
      settle: { timeoutMs: 2_500, intervalMs: 100 },
    },
  });

  await flow.segment({
    id: "open-about",
    precondition: {
      id: "general-ready",
      expected: { source: { includes: ["About", "关于本机"] } },
    },
    deterministic: () => replayIOSPrimitive(ios!, {
      operation: "tap",
      // Normalized logical-device point from completed recording sequence 163.
      arguments: [{ x: 218, y: 404 }],
    }),
    postcondition: {
      id: "about-visible",
      expected: {
        source: {
          includes: ["关于本机", "SW_VERSION_SPECIFIER", "ProductModelName", "iPhone 17 Pro"],
        },
        captureScreenshot: true,
      },
      settle: { timeoutMs: 2_500, intervalMs: 100 },
    },
  });

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
    assertions: {
      settingsRoot: true,
      generalVisible: true,
      aboutVisible: true,
      deviceInformationVisible: true,
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
    events,
  }, null, 2)}\n`);
} finally {
  await ios?.close();
}

console.log(JSON.stringify({ status, outputDir, executionDurationMs: elapsed(started), error }, null, 2));
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
