import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  IOSSession,
  createIOSReplayFlow,
  replayIOSPrimitive,
} from "../../../runtime/ios/src/index.js";

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
  const tap = (x: number, y: number) => replayIOSPrimitive(ios!, { operation: "tap", arguments: [{ x, y }] });

  await flow.segment({
    id: "open-product",
    precondition: { id: "catalog", expected: { source: { includes: ["Catalog-screen", "Sauce Labs Backpack - Black"] } } },
    deterministic: () => tap(101, 286),
    postcondition: { id: "product", expected: { source: { includes: ["ProductDetails-screen", "Sauce Labs Backpack - Black", "Add To Cart"] } }, settle: settle() },
  });

  await flow.segment({
    id: "configure-product",
    precondition: { id: "product-ready", expected: { source: { includes: ["ProductDetails-screen"] } } },
    deterministic: async () => {
      // Recorded sequences 159, 224, and 289. Midscene selected Black three times.
      await tap(139, 646); await tap(139, 646); await tap(139, 647);
      // Recorded sequences 354 and 419.
      await tap(124, 698); await tap(124, 698);
    },
    postcondition: { id: "configured", expected: { source: { includes: ['value="1" name="BlackColorUnSelected Icons"', 'name="Amount" label="3"'] } }, settle: settle() },
  });

  await flow.segment({
    id: "open-cart",
    precondition: { id: "configured-ready", expected: { source: { includes: ['name="Amount" label="3"'] } } },
    deterministic: async () => { await tap(279, 700); await tap(200, 796); },
    postcondition: { id: "cart", expected: { source: { includes: ["Cart-screen", "Sauce Labs Backpack - Black", "Black", "3 Items", "$89.97"] } }, settle: settle() },
  });

  await flow.segment({
    id: "checkout-login",
    precondition: { id: "cart-ready", expected: { source: { includes: ["Cart-screen", "3 Items", "$89.97"] } } },
    deterministic: () => tap(196, 719),
    postcondition: { id: "login", expected: { source: { includes: ["Select a username from the list below", "bob@example.com"] } }, settle: settle() },
  });

  await flow.segment({
    id: "select-demo-account",
    precondition: { id: "login-ready", expected: { source: { includes: ["bob@example.com", "10203040"] } } },
    deterministic: () => tap(141, 546),
    postcondition: { id: "credentials", expected: { source: { includes: ["bob@example.com", "10203040"], excludes: ["XCUIElementTypeKeyboard"] } }, settle: settle(4_000) },
  });

  await flow.segment({
    id: "submit-login",
    precondition: { id: "credentials-ready", expected: { source: { includes: ["bob@example.com"], excludes: ["XCUIElementTypeKeyboard"] } } },
    deterministic: () => tap(196, 721),
    postcondition: { id: "shipping", expected: { source: { includes: ["ShippingAddress-screen", "Rebecca Winter", "Mandorley 112", "Truro", "Cornwall", "89750", "United Kingdom", "To Payment"] }, captureScreenshot: true }, settle: settle(4_000) },
  });

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

function settle(timeoutMs = 3_000) { return { timeoutMs, intervalMs: 100 }; }
function elapsed() { return Number(process.hrtime.bigint() - started) / 1_000_000; }
async function writeResult(result: unknown) {
  await writeFile(resolve(outputDir, "result.json"), `${JSON.stringify({ schemaVersion: 1, benchmark: "ios-demo-checkout", mode: "replay", ...result as object }, null, 2)}\n`);
}
