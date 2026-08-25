// Compiled from recording `original` (android-world SystemBluetoothTurnOff),
// checkpoint sequence 0-7. Deterministic, checkpoint-gated, no fallback.
// Oracle evidence: the recorded final `android:id/switch_widget` node for
// "Use Bluetooth" transitions checked "true" -> "false" at after-action
// checkpoint 8 (bounds [839,675][985,801]), i.e. Bluetooth is turned off.
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
    id: "open-connected-devices",
    // The AndroidWorld harness force-stops and relaunches the Settings app
    // before timing, so replay begins on the Settings homepage, not Home.
    precondition: { id: "settings-home", expected: { source: { includes: ["Settings"] } } },
    deterministic: async () => {
      await primitive("launchApp", "com.android.settings");
      await waitForSource("Settings");
      // "Connected devices" is visible on the Settings homepage without
      // scrolling (recorded before-action checkpoint 1).
      await tapSourceText("Connected devices");
    },
    postcondition: {
      id: "connected-devices",
      expected: { source: { includes: ["Connection preferences"] } },
      settle: { timeoutMs: 4_000, intervalMs: 100 },
    },
  });

  await flow.segment({
    id: "open-connection-preferences",
    precondition: { id: "connected-devices", expected: { source: { includes: ["Connection preferences"] } } },
    deterministic: async () => {
      await tapSourceText("Connection preferences");
    },
    postcondition: {
      id: "connection-preferences",
      // The Connection preferences screen exposes a standalone "Bluetooth" row
      // (recorded after-action checkpoint 4).
      expected: { source: { includes: ['"text":"Bluetooth"'] } },
      settle: { timeoutMs: 4_000, intervalMs: 100 },
    },
  });

  await flow.segment({
    id: "open-bluetooth",
    precondition: { id: "connection-preferences", expected: { source: { includes: ['"text":"Bluetooth"'] } } },
    deterministic: async () => {
      await tapSourceText("Bluetooth");
    },
    postcondition: {
      id: "bluetooth-detail",
      expected: { source: { includes: ["Use Bluetooth"] } },
      settle: { timeoutMs: 4_000, intervalMs: 100 },
    },
  });

  await flow.segment({
    id: "turn-off-bluetooth",
    precondition: {
      id: "bluetooth-on",
      // Guard that Bluetooth is currently on before toggling it off.
      expected: { source: { includes: ["Use Bluetooth", '"checked":"true"'] } },
    },
    deterministic: async () => {
      // Locate the "Use Bluetooth" toggle by its stable resource-id while it is
      // still checked, tap it, then confirm the switch flips to off.
      const toggle = await waitForNode(
        (node) => node["resource-id"] === "android:id/switch_widget" && node.checked === "true",
      );
      const bounds = parseBounds(toggle.bounds);
      await primitive("tap", logical({
        x: (bounds.left + bounds.right) / 2,
        y: (bounds.top + bounds.bottom) / 2,
      }));
      await waitForNode(
        (node) => node["resource-id"] === "android:id/switch_widget" && node.checked === "false",
        8_000,
      );
    },
    postcondition: {
      id: "bluetooth-off",
      expected: { source: { includes: ["Use Bluetooth", '"checked":"false"'] }, captureScreenshot: true },
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
    benchmark: "android-world-system-bluetooth-turn-off",
    mode: "replay",
    ...value as object,
  }, null, 2)}\n`);
}
