import { describe, expect, it } from "vitest";
import {
  androidUiAutomatorXmlToUiTree,
  activateAndroidPackage,
  findAndroidUiTreeNodes,
  normalizeAndroidSource,
  isInvalidSessionError,
  UIAUTOMATOR2_NEW_COMMAND_TIMEOUT_SECONDS,
} from "../src/native-device.js";

describe("activateAndroidPackage", () => {
  it("starts the uniquely resolved launcher component with Android launcher flags", async () => {
    const calls: string[][] = [];
    await activateAndroidPackage("com.example.files", async (args) => {
      calls.push(args);
      if (args[0] === "getprop") return "33";
      if (args.includes("resolve-activity")) return "priority=0 match=0x108000";
      if (args.includes("query-activities")) {
        return "1 activities found:\n  com.example.files/com.example.files.LauncherActivity";
      }
      return "Starting: Intent";
    });

    expect(calls.at(-1)).toEqual([
      "am", "start-activity",
      "-a", "android.intent.action.MAIN",
      "-c", "android.intent.category.LAUNCHER",
      "-f", "0x10200000",
      "-n", "com.example.files/com.example.files.LauncherActivity",
    ]);
  });

  it("uses the package manager default without enumerating activities", async () => {
    const calls: string[][] = [];
    await activateAndroidPackage("com.example.app", async (args) => {
      calls.push(args);
      if (args[0] === "getprop") return "29";
      if (args.includes("resolve-activity")) {
        return "com.example.app/.MainActivity";
      }
      return "Starting: Intent";
    });

    expect(calls.some((args) => args.includes("query-activities"))).toBe(false);
    expect(calls.at(-1)).toContain("com.example.app/.MainActivity");
  });

  it("fails closed when package activation is ambiguous", async () => {
    await expect(activateAndroidPackage("com.example.app", async (args) => {
      if (args[0] === "getprop") return "33";
      if (args.includes("resolve-activity")) return "No activity found";
      return [
        "com.example.app/.FirstActivity",
        "com.example.app/.SecondActivity",
      ].join("\n");
    })).rejects.toThrow("matched 2");
  });

  it("rejects start errors even when adb shell exits successfully", async () => {
    await expect(activateAndroidPackage("com.example.app", async (args) => {
      if (args[0] === "getprop") return "33";
      if (args.includes("resolve-activity")) return "com.example.app/.MainActivity";
      return "Error: Activity class does not exist";
    })).rejects.toThrow("Cannot activate 'com.example.app'");
  });

  it("uses launcher-style monkey activation before API 24", async () => {
    const calls: string[][] = [];
    await activateAndroidPackage("com.example.legacy", async (args) => {
      calls.push(args);
      return args[0] === "getprop" ? "23" : "Events injected: 1";
    });
    expect(calls.at(-1)).toEqual([
      "monkey", "-p", "com.example.legacy",
      "-c", "android.intent.category.LAUNCHER", "1",
    ]);
  });
});

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

describe("findAndroidUiTreeNodes", () => {
  it("matches the exact semantic fields chosen by the compile Skill", () => {
    const tree = androidUiAutomatorXmlToUiTree(`<?xml version="1.0"?><hierarchy><node class="android.widget.Spinner" text="Mobile" content-desc="Mobile Phone" bounds="[10,20][110,70]"/><node class="android.widget.TextView" text="Mobile" bounds="[0,0][10,10]"/></hierarchy>`);
    const matches = findAndroidUiTreeNodes(tree.root, {
      type: "android.widget.Spinner",
      text: "Mobile",
    });
    expect(matches).toHaveLength(1);
    expect(matches[0].bounds).toEqual({ left: 10, top: 20, width: 100, height: 50 });
  });
});
