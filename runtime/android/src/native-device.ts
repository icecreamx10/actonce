import { spawn, type ChildProcess } from "node:child_process";
import { access } from "node:fs/promises";
import { XMLParser } from "fast-xml-parser";
import { SERVER_APK_PATH, TEST_APK_PATH } from "appium-uiautomator2-server";
import type { AndroidSessionOptions, Point } from "./types.js";

const SERVER_PACKAGE = "io.appium.uiautomator2.server";
const TEST_PACKAGE = `${SERVER_PACKAGE}.test`;
const INSTRUMENTATION = `${TEST_PACKAGE}/androidx.test.runner.AndroidJUnitRunner`;

export class NativeAndroidDevice {
  private instrumentation?: ChildProcess;
  private sessionId?: string;
  private densityScale = 1;

  private constructor(
    readonly serial: string,
    private readonly adbPath: string,
    private readonly systemPort: number,
  ) {}

  static async connect(options: AndroidSessionOptions = {}): Promise<NativeAndroidDevice> {
    const adbPath = options.androidAdbPath ?? process.env.ACTONCE_ADB_PATH ?? process.env.ANDROID_ADB_PATH ?? "adb";
    const connected = await adb(adbPath, undefined, ["devices"]);
    const serials = connected.split("\n").slice(1).map((line) => line.trim().split(/\s+/)).filter((parts) => parts[1] === "device").map((parts) => parts[0]);
    const serial = options.serial ?? process.env.ACTONCE_ANDROID_SERIAL ?? serials[0];
    if (!serial || !serials.includes(serial)) throw new Error(`Android device ${serial ?? "<none>"} is not connected`);
    const device = new NativeAndroidDevice(serial, adbPath, options.systemPort ?? 8200);
    await device.start();
    return device;
  }

  private async start(): Promise<void> {
    await Promise.all([access(SERVER_APK_PATH), access(TEST_APK_PATH)]);
    const installed = await this.shell(["pm", "list", "instrumentation"]);
    if (!installed.includes(INSTRUMENTATION)) {
      await this.run(["install", "-r", "-g", SERVER_APK_PATH]);
      await this.run(["install", "-r", "-g", TEST_APK_PATH]);
    }
    await this.run(["forward", `tcp:${this.systemPort}`, "tcp:6790"]);
    await Promise.all([
      this.shell(["am", "force-stop", SERVER_PACKAGE]).catch(() => ""),
      this.shell(["am", "force-stop", TEST_PACKAGE]).catch(() => ""),
    ]);
    this.instrumentation = spawn(this.adbPath, ["-s", this.serial, "shell", "am", "instrument", "-w", "-e", "disableAnalytics", "true", INSTRUMENTATION], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    await waitUntil(async () => (await fetch(this.url("/status"))).ok, 30_000, "UIAutomator2 server did not become ready");
    const session = await this.request<Record<string, unknown>>("POST", "/session", {
      capabilities: { firstMatch: [{}], alwaysMatch: {} },
    });
    this.sessionId = stringValue(session.sessionId) ?? stringValue(recordValue(session.value)?.sessionId) ?? stringValue(recordValue(session.value)?.id);
    if (!this.sessionId) throw new Error(`UIAutomator2 did not return a session id: ${JSON.stringify(session)}`);
    const density = await this.shell(["wm", "density"]);
    const match = density.match(/(?:Override|Physical) density:\s*(\d+)/);
    this.densityScale = match ? Number(match[1]) / 160 : 1;
  }

  async close(): Promise<void> {
    if (this.sessionId) await this.request("DELETE", `/session/${this.sessionId}`).catch(() => undefined);
    this.instrumentation?.kill("SIGTERM");
    await this.run(["forward", "--remove", `tcp:${this.systemPort}`]).catch(() => "");
  }

  async source(): Promise<string> {
    const response = await this.request<unknown>("GET", this.sessionPath("/source"));
    const xml = typeof response === "string" ? response : stringValue(recordValue(response)?.value);
    if (!xml) return JSON.stringify(response);
    return normalizeAndroidSource(xml);
  }

  async screenshotBase64(): Promise<string> {
    const response = await this.request<unknown>("GET", this.sessionPath("/screenshot"));
    const value = typeof response === "string" ? response : stringValue(recordValue(response)?.value);
    if (!value) throw new Error("UIAutomator2 screenshot response did not contain base64 data");
    return value;
  }
  async size(): Promise<{ width: number; height: number }> { const output = await this.shell(["wm", "size"]); const match = output.match(/(?:Override|Physical) size:\s*(\d+)x(\d+)/); if (!match) throw new Error(`Cannot parse Android display size: ${output}`); return { width: Math.round(Number(match[1]) / this.densityScale), height: Math.round(Number(match[2]) / this.densityScale) }; }

  async tap(point: Point): Promise<void> {
    const p = this.physical(point);
    await this.request("POST", this.sessionPath("/actions"), {
      actions: [{
        type: "pointer",
        id: "finger1",
        parameters: { pointerType: "touch" },
        actions: [
          { type: "pointerMove", duration: 0, x: p.x, y: p.y },
          { type: "pointerDown", button: 0 },
          { type: "pointerUp", button: 0 },
        ],
      }],
    });
  }
  async doubleClick(point: Point): Promise<void> { await this.tap(point); await delay(80); await this.tap(point); }
  async longPress(point: Point, duration = 800): Promise<void> { const p = this.physical(point); await this.shell(["input", "swipe", `${p.x}`, `${p.y}`, `${p.x}`, `${p.y}`, `${duration}`]); }
  async swipe(start: Point, end: Point, duration = 300): Promise<void> {
    const a = this.physical(start), b = this.physical(end);
    await this.request("POST", this.sessionPath("/actions"), {
      actions: [{
        type: "pointer",
        id: "finger1",
        parameters: { pointerType: "touch" },
        actions: [
          { type: "pointerMove", duration: 0, x: a.x, y: a.y },
          { type: "pointerDown", button: 0 },
          { type: "pointerMove", duration, x: b.x, y: b.y },
          { type: "pointerUp", button: 0 },
        ],
      }],
    });
  }
  async typeText(value: string): Promise<void> { await this.shell(["input", "text", value.replaceAll("%", "%25").replaceAll(" ", "%s")]); }
  async keyboardPress(key: string): Promise<void> { await this.shell(["input", "keyevent", keyCode(key)]); }
  async clearInput(): Promise<void> { await this.shell(["input", "keyevent", "KEYCODE_MOVE_END"]); await this.shell(["input", "keyevent", "--longpress", "KEYCODE_DEL"]); }
  async back(): Promise<void> { await this.keyboardPress("BACK"); }
  async home(): Promise<void> { await this.keyboardPress("HOME"); }
  async recentApps(): Promise<void> { await this.keyboardPress("APP_SWITCH"); }
  async launch(packageName: string): Promise<void> {
    await this.shell([
      "am", "start", "-W", "-a", "android.intent.action.MAIN",
      "-c", "android.intent.category.LAUNCHER", "-p", packageName,
    ]);
  }
  async terminate(packageName: string): Promise<void> { await this.shell(["am", "force-stop", packageName]); }

  private physical(point: Point): Point { return { x: Math.round(point.x * this.densityScale), y: Math.round(point.y * this.densityScale) }; }
  private sessionPath(path: string): string { if (!this.sessionId) throw new Error("UIAutomator2 session is not ready"); return `/session/${this.sessionId}${path}`; }
  private url(path: string): string { return `http://127.0.0.1:${this.systemPort}${path}`; }
  private run(args: string[]): Promise<string> { return adb(this.adbPath, this.serial, args); }
  private shell(args: string[]): Promise<string> { return this.run(["shell", ...args]); }
  private async request<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetch(this.url(path), { method, headers: body === undefined ? undefined : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await response.text();
    if (!response.ok) throw new Error(`UIAutomator2 ${method} ${path} failed (${response.status}): ${text}`);
    return (text ? JSON.parse(text) : {}) as T;
  }
}

async function adb(adbPath: string, serial: string | undefined, args: string[]): Promise<string> {
  const command = serial ? ["-s", serial, ...args] : args;
  return new Promise((resolve, reject) => {
    const child = spawn(adbPath, command, { stdio: ["ignore", "pipe", "pipe"] });
    const stdout: Buffer[] = [], stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve(Buffer.concat(stdout).toString("utf8").trim()) : reject(new Error(`adb ${command.join(" ")} failed (${code}): ${Buffer.concat(stderr).toString("utf8").trim()}`)));
  });
}
async function waitUntil(check: () => Promise<boolean>, timeoutMs: number, message: string): Promise<void> { const deadline = Date.now() + timeoutMs; while (Date.now() < deadline) { try { if (await check()) return; } catch {} await delay(250); } throw new Error(message); }
function delay(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }
function recordValue(value: unknown): Record<string, unknown> | undefined { return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }
function stringValue(value: unknown): string | undefined { return typeof value === "string" ? value : undefined; }
function keyCode(key: string): string { const normalized = key.toUpperCase().replaceAll(" ", "_"); const aliases: Record<string, string> = { ENTER: "KEYCODE_ENTER", RETURN: "KEYCODE_ENTER", BACKSPACE: "KEYCODE_DEL", DELETE: "KEYCODE_DEL", ESCAPE: "KEYCODE_BACK", BACK: "KEYCODE_BACK", HOME: "KEYCODE_HOME", APP_SWITCH: "KEYCODE_APP_SWITCH", TAB: "KEYCODE_TAB" }; return aliases[normalized] ?? (normalized.startsWith("KEYCODE_") ? normalized : `KEYCODE_${normalized}`); }

export function normalizeAndroidSource(xml: string): string {
  return JSON.stringify(new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "" }).parse(xml));
}
