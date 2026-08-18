// Compiled from the official-PASS CameraTakeVideo recording generated with
// seed 20260818007. Deterministic, state-gated, and AI fallback disabled.
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
  const primitive = (operation: Parameters<typeof replayAndroidPrimitive>[1]["operation"], ...args: unknown[]) =>
    replayAndroidPrimitive(android, { operation, arguments: args });

  await flow.segment({
    id: "select-video-mode",
    precondition: {
      id: "camera-foreground",
      expected: { source: { includes: ["com.android.camera2:id/shutter_button"] } },
    },
    deterministic: async () => {
      // The passing recording opened Camera's mode selector by dragging the
      // shutter to the right. This gesture is stable from either Camera or
      // Video mode and exposes accessibility text for both choices.
      await primitive(
        "dragAndDrop",
        logical({ x: 536, y: 2189 }),
        logical({ x: 971, y: 2189 }),
      );
      const video = await waitForNode((node) =>
        node.text === "Video" || node["content-desc"] === "Switch to Video Camera",
      );
      await tapNode(video);
      await waitForNode(
        (node) => node["resource-id"] === "com.android.camera2:id/shutter_button",
        8_000,
      );
    },
    postcondition: {
      id: "video-ready",
      expected: { source: { includes: ["com.android.camera2:id/shutter_button"] } },
      settle: { timeoutMs: 8_000, intervalMs: 100 },
    },
  });

  await flow.segment({
    id: "record-video",
    precondition: {
      id: "video-ready",
      expected: { source: { includes: ["com.android.camera2:id/shutter_button"] } },
    },
    deterministic: async () => {
      await tapNode(await waitForNode(
        (node) => node["resource-id"] === "com.android.camera2:id/shutter_button",
      ));
      await waitForNode(
        (node) => node["resource-id"] === "com.android.camera2:id/recording_time",
        8_000,
      );
      // Preserve the recorded semantics while keeping the benchmark bounded:
      // AndroidWorld only requires exactly one newly saved video.
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 2_000));
      await tapNode(await waitForNode(
        (node) => node["resource-id"] === "com.android.camera2:id/shutter_button",
      ));
    },
    postcondition: {
      id: "video-saved",
      expected: {
        // Camera keeps the empty recording_time container mounted after stop.
        // The newly visible thumbnail is the recorded after-action state and
        // proves that media was saved; the official oracle checks the file.
        source: { includes: ["com.android.camera2:id/rounded_thumbnail_view"] },
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

async function tapNode(node: Record<string, unknown>) {
  const bounds = parseBounds(node.bounds);
  await replayAndroidPrimitive(android, {
    operation: "tap",
    arguments: [logical({
      x: (bounds.left + bounds.right) / 2,
      y: (bounds.top + bounds.bottom) / 2,
    })],
  });
}

async function waitForNode(predicate: (node: Record<string, unknown>) => boolean, timeoutMs = 4_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    android.invalidateObservation();
    const node = findNode(JSON.parse(await android.source()), predicate);
    if (node) return node;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error("Timed out locating Android accessibility node");
}

function findNode(value: unknown, predicate: (node: Record<string, unknown>) => boolean): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const node = value as Record<string, unknown>;
  if (predicate(node)) return node;
  for (const child of Object.values(node)) {
    const match = findNode(child, predicate);
    if (match) return match;
  }
  return undefined;
}

function parseBounds(value: unknown) {
  if (typeof value !== "string") throw new Error("Accessibility node is missing bounds");
  const numbers = [...value.matchAll(/\d+/g)].map((match) => Number(match[0]));
  if (numbers.length !== 4) throw new Error(`Invalid Android bounds: ${value}`);
  return { left: numbers[0], top: numbers[1], right: numbers[2], bottom: numbers[3] };
}

function logical(point: { x: number; y: number }) {
  return { x: point.x / android.device.pixelRatio(), y: point.y / android.device.pixelRatio() };
}

function elapsed() {
  return Number(process.hrtime.bigint() - started) / 1_000_000;
}

async function writeResult(value: unknown) {
  await writeFile(resolve(outputDir, "result.json"), `${JSON.stringify({
    schemaVersion: 1,
    benchmark: "android-world-camera-take-video",
    mode: "replay",
    ...value as object,
  }, null, 2)}\n`);
}
