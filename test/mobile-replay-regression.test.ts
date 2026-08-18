import { describe, expect, it } from "vitest";
import { replayAndroidCheckout } from "../benchmark/android/my-demo-app/checkout-replay-definition.js";
import { replayIOSCheckout } from "../benchmark/ios/my-demo-app/checkout-replay-definition.js";
import {
  createAndroidReplayFlow,
} from "../runtime/android/src/index.js";
import {
  createIOSReplayFlow,
} from "../runtime/ios/src/index.js";

describe("checked-in mobile replays", () => {
  it("runs the iOS demo checkout replay definition end to end", async () => {
    const sources = [
      "Catalog-screen Sauce Labs Backpack - Black",
      "ProductDetails-screen Sauce Labs Backpack - Black Add To Cart",
      'ProductDetails-screen value="1" name="BlackColorUnSelected Icons" name="Amount" label="3"',
      'Cart-screen Sauce Labs Backpack - Black Black name="Amount" label="3" 3 Items $89.97',
      "Select a username from the list below bob@example.com 10203040",
      "bob@example.com 10203040",
      "ShippingAddress-screen Rebecca Winter Mandorley 112 Truro Cornwall 89750 United Kingdom To Payment",
    ];
    const taps: Array<{ x: number; y: number }> = [];
    const session = fakeSession(sources);
    const flow = createIOSReplayFlow(session as never, { policy: "disabled" });

    await replayIOSCheckout(flow, async (x, y) => {
      taps.push({ x, y });
      if ([1, 6, 8, 9, 10, 11].includes(taps.length)) session.advance();
    });

    expect(flow.diagnostics().segments.map(({ segmentId, outcome }) => ({
      segmentId,
      outcome,
    }))).toEqual([
      { segmentId: "open-product", outcome: "matched" },
      { segmentId: "configure-product", outcome: "matched" },
      { segmentId: "open-cart", outcome: "matched" },
      { segmentId: "checkout-login", outcome: "matched" },
      { segmentId: "select-demo-account", outcome: "matched" },
      { segmentId: "submit-login", outcome: "matched" },
    ]);
    expect(taps).toEqual([
      { x: 101, y: 286 },
      { x: 139, y: 646 },
      { x: 139, y: 646 },
      { x: 139, y: 647 },
      { x: 124, y: 698 },
      { x: 124, y: 698 },
      { x: 279, y: 700 },
      { x: 200, y: 796 },
      { x: 196, y: 719 },
      { x: 141, y: 546 },
      { x: 196, y: 721 },
    ]);
  });

  it("runs the Android demo checkout replay definition end to end", async () => {
    const sources = [
      "Products Sauce Labs Backpack",
      "Sauce Labs Backpack Black color Add to cart Increase item quantity",
      'Black color Increase item quantity "text":"3" Add to cart',
      'My Cart "text":"3" 3 Items $ 89.97 Proceed To Checkout',
      "Login bod@example.com 10203040",
      "bod@example.com 10203040 •••••••• Tap to login with given credentials",
      "Checkout Enter a shipping address Rebecca Winter Mandorley 112 Truro Cornwall 89750 United Kingdom To Payment",
    ];
    const taps: Array<{ x: number; y: number }> = [];
    const session = fakeSession(sources);
    const flow = createAndroidReplayFlow(session as never, { policy: "disabled" });

    await replayAndroidCheckout(flow, async (x, y) => {
      taps.push({ x, y });
      if ([1, 4, 6, 7, 8, 9].includes(taps.length)) session.advance();
    });

    expect(flow.diagnostics().segments.map(({ segmentId, outcome }) => ({
      segmentId,
      outcome,
    }))).toEqual([
      { segmentId: "open-product", outcome: "matched" },
      { segmentId: "configure-product", outcome: "matched" },
      { segmentId: "open-cart", outcome: "matched" },
      { segmentId: "checkout-login", outcome: "matched" },
      { segmentId: "select-account", outcome: "matched" },
      { segmentId: "submit-login", outcome: "matched" },
    ]);
    expect(taps).toEqual([
      { x: 107, y: 311 },
      { x: 35, y: 781 },
      { x: 94, y: 840 },
      { x: 94, y: 840 },
      { x: 267, y: 840 },
      { x: 380, y: 73 },
      { x: 205, y: 828 },
      { x: 91, y: 659 },
      { x: 205, y: 543 },
    ]);
  });
});

function fakeSession(sources: string[]) {
  let index = 0;
  return {
    source: async () => sources[Math.min(index, sources.length - 1)],
    screenshot: async () => "",
    invalidateObservation: () => undefined,
    advance: () => {
      index += 1;
    },
  };
}
