import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  AndroidSession,
  createAndroidReplayFlow,
  replayAndroidPrimitive,
} from "../../../runtime/android/src/index.js";

const outputDir = resolve(
  process.env.ACTONCE_BENCHMARK_OUTPUT_DIR ??
    ".cache/android-runtime/my-demo-app-replay",
);
const startedAt = new Date().toISOString();
const started = process.hrtime.bigint();
const events: unknown[] = [];
let android: AndroidSession | undefined;
let status: "passed" | "failed" = "passed";
let error: { name: string; message: string } | undefined;
await mkdir(outputDir, { recursive: true });
try {
  android = await AndroidSession.connect();
  const flow = createAndroidReplayFlow(android, {
    policy: "disabled",
    emit: (event) => {
      events.push(event);
    },
  });
  const tap = (x: number, y: number) =>
    replayAndroidPrimitive(android!, {
      operation: "tap",
      arguments: [{ x, y }],
    });
  await flow.segment({
    id: "open-product",
    precondition: {
      id: "catalog",
      expected: { source: { includes: ["Products", "Sauce Labs Backpack"] } },
    },
    deterministic: () => tap(107, 311),
    postcondition: {
      id: "product",
      expected: {
        source: {
          includes: ["Sauce Labs Backpack", "Black color", "Add to cart"],
        },
      },
      settle: settle(),
    },
  });
  await flow.segment({
    id: "configure-product",
    precondition: {
      id: "product-ready",
      expected: {
        source: { includes: ["Black color", "Increase item quantity"] },
      },
    },
    deterministic: async () => {
      await tap(35, 781);
      await tap(94, 840);
      await tap(94, 840);
    },
    postcondition: {
      id: "quantity-three",
      expected: {
        source: { includes: ["Increase item quantity", '"text":"3"'] },
      },
      settle: settle(),
    },
  });
  await flow.segment({
    id: "open-cart",
    precondition: {
      id: "configured",
      expected: { source: { includes: ['"text":"3"', "Add to cart"] } },
    },
    deterministic: async () => {
      await tap(267, 840);
      await tap(380, 73);
    },
    postcondition: {
      id: "cart",
      expected: {
        source: {
          includes: ["My Cart", "3 Items", "$ 89.97", "Proceed To Checkout"],
        },
      },
      settle: settle(),
    },
  });
  await flow.segment({
    id: "checkout-login",
    precondition: {
      id: "cart-ready",
      expected: { source: { includes: ["My Cart", "3 Items"] } },
    },
    deterministic: () => tap(205, 828),
    postcondition: {
      id: "login",
      expected: {
        source: { includes: ["Login", "bod@example.com", "10203040"] },
      },
      settle: settle(),
    },
  });
  await flow.segment({
    id: "select-account",
    precondition: {
      id: "login-ready",
      expected: { source: { includes: ["bod@example.com", "10203040"] } },
    },
    deterministic: () => tap(91, 659),
    postcondition: {
      id: "credentials",
      expected: {
        source: {
          includes: [
            "bod@example.com",
            "••••••••",
            "Tap to login with given credentials",
          ],
        },
      },
      settle: settle(),
    },
  });
  await flow.segment({
    id: "submit-login",
    precondition: {
      id: "credentials-ready",
      expected: { source: { includes: ["bod@example.com", "••••••••"] } },
    },
    deterministic: () => tap(205, 543),
    postcondition: {
      id: "shipping",
      expected: {
        source: {
          includes: [
            "Checkout",
            "Enter a shipping address",
            "Rebecca Winter",
            "Mandorley 112",
            "Truro",
            "Cornwall",
            "89750",
            "United Kingdom",
            "To Payment",
          ],
        },
        captureScreenshot: true,
      },
      settle: settle(5_000),
    },
  });
  await android.screenshot(resolve(outputDir, "shipping-address.png"));
  await writeResult({
    status,
    startedAt,
    durationMs: elapsed(),
    replayDiagnostics: flow.diagnostics(),
    events,
  });
} catch (caught) {
  status = "failed";
  error =
    caught instanceof Error
      ? { name: caught.name, message: caught.message }
      : { name: "Error", message: String(caught) };
  await writeResult({
    status,
    startedAt,
    durationMs: elapsed(),
    error,
    events,
  });
} finally {
  await android?.close();
}
console.log(
  JSON.stringify({ status, durationMs: elapsed(), outputDir, error }, null, 2),
);
if (status === "failed") process.exitCode = 2;
function settle(timeoutMs = 4_000) {
  return { timeoutMs, intervalMs: 100 };
}
function elapsed() {
  return Number(process.hrtime.bigint() - started) / 1_000_000;
}
async function writeResult(result: unknown) {
  await writeFile(
    resolve(outputDir, "result.json"),
    `${JSON.stringify({ schemaVersion: 1, benchmark: "android-demo-checkout", mode: "replay", ...(result as object) }, null, 2)}\n`,
  );
}
