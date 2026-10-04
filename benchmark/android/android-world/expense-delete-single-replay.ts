// Compiled from the official-PASS ExpenseDeleteSingle recording generated with
// seed 20260818021. Deterministic, state-gated, and AI fallback disabled.
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { AndroidSession, createAndroidReplayFlow, replayAndroidPrimitive } from "../../../runtime/android/src/index.js";
const outputDir = resolve(process.env.ACTONCE_BENCHMARK_OUTPUT_DIR ?? ".cache/android-world/replay");
const started = process.hrtime.bigint(); const events: unknown[] = [];
await mkdir(outputDir, { recursive: true }); const android = await AndroidSession.connect();
let status: "passed" | "failed" = "passed"; let error: { name: string; message: string } | undefined;
try {
  const flow = createAndroidReplayFlow(android, { policy: "disabled", emit: (event) => { events.push(event); } });
  await flow.segment({
    id: "open-expense",
    precondition: { id: "expense-list", expected: { source: { includes: ["Dividends", "com.arduia.expense"] } } },
    deterministic: async () => { await tapNode(await waitForNode((node) => node.text === "Dividends")); },
    postcondition: { id: "expense-detail", expected: { source: { includes: ["Dividends", "Remember to transfer funds"] } }, settle: { timeoutMs: 8_000, intervalMs: 100 } },
  });
  await flow.segment({
    id: "delete-expense",
    precondition: { id: "expense-detail", expected: { source: { includes: ["Dividends", "Remember to transfer funds"] } } },
    deterministic: async () => {
      const deleteNode = await waitForNode((node) =>
        String(node["content-desc"] ?? "").toLowerCase().includes("delete")
          || String(node["resource-id"] ?? "").toLowerCase().includes("delete"),
      );
      await tapNode(deleteNode);
      await tapNode(await waitForNode((node) => node.text === "CONFIRM", 8_000));
    },
    postcondition: { id: "expense-deleted", expected: { source: { excludes: ["Dividends", "Delete Items"] }, captureScreenshot: true }, settle: { timeoutMs: 10_000, intervalMs: 100 } },
  });
  await android.screenshot(resolve(outputDir, "final.png"));
  await writeResult({ status, executionDurationMs: elapsed(), replayDiagnostics: flow.diagnostics(), events });
} catch (caught) { status = "failed"; error = caught instanceof Error ? { name: caught.name, message: caught.message } : { name: "Error", message: String(caught) }; await writeResult({ status, executionDurationMs: elapsed(), error, events }); } finally { await android.close(); }
console.log(JSON.stringify({ status, executionDurationMs: elapsed(), outputDir, error }, null, 2)); if (status === "failed") process.exitCode = 2;
async function tapNode(node: Record<string, unknown>) { const b = parseBounds(node.bounds); await replayAndroidPrimitive(android, { operation: "tap", arguments: [{ x: (b.left + b.right) / 2 / android.device.pixelRatio(), y: (b.top + b.bottom) / 2 / android.device.pixelRatio() }] }); }
async function current(predicate: (node: Record<string, unknown>) => boolean) { android.invalidateObservation(); return findNode(JSON.parse(await android.source()), predicate); }
async function waitForNode(predicate: (node: Record<string, unknown>) => boolean, timeoutMs = 4_000) { const deadline = Date.now() + timeoutMs; while (Date.now() < deadline) { const node = await current(predicate); if (node) return node; await new Promise((r) => setTimeout(r, 100)); } throw new Error("Timed out locating Android accessibility node"); }
function findNode(value: unknown, predicate: (node: Record<string, unknown>) => boolean): Record<string, unknown> | undefined { if (!value || typeof value !== "object") return; const node = value as Record<string, unknown>; if (predicate(node)) return node; for (const child of Object.values(node)) { const match = findNode(child, predicate); if (match) return match; } }
function parseBounds(value: unknown) { if (typeof value !== "string") throw new Error("Accessibility node is missing bounds"); const n = [...value.matchAll(/\d+/g)].map((m) => Number(m[0])); if (n.length !== 4) throw new Error(`Invalid Android bounds: ${value}`); return { left: n[0], top: n[1], right: n[2], bottom: n[3] }; }
function elapsed() { return Number(process.hrtime.bigint() - started) / 1_000_000; }
async function writeResult(value: unknown) { await writeFile(resolve(outputDir, "result.json"), `${JSON.stringify({ schemaVersion: 1, benchmark: "android-world-expense-delete-single", mode: "replay", ...value as object }, null, 2)}\n`); }
