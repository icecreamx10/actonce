import type { AndroidAgent, AndroidDevice } from "@midscene/android";
import type { RecordingTaskContext } from "../../../interceptor/src/recording-profiles.js";

const PACKAGE = "com.saucelabs.mydemoapp.android";

/** Canonical AI demonstration for the pinned Android checkout fixture. */
export default async function run(
  context: RecordingTaskContext<AndroidAgent, AndroidDevice>,
): Promise<void> {
  await context.device.terminate(PACKAGE).catch(() => undefined);
  await context.device.launch(PACKAGE);
  await context.agent.aiAct(
    [
      "In My Demo App, start from Products and open Sauce Labs Backpack, the plain black backpack in the first catalog card.",
      "On its detail page select Black exactly once, tap plus exactly twice so quantity becomes 3, add it to the cart, then open the cart.",
      "Stop on My Cart and do not proceed to checkout yet.",
    ].join(" "),
    { abortSignal: AbortSignal.timeout(300_000) },
  );
  await context.agent.aiAssert(
    "My Cart visibly contains exactly 3 Sauce Labs Backpack items and the total is $89.97.",
  );
  await context.agent.aiAct(
    [
      "Tap Proceed To Checkout. On Login tap the built-in bod@example.com username exactly once; this fixture fills both fields.",
      "Do not type or clear the password. Tap the green Login button and stop on the Checkout shipping-address screen.",
      "Do not tap To Payment and do not place an order.",
    ].join(" "),
    { abortSignal: AbortSignal.timeout(300_000) },
  );
  await context.agent.aiAssert(
    "The Checkout shipping-address screen is visible with Rebecca Winter, Mandorley 112, Truro, Cornwall, 89750, United Kingdom, and cart badge 3.",
  );
}
