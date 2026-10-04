// Compiled from the official-PASS OpenAppTaskEval recording generated with
// seed 20260818038. The sampled parameter is app_name=clock.
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  AndroidSession,
  createAndroidReplayFlow,
  replayAndroidPrimitive,
} from "../../../runtime/android/src/index.js";

const outputDir = resolve(process.env.ACTONCE_BENCHMARK_OUTPUT_DIR ?? ".cache/android-world/replay");
const started = process.hrtime.bigint();
const events: unknown[] = [];
await mkdir(outputDir, { recursive: true });
const android = await AndroidSession.connect();
let status: "passed" | "failed" = "passed";
let error: { name: string; message: string } | undefined;
try {
  const flow = createAndroidReplayFlow(android, {
    policy: "disabled",
    emit: (event) => {
      events.push(event);
    },
  });

  await flow.segment({
    id: "open-clock",
    // The harness launches the first declared app (camera) before replay. The
    // official recording started on Camera's location prompt. Requiring Camera
    // keeps the compiled action bound to the same initial app state without
    // depending on the wording of an optional first-run dialog.
    precondition: {
      id: "camera-foreground",
      expected: { source: { includes: ["com.android.camera2"] } },
    },
    deterministic: async () => {
      await replayAndroidPrimitive(android, {
        operation: "launchApp",
        arguments: ["com.google.android.deskclock"],
      });
    },
    postcondition: {
      id: "clock-foreground",
      expected: {
        source: { includes: ["com.google.android.deskclock", "Alarm", "Stopwatch"] },
        captureScreenshot: true,
      },
      settle: { timeoutMs: 8_000, intervalMs: 100 },
    },
  });

  await android.screenshot(resolve(outputDir, "final.png"));
  await writeResult({
    status,
    executionDurationMs: elapsed(),
    replayDiagnostics: flow.diagnostics(),
    events,
  });
} catch (caught) {
  status = "failed";
  error = caught instanceof Error
    ? { name: caught.name, message: caught.message }
    : { name: "Error", message: String(caught) };
  await writeResult({ status, executionDurationMs: elapsed(), error, events });
} finally {
  await android.close();
}
console.log(JSON.stringify({ status, executionDurationMs: elapsed(), outputDir, error }, null, 2));
if (status === "failed") process.exitCode = 2;

function elapsed() {
  return Number(process.hrtime.bigint() - started) / 1_000_000;
}

async function writeResult(value: unknown) {
  await writeFile(resolve(outputDir, "result.json"), `${JSON.stringify({
    schemaVersion: 1,
    benchmark: "android-world-open-app-task-eval",
    mode: "replay",
    ...value as object,
  }, null, 2)}\n`);
}
