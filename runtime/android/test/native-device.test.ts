import { describe, expect, it } from "vitest";
import { EventEmitter } from "node:events";
import { spawnSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import {
  androidUiAutomatorXmlToUiTree,
  activateAndroidPackage,
  resolveAndroidAppName,
  validateAndroidAppNameMapping,
  encodeAndroidInputText,
  findAndroidUiTreeNodes,
  normalizeAndroidSource,
  isInvalidSessionError,
  UIAUTOMATOR2_NEW_COMMAND_TIMEOUT_SECONDS,
  UIAUTOMATOR2_CHECKPOINT_SETTINGS,
  resolveAndroidSystemPort,
  waitForInstrumentationExit,
  parseAndroidDisplayGeometry,
  projectAndroidPoint,
  NativeAndroidDevice,
} from "../src/native-device.js";

describe("Android effective display coordinate projection", () => {
  it("projects fractional density using the rounded logical viewport", () => {
    const geometry = parseAndroidDisplayGeometry("Physical size: 1080x2400", "Physical density: 420");
    expect([geometry.logicalWidth, geometry.logicalHeight]).toEqual([411, 914]);
    expect(projectAndroidPoint({ x: 387, y: 900 }, geometry)).toEqual({ x: 1017, y: 2363 });
    expect(projectAndroidPoint({ x: 411, y: 914 }, geometry)).toEqual({ x: 1080, y: 2400 });
  });

  it("rounds independently on each axis and preserves integral-density projection", () => {
    const geometry = parseAndroidDisplayGeometry("Physical size: 101x103", "Physical density: 240");
    expect(projectAndroidPoint({ x: 34, y: 34 }, geometry)).toEqual({ x: 51, y: 51 });
    expect(projectAndroidPoint({ x: 66, y: 66 }, geometry)).toEqual({ x: 99, y: 99 });
    expect(projectAndroidPoint({ x: 67, y: 67 }, geometry)).toEqual({ x: 101, y: 100 });
    const integral = parseAndroidDisplayGeometry("Physical size: 1080x2400", "Physical density: 480");
    expect(projectAndroidPoint({ x: 30.5, y: 100.5 }, integral)).toEqual({ x: 92, y: 302 });
  });

  it("selects explicit overrides regardless of physical-first output order", () => {
    const geometry = parseAndroidDisplayGeometry("Physical size: 1080x2400\nOverride size: 720x1280", "Physical density: 420\nOverride density: 320");
    expect(geometry).toEqual({ physicalWidth: 720, physicalHeight: 1280, logicalWidth: 360, logicalHeight: 640, densityScale: 2 });
  });

  it("fails closed for missing, malformed, zero, unsafe and zero-logical geometry", () => {
    for (const [size, density] of [
      ["", "Physical density: 420"], ["Physical size: 0x2400", "Physical density: 420"],
      ["Physical size: 1080x2400\nOverride size: invalid", "Physical density: 420"],
      ["Physical size: 1080x2400", "Physical density: 420\nOverride density: 0"],
      ["Physical size: 1080x2400", "Physical density: NaN"],
      ["Physical size: 9007199254740992x2400", "Physical density: 420"],
      ["Physical size: 1x1", "Physical density: 10000"],
    ]) expect(() => parseAndroidDisplayGeometry(size, density)).toThrow();
  });

  it("refreshes cached geometry only at size reads and invalidates it on failure", async () => {
    // Host-only fake transport: no connect(), device, adb or HTTP request.
    const device = Object.create(NativeAndroidDevice.prototype) as NativeAndroidDevice;
    const fake = device as unknown as { shell: (args: string[]) => Promise<string>; sessionRequest: (...args: unknown[]) => Promise<void> };
    let shellCalls = 0;
    let invalid = false;
    const commands: string[][] = [];
    fake.shell = async (args) => { shellCalls++; commands.push(args); return args[1] === "size" ? "Physical size: 1080x2400" : `Physical density: ${invalid ? 0 : 420}`; };
    fake.sessionRequest = async () => { throw new Error("coordinate input should use platform injection"); };
    await device.size();
    await device.tap({ x: 387, y: 900 });
    expect(commands.at(-1)).toEqual(["input", "swipe", "1017", "2363", "1017", "2363", "150"]);
    expect(shellCalls).toBe(3);
    invalid = true;
    await expect(device.size()).rejects.toThrow();
    await expect(device.tap({ x: 387, y: 900 })).rejects.toThrow("geometry is unavailable");
  });
});

describe("native platform coordinate injection", () => {
  async function fixture() {
    const device = Object.create(NativeAndroidDevice.prototype) as NativeAndroidDevice;
    const commands: string[][] = [];
    const fake = device as unknown as { shell: (args: string[]) => Promise<string> };
    fake.shell = async args => {
      if (args[0] === "wm") return args[1] === "size" ? "Physical size: 1080x2400" : "Physical density: 420";
      commands.push(args);
      return "";
    };
    await device.size();
    return { device, commands };
  }
  it("preserves the coordinate press hold and caller-supplied durations", async () => {
    const { device, commands } = await fixture();
    await device.tap({ x: 387, y: 900 });
    await device.tap({ x: 387, y: 900 }, 75);
    expect(commands).toEqual([
      ["input", "swipe", "1017", "2363", "1017", "2363", "150"],
      ["input", "swipe", "1017", "2363", "1017", "2363", "75"],
    ]);
  });
  it("preserves swipe endpoints and explicit/default platform durations", async () => {
    const { device, commands } = await fixture();
    await device.swipe({ x: 387, y: 900 }, { x: 10, y: 20 }, 1000);
    await device.swipe({ x: 387, y: 900 }, { x: 10, y: 20 });
    expect(commands).toEqual([
      ["input", "swipe", "1017", "2363", "26", "53", "1000"],
      ["input", "swipe", "1017", "2363", "26", "53", "300"],
    ]);
  });
  it("rejects invalid durations without injecting input", async () => {
    const { device, commands } = await fixture();
    for (const duration of [-1, NaN, Infinity, 0.5, 2_147_483_648]) {
      await expect(device.tap({ x: 1, y: 1 }, duration)).rejects.toThrow("touch duration");
      await expect(device.swipe({ x: 1, y: 1 }, { x: 2, y: 2 }, duration)).rejects.toThrow("touch duration");
    }
    expect(commands).toEqual([]);
  });
});

describe("Android caller-supplied appNameMapping", () => {
  const mapping = { dialer: "com.google.android.dialer", "Phone App": "com.example.phone" };

  it("resolves exact and normalized logical names without changing packages", () => {
    expect(resolveAndroidAppName("dialer", mapping)).toBe("com.google.android.dialer");
    expect(resolveAndroidAppName("  DIALER  ", mapping)).toBe("com.google.android.dialer");
    expect(resolveAndroidAppName(" phone   APP ", mapping)).toBe("com.example.phone");
    expect(resolveAndroidAppName("com.example.app", mapping)).toBe("com.example.app");
    expect(resolveAndroidAppName("com.example.app")).toBe("com.example.app");
  });

  it("does not fuzzy-match or discover unmapped aliases", () => {
    expect(() => resolveAndroidAppName("dial", mapping)).toThrow("Unmapped");
    expect(() => resolveAndroidAppName("dialer")).toThrow("Unmapped");
  });

  it("rejects every normalized collision, even before an exact match", () => {
    for (const target of ["com.example.other", "com.google.android.dialer"]) {
      expect(() => resolveAndroidAppName("dialer", { dialer: mapping.dialer, " DIALER ": target }))
        .toThrow("Ambiguous");
    }
  });

  it("rejects invalid entries and package redirection", () => {
    expect(() => validateAndroidAppNameMapping({ " ": mapping.dialer })).toThrow("Invalid");
    expect(() => validateAndroidAppNameMapping({ dialer: "bad;package" })).toThrow("Invalid");
    expect(() => validateAndroidAppNameMapping({ "com.example.app": mapping.dialer })).toThrow("redirect");
    expect(() => validateAndroidAppNameMapping([] as unknown as Record<string, string>)).toThrow("Invalid");
    expect(() => validateAndroidAppNameMapping({ get dialer(): string { throw new Error("getter ran"); } }))
      .toThrow("Invalid");
  });

  it("snapshots caller configuration and safely handles special record keys", () => {
    const input = { dialer: mapping.dialer };
    const snapshot = validateAndroidAppNameMapping(input);
    input.dialer = "com.example.other";
    expect(resolveAndroidAppName("dialer", snapshot)).toBe(mapping.dialer);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(resolveAndroidAppName("constructor", { constructor: "com.example.app" })).toBe("com.example.app");
  });
});

describe("encodeAndroidInputText", () => {
  it.each(["header\nbody\n", "\n\nbody", "a\r\nb\tc"])("preserves whitespace through the remote shell argument for %j", value => {
    const encoded = encodeAndroidInputText(value);
    const result = spawnSync("sh", ["-c", 'printf "%s" ' + encoded], { encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(value);
  });

  it("dispatches multiline input as one native text command, not Enter or clear", async () => {
    const device = Object.create(NativeAndroidDevice.prototype) as NativeAndroidDevice;
    const commands: string[][] = [];
    (device as unknown as { shell: (args: string[]) => Promise<string> }).shell = async args => { commands.push(args); return ""; };
    await device.typeText("header\nbody\n");
    expect(commands).toEqual([["input", "text", encodeAndroidInputText("header\nbody\n")]]);
  });
  it("preserves apostrophes through the remote adb shell transport", () => {
    expect(encodeAndroidInputText("It's a bird, it's a plane."))
      .toBe("It\\'s%sa%sbird,%sit\\'s%sa%splane.");
  });

  it("retains Android input text encoding while escaping shell metacharacters", () => {
    expect(encodeAndroidInputText("100% done & saved"))
      .toBe("100%25%sdone%s\\&%ssaved");
  });
});

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
  it("keeps source capture fresh without implicit UI-idle settling", () => {
    expect(UIAUTOMATOR2_CHECKPOINT_SETTINGS).toEqual({
      enableNotificationListener: false,
      waitForIdleTimeout: 0,
      deferAccessibilityCacheReset: false,
    });
    expect(Object.isFrozen(UIAUTOMATOR2_CHECKPOINT_SETTINGS)).toBe(true);
  });
  it("waits for asynchronous instrumentation cleanup without killing its connection", async () => {
    const child = Object.assign(new EventEmitter(), { exitCode: null, signalCode: null });
    const waiting = waitForInstrumentationExit(child as ChildProcess);
    child.emit("exit", 0);
    expect(await waiting).toBe(true);
    expect(child.listenerCount("exit")).toBe(0);
    expect(child.listenerCount("error")).toBe(0);
  });

  it("bounds an unresponsive instrumentation shutdown and removes listeners", async () => {
    const child = Object.assign(new EventEmitter(), { exitCode: null, signalCode: null });
    expect(await waitForInstrumentationExit(child as ChildProcess, 1)).toBe(false);
    expect(child.listenerCount("exit")).toBe(0);
    expect(child.listenerCount("error")).toBe(0);
  });

  it("does not wait for an absent or already exited instrumentation", async () => {
    expect(await waitForInstrumentationExit(undefined)).toBe(true);
    const child = Object.assign(new EventEmitter(), { exitCode: 0, signalCode: null });
    expect(await waitForInstrumentationExit(child as ChildProcess)).toBe(true);
  });

  it("resolves distinct worker ports from the environment", () => {
    expect(resolveAndroidSystemPort(undefined, "8200")).toBe(8200);
    expect(resolveAndroidSystemPort(undefined, "8201")).toBe(8201);
    expect(resolveAndroidSystemPort(undefined, undefined)).toBe(8200);
  });

  it("lets explicit configuration override environment configuration", () => {
    expect(resolveAndroidSystemPort(8300, "8201")).toBe(8300);
    expect(resolveAndroidSystemPort(8300, "invalid")).toBe(8300);
  });

  it.each(["", "invalid", "0", "65536", "8200.5"])("rejects invalid worker port %s", (value) => {
    expect(() => resolveAndroidSystemPort(undefined, value)).toThrow("system port");
  });

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
