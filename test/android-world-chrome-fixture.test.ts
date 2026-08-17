import { describe, expect, it } from "vitest";
import {
  CHROME_TERMS_ACCEPT_ID,
  CHROME_SIGNIN_DISMISS_ID,
  findEnabledNodeCenterByResourceId,
  isChromeReady,
  nextChromeFixtureAction,
} from "../benchmark/android/android-world/chrome-fixture.js";

describe("AndroidWorld Chrome fixture", () => {
  it("locates the enabled terms button by stable resource id", () => {
    const xml = `<hierarchy><node text="Accept &amp; continue" resource-id="${CHROME_TERMS_ACCEPT_ID}" clickable="true" enabled="true" bounds="[326,2148][754,2274]" /></hierarchy>`;
    expect(findEnabledNodeCenterByResourceId(xml, CHROME_TERMS_ACCEPT_ID)).toEqual({ x: 540, y: 2211 });
  });

  it("does not select a disabled or non-clickable node", () => {
    const disabled = `<node resource-id="${CHROME_TERMS_ACCEPT_ID}" clickable="true" enabled="false" bounds="[0,0][10,10]" />`;
    const passive = `<node resource-id="${CHROME_TERMS_ACCEPT_ID}" clickable="false" enabled="true" bounds="[0,0][10,10]" />`;
    expect(findEnabledNodeCenterByResourceId(disabled, CHROME_TERMS_ACCEPT_ID)).toBeNull();
    expect(findEnabledNodeCenterByResourceId(passive, CHROME_TERMS_ACCEPT_ID)).toBeNull();
  });

  it("recognizes a fully initialized browser surface", () => {
    expect(isChromeReady('<node resource-id="com.android.chrome:id/search_box_text" />')).toBe(true);
    expect(isChromeReady('<node resource-id="com.android.chrome:id/url_bar" />')).toBe(true);
    expect(isChromeReady('<node text="Accept &amp; continue" />')).toBe(false);
  });

  it("selects only known package-wide onboarding controls", () => {
    const accountChoice = `<node resource-id="${CHROME_SIGNIN_DISMISS_ID}" clickable="true" enabled="true" bounds="[326,2148][754,2274]" />`;
    const sync = '<node resource-id="com.android.chrome:id/negative_button" clickable="true" enabled="true" bounds="[42,2169][273,2295]" />';
    const regionalPromo = '<node resource-id="com.android.chrome:id/button_secondary" clickable="true" enabled="true" bounds="[441,1531][708,1657]" />';
    expect(nextChromeFixtureAction(accountChoice)?.resourceId).toBe(CHROME_SIGNIN_DISMISS_ID);
    expect(nextChromeFixtureAction(sync)).toEqual({
      resourceId: "com.android.chrome:id/negative_button",
      point: { x: 158, y: 2232 },
    });
    expect(nextChromeFixtureAction(regionalPromo)?.resourceId).toBe("com.android.chrome:id/button_secondary");
    expect(nextChromeFixtureAction('<node text="task.html" clickable="true" enabled="true" bounds="[0,0][10,10]" />')).toBeNull();
  });
});
