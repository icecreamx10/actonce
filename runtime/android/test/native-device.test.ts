import { describe, expect, it } from "vitest";
import {
  androidUiAutomatorXmlToUiTree,
  normalizeAndroidSource,
  isInvalidSessionError,
  UIAUTOMATOR2_NEW_COMMAND_TIMEOUT_SECONDS,
} from "../src/native-device.js";

describe("persistent UIAutomator2 session", () => {
  it("outlives the ten-minute benchmark model timeout", () => {
    expect(UIAUTOMATOR2_NEW_COMMAND_TIMEOUT_SECONDS).toBeGreaterThan(600);
  });

  it("recovers only explicit invalid-session failures", () => {
    expect(isInvalidSessionError(new Error("invalid session id"))).toBe(true);
    expect(isInvalidSessionError(new Error("The session identified by abc is not known"))).toBe(true);
    expect(isInvalidSessionError(new Error("connection refused"))).toBe(false);
  });
});

describe("normalizeAndroidSource", () => {
  it("preserves accessibility attributes used by source checkpoints", () => {
    const source = normalizeAndroidSource(`<?xml version="1.0"?><hierarchy><node text="Products" content-desc="Increase item quantity"><node text="3" /></node></hierarchy>`);
    expect(source).toContain("Products");
    expect(source).toContain("Increase item quantity");
    expect(source).toContain('"text":"3"');
  });
});

describe("androidUiAutomatorXmlToUiTree", () => {
  it("preserves ordered children and converts physical bounds to logical coordinates", () => {
    const tree = androidUiAutomatorXmlToUiTree(
      `<?xml version="1.0"?><hierarchy rotation="0"><android.widget.FrameLayout class="android.widget.FrameLayout" bounds="[0,0][1080,2400]"><android.widget.TextView class="android.widget.TextView" text="Record" clickable="true" bounds="[90,300][390,420]"/><android.widget.TextView class="android.widget.TextView" text="Stop" bounds="[420,300][720,420]"/></android.widget.FrameLayout></hierarchy>`,
      3,
      123,
    );

    expect(tree).toEqual({
      platform: "android",
      capturedAt: 123,
      root: {
        type: "android.widget.FrameLayout",
        attrs: { class: "android.widget.FrameLayout" },
        bounds: { left: 0, top: 0, width: 360, height: 800 },
        children: [
          {
            type: "android.widget.TextView",
            attrs: { class: "android.widget.TextView", text: "Record", clickable: "true" },
            bounds: { left: 30, top: 100, width: 100, height: 40 },
            children: [],
          },
          {
            type: "android.widget.TextView",
            attrs: { class: "android.widget.TextView", text: "Stop" },
            bounds: { left: 140, top: 100, width: 100, height: 40 },
            children: [],
          },
        ],
      },
    });
  });
});
