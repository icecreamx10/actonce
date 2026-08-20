import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  IOSSession,
  createIOSReplayFlow,
  replayIOSPrimitive,
} from "../../../runtime/ios/src/index.js";
import {
  iosTapPrimitive,
  replayIOSCheckout,
} from "./checkout-replay-definition.js";

const outputDir = resolve(process.env.ACTONCE_BENCHMARK_OUTPUT_DIR ?? ".cache/ios-runtime/my-demo-app-replay");
const startedAt = new Date().toISOString();
const started = process.hrtime.bigint();
const events: unknown[] = [];
let ios: IOSSession | undefined;
let status: "passed" | "failed" = "passed";
let error: { name: string; message: string } | undefined;

await mkdir(outputDir, { recursive: true });
try {
  ios = await IOSSession.connect();
  const flow = createIOSReplayFlow(ios, { policy: "disabled", emit: (event) => { events.push(event); } });
  await replayIOSCheckout(
    flow,
    (x, y) => replayIOSPrimitive(ios!, iosTapPrimitive(x, y)),
  );

  await ios.screenshot(resolve(outputDir, "shipping-address.png"));
  await writeResult({ status, startedAt, durationMs: elapsed(), replayDiagnostics: flow.diagnostics(), events });
} catch (caught) {
  status = "failed";
  error = caught instanceof Error ? { name: caught.name, message: caught.message } : { name: "Error", message: String(caught) };
  await writeResult({ status, startedAt, durationMs: elapsed(), error, events });
} finally {
  await ios?.close();
}

console.log(JSON.stringify({ status, durationMs: elapsed(), outputDir, error }, null, 2));
if (status === "failed") process.exitCode = 2;

function elapsed() { return Number(process.hrtime.bigint() - started) / 1_000_000; }
async function writeResult(result: unknown) {
  await writeFile(resolve(outputDir, "result.json"), `${JSON.stringify({ schemaVersion: 1, benchmark: "ios-demo-checkout", mode: "replay", ...result as object }, null, 2)}\n`);
}
