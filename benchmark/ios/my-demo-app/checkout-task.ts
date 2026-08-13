import type { IOSAgent, IOSDevice } from "@midscene/ios";
import type { RecordingTaskContext } from "../../../interceptor/src/recording-profiles.js";

const BUNDLE_ID = "com.saucelabs.mydemo.app.ios";

/** Canonical AI demonstration for the pinned My Demo App checkout fixture. */
export default async function run(
  context: RecordingTaskContext<IOSAgent, IOSDevice>,
): Promise<void> {
  await context.device.terminate(BUNDLE_ID).catch(() => undefined);
  await context.device.launch(BUNDLE_ID);

  await context.agent.aiAct(
    [
      "In My Demo App, start from the Catalog.",
      "Open Sauce Labs Backpack - Black, increase its quantity to 3, add it to the cart, and open the Cart tab.",
      "Verify your actions visually as you go. Do not select another product.",
    ].join(" "),
    { abortSignal: AbortSignal.timeout(300_000) },
  );
  await context.agent.aiAssert(
    "My Cart visibly contains exactly 3 Sauce Labs Backpack - Black items and the total is $89.97.",
  );

  await context.agent.aiAct(
    [
      "Proceed to checkout.",
      "On Login, select the built-in bob@example.com demo username so the fixture fills its demo credentials, then tap Login.",
      "Stop on the Checkout shipping-address screen. Do not tap To Payment and do not place an order.",
    ].join(" "),
    { abortSignal: AbortSignal.timeout(300_000) },
  );
  await context.agent.aiAssert(
    [
      "The Checkout shipping-address screen is visible.",
      "Its prefilled fields show Rebecca Winter, Mandorley 112, Truro, Cornwall, 89750, and United Kingdom,",
      "and the cart badge still shows 3.",
    ].join(" "),
  );
}
