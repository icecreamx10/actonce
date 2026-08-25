// Compiled from recording `original` (android-world SystemBrightnessMin),
// sequence range 0-118. Deterministic, checkpoint-gated, no fallback.
// Oracle evidence: the recorded final `com.android.systemui:id/slider` node
// reads "text":"0.0" (minimum) at after-action checkpoint seq 105.
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
    id: "open-display-settings",
    // The AndroidWorld harness force-stops and relaunches the Settings app
    // before timing, so replay begins on the Settings homepage, not Home.
    precondition: { id: "settings-home", expected: { source: { includes: ["Settings"] } } },
    deterministic: async () => {
      await primitive("launchApp", "com.android.settings");
      await waitForSource("Settings");
      await primitive("swipe", { x: 205, y: 780 }, { x: 205, y: 550 }, { durationMs: 300 });
      await waitForSource("Display");
      await tapSourceText("Display");
    },
    postcondition: {
      id: "display",
      expected: { source: { includes: ["Brightness", "Brightness level"] } },
      settle: { timeoutMs: 4_000, intervalMs: 100 },
    },
  });

  await flow.segment({
    id: "set-minimum",
    // SystemBrightnessMin starts at maximum; the Display screen exposes the
    // Brightness level entry. We only require being on that screen.
    precondition: { id: "display-brightness", expected: { source: { includes: ["Brightness level"] } } },
    deterministic: async () => {
      await tapSourceText("Brightness level");
      const slider = await waitForNode(
        (node) => node["resource-id"] === "com.android.systemui:id/slider",
        10_000,
      );
      const bounds = parseBounds(slider.bounds);
      // Swipe the handle to the far left to reach minimum brightness. Push past
      // the left edge so the value clamps to 0, mirroring the recorded pair of
      // decreasing swipes that ended at the absolute minimum.
      await primitive(
        "swipe",
        logical({ x: bounds.right - 20, y: (bounds.top + bounds.bottom) / 2 }),
        logical({ x: bounds.left - 35, y: (bounds.top + bounds.bottom) / 2 }),
        { durationMs: 300 },
      );
    },
    postcondition: {
      id: "slider-min",
      expected: { source: { includes: ['"text":"0.0"'] }, captureScreenshot: true },
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

async function tapSourceText(text: string) {
  const node = await waitForNode((candidate) => candidate.text === text);
  const bounds = parseBounds(node.bounds);
  await replayAndroidPrimitive(android, {
    operation: "tap",
    arguments: [logical({ x: (bounds.left + bounds.right) / 2, y: (bounds.top + bounds.bottom) / 2 })],
  });
}

async function waitForSource(expected: string) {
  await waitForNode((node) => node.text === expected || node["content-desc"] === expected);
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
  const densityScale = 420 / 160;
  return { x: point.x / densityScale, y: point.y / densityScale };
}

function elapsed() {
  return Number(process.hrtime.bigint() - started) / 1_000_000;
}

async function writeResult(value: unknown) {
  await writeFile(resolve(outputDir, "result.json"), `${JSON.stringify({
    schemaVersion: 1,
    benchmark: "android-world-system-brightness-min",
    mode: "replay",
    ...value as object,
  }, null, 2)}\n`);
}
