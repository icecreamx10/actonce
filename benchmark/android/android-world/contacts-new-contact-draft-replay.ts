// Compiled from the official-PASS ContactsNewContactDraft recording generated
// with seed 20260818012. Deterministic, state-gated, and AI fallback disabled.
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
    id: "open-contact-editor",
    precondition: { id: "contacts", expected: { source: { includes: ["com.google.android.contacts"] } } },
    deterministic: async () => {
      const permission = await findCurrentNode((node) =>
        node["resource-id"] === "com.android.permissioncontroller:id/permission_allow_button"
          || node["resource-id"] === "com.android.permissioncontroller:id/permission_deny_button",
      );
      if (permission) await tapNode(permission);
      await tapNode(await waitForNode((node) =>
        node["resource-id"] === "com.google.android.contacts:id/floating_action_button"
          || String(node["content-desc"] ?? "").toLowerCase().includes("create new contact"),
        8_000,
      ));
    },
    postcondition: {
      id: "contact-editor",
      expected: { source: { includes: ["First name", "Phone", "Save"] } },
      settle: { timeoutMs: 8_000, intervalMs: 100 },
    },
  });

  await flow.segment({
    id: "fill-contact-draft",
    precondition: { id: "contact-editor", expected: { source: { includes: ["First name", "Phone", "Save"] } } },
    deterministic: async () => {
      await fillField("First name", "David");
      await fillField("Last name", "Brown");
      await fillField("Phone", "246-380-2217");
      // Anchor the first phone row by its semantic content description. Plain
      // label text is duplicated by hidden and newly added empty phone rows.
      await tapNode(await waitForNode((node) =>
        node["content-desc"] === "Mobile Phone" && isDisplayed(node),
      ));
      // Android's Spinner popup is visible on screen but omitted from the
      // uiautomator tree. This is the normalized Work point from the passing
      // recording, applied only after the observable Mobile spinner is open.
      await tapPoint(78, 180);
    },
    postcondition: {
      id: "draft-complete",
      expected: {
        source: { includes: ["David", "Brown", "246-380-2217", "Work Phone", "Save"] },
      },
      settle: { timeoutMs: 12_000, intervalMs: 100 },
    },
  });
  await android.screenshot(resolve(outputDir, "final.png"));
  await writeResult({ status, executionDurationMs: elapsed(), replayDiagnostics: flow.diagnostics(), events });
} catch (caught) {
  status = "failed";
  error = caught instanceof Error ? { name: caught.name, message: caught.message } : { name: "Error", message: String(caught) };
  await writeResult({ status, executionDurationMs: elapsed(), error, events });
} finally {
  await android.close();
}
console.log(JSON.stringify({ status, executionDurationMs: elapsed(), outputDir, error }, null, 2));
if (status === "failed") process.exitCode = 2;

async function fillField(label: string, value: string) {
  await tapNode(await waitForNode((node) =>
    node.text === label || node["content-desc"] === label || node["hint-text"] === label,
  ));
  await replayAndroidPrimitive(android, { operation: "typeText", arguments: [value] });
}

async function tapNode(node: Record<string, unknown>) {
  const bounds = parseBounds(node.bounds);
  await replayAndroidPrimitive(android, {
    operation: "tap",
    arguments: [{
      x: (bounds.left + bounds.right) / 2 / android.device.pixelRatio(),
      y: (bounds.top + bounds.bottom) / 2 / android.device.pixelRatio(),
    }],
  });
}
async function tapPoint(x: number, y: number) {
  await replayAndroidPrimitive(android, { operation: "tap", arguments: [{ x, y }] });
}

async function findCurrentNode(predicate: (node: Record<string, unknown>) => boolean) {
  android.invalidateObservation();
  return findNode(JSON.parse(await android.source()), predicate);
}

async function waitForNode(predicate: (node: Record<string, unknown>) => boolean, timeoutMs = 4_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const node = await findCurrentNode(predicate);
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
function isDisplayed(node: Record<string, unknown>) {
  return node.displayed === true || node.displayed === "true";
}
function elapsed() { return Number(process.hrtime.bigint() - started) / 1_000_000; }
async function writeResult(value: unknown) {
  await writeFile(resolve(outputDir, "result.json"), `${JSON.stringify({
    schemaVersion: 1,
    benchmark: "android-world-contacts-new-contact-draft",
    mode: "replay",
    ...value as object,
  }, null, 2)}\n`);
}
