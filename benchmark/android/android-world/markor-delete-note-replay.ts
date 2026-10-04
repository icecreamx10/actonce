// Compiled from the official-PASS MarkorDeleteNote recording generated with
// seed 20260818032. Deterministic, state-gated, and AI fallback disabled.
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { AndroidSession, createAndroidReplayFlow, replayAndroidPrimitive } from "../../../runtime/android/src/index.js";

const outputDir = resolve(process.env.ACTONCE_BENCHMARK_OUTPUT_DIR ?? ".cache/android-world/replay");
const started = process.hrtime.bigint();
const events: unknown[] = [];
await mkdir(outputDir, { recursive: true });
const android = await AndroidSession.connect();
let status: "passed" | "failed" = "passed";
let error: { name: string; message: string } | undefined;
try {
  const flow = createAndroidReplayFlow(android, { policy: "disabled", emit: (event) => { events.push(event); } });
  await flow.segment({
    id: "select-target-note",
    precondition: {
      id: "target-visible",
      expected: { source: { includes: ["File dHv9_good_unicorn", "net.gsantner.markor:id/fab_add_new_item"] } },
    },
    deterministic: async () => {
      await longPressNode(await waitForNode((node) => node["content-desc"] === "File dHv9_good_unicorn"));
    },
    postcondition: {
      id: "target-selected",
      expected: { source: { includes: ["Selected dHv9_good_unicorn", "net.gsantner.markor:id/action_delete_selected_items"] } },
      settle: { timeoutMs: 8_000, intervalMs: 100 },
    },
  });
  await flow.segment({
    id: "delete-target-note",
    precondition: {
      id: "target-selected",
      expected: { source: { includes: ["Selected dHv9_good_unicorn", "net.gsantner.markor:id/action_delete_selected_items"] } },
    },
    deterministic: async () => {
      await tapNode(await waitForNode((node) =>
        node["resource-id"] === "net.gsantner.markor:id/action_delete_selected_items",
      ));
      await tapNode(await waitForNode((node) => node.text === "OK", 8_000));
    },
    postcondition: {
      id: "target-deleted",
      expected: { source: { excludes: ["File dHv9_good_unicorn", "Confirm Delete"] }, captureScreenshot: true },
      settle: { timeoutMs: 10_000, intervalMs: 100 },
    },
  });
  await android.screenshot(resolve(outputDir, "final.png"));
  await writeResult({ status, executionDurationMs: elapsed(), replayDiagnostics: flow.diagnostics(), events });
} catch (caught) {
  status = "failed";
  error = caught instanceof Error ? { name: caught.name, message: caught.message } : { name: "Error", message: String(caught) };
  await writeResult({ status, executionDurationMs: elapsed(), error, events });
} finally { await android.close(); }
console.log(JSON.stringify({ status, executionDurationMs: elapsed(), outputDir, error }, null, 2));
if (status === "failed") process.exitCode = 2;

async function tapNode(node: Record<string, unknown>) {
  const point = center(node.bounds);
  await replayAndroidPrimitive(android, { operation: "tap", arguments: [point] });
}
async function longPressNode(node: Record<string, unknown>) {
  const point = center(node.bounds);
  await replayAndroidPrimitive(android, { operation: "longPress", arguments: [point, 2_000] });
}
function center(boundsValue: unknown) {
  const bounds = parseBounds(boundsValue);
  return {
    x: (bounds.left + bounds.right) / 2 / android.device.pixelRatio(),
    y: (bounds.top + bounds.bottom) / 2 / android.device.pixelRatio(),
  };
}
async function findCurrentNode(predicate: (node: Record<string, unknown>) => boolean) {
  android.invalidateObservation();
  return findNode(JSON.parse(await android.source()), predicate);
}
async function waitForNode(predicate: (node: Record<string, unknown>) => boolean, timeoutMs = 4_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { const node = await findCurrentNode(predicate); if (node) return node; await new Promise((r) => setTimeout(r, 100)); }
  throw new Error("Timed out locating Android accessibility node");
}
function findNode(value: unknown, predicate: (node: Record<string, unknown>) => boolean): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const node = value as Record<string, unknown>;
  if (predicate(node)) return node;
  for (const child of Object.values(node)) { const match = findNode(child, predicate); if (match) return match; }
  return undefined;
}
function parseBounds(value: unknown) {
  if (typeof value !== "string") throw new Error("Accessibility node is missing bounds");
  const n = [...value.matchAll(/\d+/g)].map((match) => Number(match[0]));
  if (n.length !== 4) throw new Error(`Invalid Android bounds: ${value}`);
  return { left: n[0], top: n[1], right: n[2], bottom: n[3] };
}
function elapsed() { return Number(process.hrtime.bigint() - started) / 1_000_000; }
async function writeResult(value: unknown) {
  await writeFile(resolve(outputDir, "result.json"), `${JSON.stringify({
    schemaVersion: 1, benchmark: "android-world-markor-delete-note", mode: "replay", ...value as object,
  }, null, 2)}\n`);
}
