import type { ReplayFlow } from "@byted-lynx/actonce-replay";
import type {
  AndroidCheckpointActual,
  AndroidCheckpointExpectation,
  RecordedAndroidPrimitive,
} from "../../../runtime/android/src/index.js";

type Tap = (x: number, y: number) => Promise<void>;

export async function replayAndroidCheckout(
  flow: ReplayFlow<AndroidCheckpointExpectation, AndroidCheckpointActual>,
  tap: Tap,
): Promise<void> {
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
}

export function androidTapPrimitive(
  x: number,
  y: number,
): RecordedAndroidPrimitive {
  return { operation: "tap", arguments: [{ x, y }] };
}

function settle(timeoutMs = 4_000) {
  return { timeoutMs, intervalMs: 100 };
}
