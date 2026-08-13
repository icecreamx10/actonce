import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { IOSSession } from "../../../runtime/ios/src/session.js";
import { replayIOSPrimitive } from "../../../runtime/ios/src/primitives.js";

const BUNDLE_ID = "com.saucelabs.mydemo.app.ios";
const outputDir = resolve(".cache/ios-runtime/my-demo-app-smoke");
const started = process.hrtime.bigint();
const checkpoints: Array<{ id: string; elapsedMs: number }> = [];
let ios: IOSSession | undefined;

try {
  await mkdir(outputDir, { recursive: true });
  ios = await IOSSession.connect({
    wdaHost: process.env.ACTONCE_WDA_HOST ?? "127.0.0.1",
    wdaPort: Number(process.env.ACTONCE_WDA_PORT ?? "8100"),
  });
  await ios.terminate(BUNDLE_ID).catch(() => undefined);
  await ios.launch(BUNDLE_ID);

  const screen = await ios.device.getScreenSize();
  const tap = (x: number, y: number) => replayIOSPrimitive(ios!, {
    operation: "tap",
    arguments: [{ x: x * screen.width, y: y * screen.height }],
  });

  await checkpoint("catalog", ["Catalog-screen", "Sauce Labs Backpack - Black"]);
  await tap(0.224, 0.376);
  await checkpoint("product-details", ["ProductDetails-screen", "Add To Cart", 'label="1"']);

  await tap(0.321, 0.815);
  await tap(0.321, 0.815);
  await checkpoint("quantity-three", ['name="Amount" label="3"']);
  await tap(0.713, 0.815);
  await tap(0.501, 0.922);
  await checkpoint("cart", ["Cart-screen", "3 Items", "$89.97", "Sauce Labs Backpack - Black"]);

  await tap(0.499, 0.838);
  await checkpoint("login", ["Select a username from the list below", "bob@example.com"]);
  await tap(0.293, 0.628);
  await checkpoint("credentials-filled", ["bob@example.com", "10203040"]);
  await tap(0.499, 0.845);
  await checkpoint("shipping-address", [
    "ShippingAddress-screen",
    "Rebecca Winter",
    "Mandorley 112",
    "Truro",
    "Cornwall",
    "89750",
    "United Kingdom",
    "To Payment",
  ]);

  await ios.screenshot(resolve(outputDir, "shipping-address.png"));
  const result = {
    schemaVersion: 1,
    fixture: "saucelabs-my-demo-app-2.2.2",
    status: "passed",
    durationMs: elapsed(),
    screen,
    checkpoints,
    oracle: {
      quantity: 3,
      cartTotal: "$89.97",
      shippingAddressPrefilled: true,
      stoppedBeforePayment: true,
    },
  };
  await writeFile(resolve(outputDir, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({ ...result, outputDir }, null, 2));
} finally {
  await ios?.close();
}

async function checkpoint(id: string, includes: string[]): Promise<void> {
  const timeoutMs = 3_000;
  const deadline = performance.now() + timeoutMs;
  let lastSource = "";
  do {
    lastSource = await ios!.source();
    if (includes.every((value) => lastSource.includes(value))) {
      checkpoints.push({ id, elapsedMs: elapsed() });
      return;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  } while (performance.now() < deadline);
  const missing = includes.filter((value) => !lastSource.includes(value));
  throw new Error(`Checkpoint ${id} timed out; missing ${missing.join(", ")}`);
}

function elapsed(): number {
  return Number(process.hrtime.bigint() - started) / 1_000_000;
}
