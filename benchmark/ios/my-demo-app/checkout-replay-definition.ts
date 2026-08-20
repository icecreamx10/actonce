import type { ReplayFlow } from "@byted-lynx/actonce-replay";
import type {
  IOSCheckpointActual,
  IOSCheckpointExpectation,
  RecordedIOSPrimitive,
} from "../../../runtime/ios/src/index.js";

type Tap = (x: number, y: number) => Promise<void>;

export async function replayIOSCheckout(
  flow: ReplayFlow<IOSCheckpointExpectation, IOSCheckpointActual>,
  tap: Tap,
): Promise<void> {
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
      await tap(139, 646);
      await tap(139, 646);
      await tap(139, 647);
      await tap(124, 698);
      await tap(124, 698);
    },
    postcondition: { id: "configured", expected: { source: { includes: ['value="1" name="BlackColorUnSelected Icons"', 'name="Amount" label="3"'] } }, settle: settle() },
  });

  await flow.segment({
    id: "open-cart",
    precondition: { id: "configured-ready", expected: { source: { includes: ['name="Amount" label="3"'] } } },
    deterministic: async () => {
      await tap(279, 700);
      await tap(200, 796);
    },
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
}

export function iosTapPrimitive(x: number, y: number): RecordedIOSPrimitive {
  return { operation: "tap", arguments: [{ x, y }] };
}

function settle(timeoutMs = 3_000) {
  return { timeoutMs, intervalMs: 100 };
}
