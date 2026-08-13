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
      "Open the catalog entry titled Sauce Labs Backpack - Black.",
      "On its detail page, tap the black color circle exactly once, then tap the plus button exactly twice so the quantity becomes 3.",
      "In this fixture, a white/black double ring around the black circle means Black is selected; accept that state and never tap a color circle again.",
      "Stop immediately when the visible quantity is 3.",
      "Do not add it to the cart yet and do not select another catalog entry.",
    ].join(" "),
    { abortSignal: AbortSignal.timeout(300_000) },
  );
  await context.agent.aiAssert(
    "The Sauce Labs Backpack - Black detail page is visible with the black color selected and quantity exactly 3.",
  );
  await context.agent.aiAct(
    "Add the current quantity of 3 to the cart, then open the Cart tab and stop.",
    { abortSignal: AbortSignal.timeout(300_000) },
  );
  await context.agent.aiAssert(
    "My Cart visibly contains exactly 3 Sauce Labs Backpack - Black items, shows Color: Black, and the total is $89.97.",
  );

  await context.agent.aiAct(
    [
      "Proceed to checkout.",
      "On Login, tap the built-in bob@example.com username exactly once; the fixture then fills both fields.",
      "The password field intentionally displays only bullet dots, which means it is already filled: do not type, clear, or select the username again.",
      "If the keyboard is visible, tap its Return key to dismiss it, then tap the green Login button.",
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
