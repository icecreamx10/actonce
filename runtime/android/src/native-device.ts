import { spawn, type ChildProcess } from "node:child_process";
import { access } from "node:fs/promises";
import { XMLParser } from "fast-xml-parser";
import { SERVER_APK_PATH, TEST_APK_PATH } from "appium-uiautomator2-server";
import type { AndroidNodeIdentity, AndroidNodeSelector, AndroidSessionOptions, Point } from "./types.js";

const SERVER_PACKAGE = "io.appium.uiautomator2.server";
const TEST_PACKAGE = `${SERVER_PACKAGE}.test`;
const INSTRUMENTATION = `${TEST_PACKAGE}/androidx.test.runner.AndroidJUnitRunner`;
// Midscene planning may legitimately spend several minutes between device
// observations. Keep the persistent checkpoint session alive longer than the
// pinned model timeout (10 minutes).
export const UIAUTOMATOR2_NEW_COMMAND_TIMEOUT_SECONDS = 1_200;
export const UIAUTOMATOR2_CHECKPOINT_SETTINGS = Object.freeze({
  enableNotificationListener: false,
  // /source resets its cache through Device.waitForIdle(). Let checkpoint
  // polling own UI settling instead of hiding idle waits inside capture I/O.
  waitForIdleTimeout: 0,
  // Faster reads must still invalidate accessibility/window caches each time.
  deferAccessibilityCacheReset: false,
});

/** DELETE /session finishes instrumentation asynchronously. Keep its adb
 * connection alive until Android has disconnected UiAutomation. */
export async function waitForInstrumentationExit(
  child: ChildProcess | undefined,
  timeoutMs = 5_000,
): Promise<boolean> {
  if (!child || child.exitCode !== null || child.signalCode !== null) return true;
  return new Promise((resolve) => {
    const finish = (exited: boolean) => {
      clearTimeout(timer);
      child.removeListener("exit", onExit);
      child.removeListener("error", onError);
      resolve(exited);
    };
    const onExit = () => finish(true);
    const onError = () => finish(false);
    const timer = setTimeout(() => finish(false), timeoutMs);
    child.once("exit", onExit);
    child.once("error", onError);
  });
}

export function resolveAndroidSystemPort(
  explicit?: number,
  environment: string | undefined = process.env.ACTONCE_ANDROID_SYSTEM_PORT,
): number {
  const port = explicit ?? (environment === undefined ? 8200 : Number(environment));
  if (!Number.isInteger(port) || port < 1 || port > 65_535)
    throw new Error(`Invalid Android UIAutomator2 system port: ${String(explicit ?? environment)}`);
  return port;
}

export interface AndroidDisplayGeometry {
  physicalWidth: number;
  physicalHeight: number;
  logicalWidth: number;
  logicalHeight: number;
  densityScale: number;
}

/** wm reports physical first, but an explicit override is the effective value. */
export function parseAndroidDisplayGeometry(sizeOutput: string, densityOutput: string): AndroidDisplayGeometry {
  const effective = (output: string, field: string): string => {
    const lines = output.split(/\r?\n/);
    const line = lines.find((value) => value.trim().startsWith(`Override ${field}:`))
      ?? lines.find((value) => value.trim().startsWith(`Physical ${field}:`));
    if (!line) throw new Error(`Cannot parse Android display ${field}: ${output}`);
    return line.slice(line.indexOf(":") + 1).trim();
  };
  const size = effective(sizeOutput, "size").match(/^(\d+)x(\d+)$/);
  const density = effective(densityOutput, "density");
  if (!size || !/^\d+$/.test(density)) throw new Error("Invalid Android display geometry");
  const physicalWidth = Number(size[1]), physicalHeight = Number(size[2]), dpi = Number(density);
  if (![physicalWidth, physicalHeight, dpi].every((value) => Number.isSafeInteger(value) && value > 0))
    throw new Error("Invalid Android display geometry");
  const densityScale = dpi / 160;
  const logicalWidth = Math.round(physicalWidth / densityScale);
  const logicalHeight = Math.round(physicalHeight / densityScale);
  if (![logicalWidth, logicalHeight].every((value) => Number.isSafeInteger(value) && value > 0))
    throw new Error("Invalid Android logical display geometry");
  return { physicalWidth, physicalHeight, logicalWidth, logicalHeight, densityScale };
}

export function projectAndroidPoint(point: Point, geometry: AndroidDisplayGeometry): Point {
  return {
    x: Math.round(point.x * geometry.physicalWidth / geometry.logicalWidth),
    y: Math.round(point.y * geometry.physicalHeight / geometry.logicalHeight),
  };
}

export class NativeAndroidDevice {
  private instrumentation?: ChildProcess;
  private sessionId?: string;
  private sessionRecovery?: Promise<void>;
  private densityScale = 1;
  private displayGeometry?: AndroidDisplayGeometry;

  private constructor(
    readonly serial: string,
    private readonly adbPath: string,
    private readonly systemPort: number,
    private readonly appNameMapping: Readonly<Record<string, string>>,
  ) {}

  static async connect(options: AndroidSessionOptions = {}): Promise<NativeAndroidDevice> {
    const appNameMapping = validateAndroidAppNameMapping(options.appNameMapping);
    const adbPath = options.androidAdbPath ?? process.env.ACTONCE_ADB_PATH ?? process.env.ANDROID_ADB_PATH ?? "adb";
    const connected = await adb(adbPath, undefined, ["devices"]);
    const serials = connected.split("\n").slice(1).map((line) => line.trim().split(/\s+/)).filter((parts) => parts[1] === "device").map((parts) => parts[0]);
    const serial = options.serial ?? process.env.ACTONCE_ANDROID_SERIAL ?? serials[0];
    if (!serial || !serials.includes(serial)) throw new Error(`Android device ${serial ?? "<none>"} is not connected`);
    const device = new NativeAndroidDevice(serial, adbPath, resolveAndroidSystemPort(options.systemPort), appNameMapping);
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
    await this.createSession();
    await this.size();
  }

  private async createSession(): Promise<void> {
    const session = await this.request<Record<string, unknown>>("POST", "/session", {
      capabilities: {
        firstMatch: [{}],
        alwaysMatch: {
          "appium:newCommandTimeout": UIAUTOMATOR2_NEW_COMMAND_TIMEOUT_SECONDS,
        },
      },
    });
    this.sessionId = stringValue(session.sessionId) ?? stringValue(recordValue(session.value)?.sessionId) ?? stringValue(recordValue(session.value)?.id);
    if (!this.sessionId) throw new Error(`UIAutomator2 did not return a session id: ${JSON.stringify(session)}`);
    // Toast nodes are transient and are not valid replay checkpoints. More
    // importantly, UIAutomator2's synthetic toast node path reflects into
    // AccessibilityNodeInfo internals that are absent on some Android builds.
    // Disable only that listener; the normal accessibility tree remains intact.
    await this.request("POST", this.sessionPath("/appium/settings"), {
      settings: UIAUTOMATOR2_CHECKPOINT_SETTINGS,
    });
  }

  async close(): Promise<void> {
    if (this.sessionId) await this.request("DELETE", `/session/${this.sessionId}`).catch(() => undefined);
    this.sessionId = undefined;
    // Killing adb here can destroy UiAutomation's binder connection while
    // Instrumentation.finish() is still disconnecting it, creating an Android
    // crash dialog after an otherwise successful replay.
    await waitForInstrumentationExit(this.instrumentation);
    await this.shell(["am", "force-stop", SERVER_PACKAGE]).catch(() => "");
    await this.shell(["am", "force-stop", TEST_PACKAGE]).catch(() => "");
    if (this.instrumentation?.exitCode === null && this.instrumentation.signalCode === null)
      this.instrumentation.kill("SIGTERM");
    this.instrumentation = undefined;
    await this.run(["forward", "--remove", `tcp:${this.systemPort}`]).catch(() => "");
  }

  async source(): Promise<string> {
    return normalizeAndroidSource(await this.sourceXml());
  }

  async sourceXml(): Promise<string> {
    const response = await this.sessionRequest<unknown>("GET", "/source");
    const xml = typeof response === "string" ? response : stringValue(recordValue(response)?.value);
    if (!xml) throw new Error(`UIAutomator2 source response did not contain XML: ${JSON.stringify(response)}`);
    return xml;
  }

  pixelRatio(): number { return this.densityScale; }

  async screenshotBase64(): Promise<string> {
    const response = await this.sessionRequest<unknown>("GET", "/screenshot");
    const value = typeof response === "string" ? response : stringValue(recordValue(response)?.value);
    if (!value) throw new Error("UIAutomator2 screenshot response did not contain base64 data");
    return value;
  }
  async size(): Promise<{ width: number; height: number }> {
    // Failed refreshes must not leave actions using stale display geometry.
    this.displayGeometry = undefined;
    const [size, density] = await Promise.all([this.shell(["wm", "size"]), this.shell(["wm", "density"])]);
    const geometry = parseAndroidDisplayGeometry(size, density);
    this.displayGeometry = geometry;
    this.densityScale = geometry.densityScale;
    return { width: geometry.logicalWidth, height: geometry.logicalHeight };
  }

  async tap(point: Point, duration = 150): Promise<void> {
    const hold = validateAndroidTouchDuration(duration);
    const p = this.physical(point);
    // A coordinate press is a real platform touch with an explicit hold, not
    // a zero-duration W3C down/up. Preserve the input command's event cadence.
    await this.shell(["input", "swipe", `${p.x}`, `${p.y}`, `${p.x}`, `${p.y}`, `${hold}`]);
  }
  async tapUniqueNode(selector: AndroidNodeSelector, coordinateFallback?: Point): Promise<"selector" | "coordinate-fallback"> {
    validateAndroidNodeSelector(selector);
    const tree = androidUiAutomatorXmlToUiTree(await this.sourceXml(), this.densityScale);
    const matches = findAndroidUiTreeNodes(tree.root, selector);
    if (matches.length === 1) {
      const response = await this.sessionRequest<unknown>("POST", "/elements", {
        strategy: selector.withinParent ? "xpath" : "-android uiautomator",
        selector: selector.withinParent ? androidNodeSelectorXPath(selector) : androidUiSelector(selector),
      });
      const value = recordValue(response);
      const elements = Array.isArray(response) ? response : value?.value;
      if (!Array.isArray(elements) || elements.length !== 1)
        throw new Error(`Android live selector must match exactly one node; matched ${Array.isArray(elements) ? elements.length : "invalid response"}`);
      const element = recordValue(elements[0]);
      const elementId = stringValue(element?.["element-6066-11e4-a52e-4f735466cecf"])
        ?? stringValue(element?.ELEMENT);
      if (!elementId) throw new Error(`UIAutomator2 did not return an element id: ${JSON.stringify(response)}`);
      await this.sessionRequest("POST", `/element/${encodeURIComponent(elementId)}/click`, {});
      return "selector";
    }
    if (matches.length === 0 && coordinateFallback) {
      await this.tap(coordinateFallback);
      return "coordinate-fallback";
    }
    throw new Error(`Android selector must match exactly one node; matched ${matches.length}: ${JSON.stringify(selector)}`);
  }
  async doubleClick(point: Point): Promise<void> { await this.tap(point, 0); await delay(80); await this.tap(point, 0); }
  async longPress(point: Point, duration = 800): Promise<void> { const p = this.physical(point); await this.shell(["input", "swipe", `${p.x}`, `${p.y}`, `${p.x}`, `${p.y}`, `${duration}`]); }
  async swipe(start: Point, end: Point, duration = 300): Promise<void> {
    const elapsed = validateAndroidTouchDuration(duration);
    const a = this.physical(start), b = this.physical(end);
    await this.shell(["input", "swipe", `${a.x}`, `${a.y}`, `${b.x}`, `${b.y}`, `${elapsed}`]);
  }
  async typeText(value: string): Promise<void> { await this.shell(["input", "text", encodeAndroidInputText(value)]); }
  async keyboardPress(key: string): Promise<void> { await this.shell(["input", "keyevent", keyCode(key)]); }
  async clearInput(maxLength = 100): Promise<void> {
    if (!Number.isInteger(maxLength) || maxLength < 0) throw new TypeError("clearInput maxLength must be a non-negative integer");
    if (maxLength === 0) return;
    // Match Midscene/appium-adb replace semantics exactly. The cursor may be
    // anywhere, so delete on both sides rather than assuming MOVE_END worked.
    await this.shell([
      "input", "keyevent",
      ...Array.from({ length: maxLength }, () => ["67", "112"]).flat(),
    ]);
  }
  async hideKeyboard(timeoutMs = 3_000): Promise<boolean> {
    if (!(await this.isKeyboardShown())) return false;
    // BACK is consumed by the visible IME on stock Android. ESC may be
    // delivered to the app and dismiss a dialog even while mInputShown=true.
    for (const key of ["KEYCODE_BACK", "KEYCODE_ESCAPE"]) {
      await this.keyboardPress(key);
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        await delay(100);
        if (!(await this.isKeyboardShown())) return true;
      }
    }
    throw new Error("Android software keyboard could not be hidden");
  }
  async back(): Promise<void> { await this.keyboardPress("BACK"); }
  async home(): Promise<void> { await this.keyboardPress("HOME"); }
  async recentApps(): Promise<void> { await this.keyboardPress("APP_SWITCH"); }
  async launch(packageName: string): Promise<void> {
    const resolvedPackage = resolveAndroidAppName(packageName, this.appNameMapping);
    await activateAndroidPackage(resolvedPackage, (args) => this.shell(args));
  }
  async terminate(packageName: string): Promise<void> { await this.shell(["am", "force-stop", packageName]); }

  private physical(point: Point): Point {
    if (!this.displayGeometry) throw new Error("Android display geometry is unavailable; refresh size() before coordinate actions");
    return projectAndroidPoint(point, this.displayGeometry);
  }
  private async isKeyboardShown(): Promise<boolean> {
    const output = await this.shell(["dumpsys", "input_method"]);
    return /mInputShown=true\b/.test(output);
  }
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

  private async sessionRequest<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    const staleSessionId = this.sessionId;
    if (!staleSessionId) throw new Error("UIAutomator2 session is not ready");
    try {
      return await this.request<T>(method, `/session/${staleSessionId}${path}`, body);
    } catch (error) {
      if (!isInvalidSessionError(error)) throw error;
      await this.recoverSession(staleSessionId);
      return this.request<T>(method, this.sessionPath(path), body);
    }
  }

  private async recoverSession(staleSessionId: string): Promise<void> {
    if (this.sessionId !== staleSessionId && this.sessionId) return;
    if (!this.sessionRecovery) {
      this.sessionRecovery = (async () => {
        if (this.sessionId !== staleSessionId && this.sessionId) return;
        this.sessionId = undefined;
        await this.createSession();
      })().finally(() => {
        this.sessionRecovery = undefined;
      });
    }
    await this.sessionRecovery;
  }
}

type AndroidShell = (args: string[]) => Promise<string>;

const ANDROID_PACKAGE_NAME = /^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+$/;

function normalizeAndroidAppName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Validate the complete caller mapping before any device I/O and snapshot it. */
export function validateAndroidAppNameMapping(
  mapping: AndroidSessionOptions["appNameMapping"],
): Readonly<Record<string, string>> {
  const result: Record<string, string> = Object.create(null);
  const normalized = new Set<string>();
  if (mapping === undefined) return Object.freeze(result);
  if (mapping === null || typeof mapping !== "object" || Array.isArray(mapping)
    || (Object.getPrototypeOf(mapping) !== Object.prototype
      && Object.getPrototypeOf(mapping) !== null)
    || Reflect.ownKeys(mapping).some((key) => typeof key !== "string")) {
    throw new TypeError("Invalid Android appNameMapping: expected a plain string record");
  }
  for (const [name, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(mapping))) {
    const key = normalizeAndroidAppName(name);
    const packageName: unknown = descriptor.value;
    if (!key || !("value" in descriptor) || typeof packageName !== "string"
      || !ANDROID_PACKAGE_NAME.test(packageName)) {
      throw new TypeError(`Invalid Android appNameMapping entry: ${name}`);
    }
    if (normalized.has(key)) {
      throw new TypeError(`Ambiguous Android appNameMapping name: ${name}`);
    }
    if (ANDROID_PACKAGE_NAME.test(name) && name !== packageName) {
      throw new TypeError(`Android appNameMapping cannot redirect package: ${name}`);
    }
    normalized.add(key);
    result[name] = packageName;
  }
  return Object.freeze(result);
}

/** Exact name first, then trim/collapse whitespace + lowercase; never discover apps. */
export function resolveAndroidAppName(
  name: string,
  mapping?: AndroidSessionOptions["appNameMapping"],
): string {
  const validated = validateAndroidAppNameMapping(mapping);
  if (ANDROID_PACKAGE_NAME.test(name)) return name;
  if (Object.hasOwn(validated, name)) return validated[name]!;
  const key = normalizeAndroidAppName(name);
  const match = Object.keys(validated).find((candidate) => normalizeAndroidAppName(candidate) === key);
  if (match !== undefined) return validated[match]!;
  throw new TypeError(`Unmapped Android app name: ${name}`);
}

/**
 * Encodes a logical string for Android's `input text` command. `adb shell`
 * evaluates the payload remotely, so shell metacharacters must be preserved
 * through that transport in addition to Android's percent/space encoding.
 */
export function encodeAndroidInputText(value: string): string {
  const inputTextPayload = value.replaceAll("%", "%25").replaceAll(" ", "%s");
  return inputTextPayload.replace(/[\\'"`$&|;<>()[\]{}*?!~]/g, "\\$&")
    // adb joins shell arguments into a remote command. Unquoted LF ends that
    // command (and CR/TAB are separators), silently truncating typed text.
    // Quote these characters as argument fragments without changing the text
    // primitive into extra key presses or replacing the focused field.
    .replace(/[\r\n\t]/g, (character) => `'${character}'`);
}

export async function activateAndroidPackage(
  packageName: string,
  shell: AndroidShell,
): Promise<void> {
  if (!/^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+$/.test(packageName)) {
    throw new TypeError(`Invalid Android package name: ${packageName}`);
  }

  const sdkOutput = await shell(["getprop", "ro.build.version.sdk"]);
  const apiLevel = Number.parseInt(sdkOutput.trim(), 10);
  if (!Number.isFinite(apiLevel)) {
    throw new Error(`Cannot determine Android API level: ${sdkOutput}`);
  }

  if (apiLevel < 24) {
    const output = await shell([
      "monkey", "-p", packageName,
      "-c", "android.intent.category.LAUNCHER", "1",
    ]);
    if (/monkey aborted|no activities found|error:/i.test(output)) {
      throw new Error(`Cannot activate '${packageName}': ${output}`);
    }
    return;
  }

  const component = await resolveLaunchableComponent(packageName, shell);
  const output = await shell([
    "am", apiLevel < 26 ? "start" : "start-activity",
    "-a", "android.intent.action.MAIN",
    "-c", "android.intent.category.LAUNCHER",
    "-f", "0x10200000",
    "-n", component,
  ]);
  if (/^error:/mi.test(output)) {
    throw new Error(`Cannot activate '${packageName}': ${output}`);
  }
}

export async function resolveLaunchableComponent(
  packageName: string,
  shell: AndroidShell,
): Promise<string> {
  const resolved = await shell([
    "cmd", "package", "resolve-activity", "--brief", packageName,
  ]).catch(() => "");
  const direct = launchableComponents(resolved, packageName);
  if (direct.length === 1) return direct[0];

  const queried = await shell([
    "cmd", "package", "query-activities", "--brief",
    "-a", "android.intent.action.MAIN",
    "-c", "android.intent.category.LAUNCHER",
    "-p", packageName,
  ]).catch(() => "");
  const candidates = launchableComponents(queried, packageName);
  if (candidates.length === 1) return candidates[0];
  throw new Error(
    `Unable to resolve one launchable activity for '${packageName}'; matched ${candidates.length}`,
  );
}

function launchableComponents(output: string, packageName: string): string[] {
  const escapedPackage = packageName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `(?:^|\\s)(${escapedPackage}\\/[A-Za-z0-9_.$]+)(?=\\s|$)`,
    "gm",
  );
  return [...new Set([...output.matchAll(pattern)].map((match) => match[1]))];
}

function androidUiSelector(selector: AndroidNodeIdentity): string {
  let value = "new UiSelector()";
  if (selector.type !== undefined) value += `.className(${JSON.stringify(selector.type)})`;
  if (selector.text !== undefined) value += `.text(${JSON.stringify(selector.text)})`;
  if (selector.contentDescription !== undefined) value += `.description(${JSON.stringify(selector.contentDescription)})`;
  if (selector.resourceId !== undefined) value += `.resourceId(${JSON.stringify(selector.resourceId)})`;
  return value;
}

const identityFields = ["type", "text", "contentDescription", "resourceId"] as const;
export function validateAndroidNodeSelector(value: unknown): asserts value is AndroidNodeSelector {
  const identity = (input: unknown, relational: boolean): Record<string, unknown> => {
    const entry = recordValue(input);
    if (!entry || Object.keys(entry).some(key => !identityFields.includes(key as typeof identityFields[number]) && !(relational && key === "withinParent"))
      || !identityFields.some(key => typeof entry[key] === "string")
      || identityFields.some(key => entry[key] !== undefined && typeof entry[key] !== "string"))
      throw new TypeError("Android selector requires non-empty identity fields and no unknown fields");
    return entry;
  };
  const entry = identity(value, true);
  if (entry.withinParent !== undefined) {
    const context = recordValue(entry.withinParent);
    if (!context || Object.keys(context).length !== 2 || !Object.hasOwn(context, "selector") || !Object.hasOwn(context, "sibling"))
      throw new TypeError("Android withinParent requires selector and sibling identities");
    identity(context.selector, false);
    identity(context.sibling, false);
  }
}

/** XPath 1.0 literal, including labels containing both quote styles. */
function xpathLiteral(value: string): string {
  if (!value.includes("'")) return `'${value}'`;
  if (!value.includes('"')) return `"${value}"`;
  return `concat(${value.split("'").map(part => `'${part}'`).join(', "\'", ')})`;
}
function identityXPath(selector: AndroidNodeIdentity): string {
  const attributes = { type: "class", text: "text", contentDescription: "content-desc", resourceId: "resource-id" };
  return identityFields.filter(key => selector[key] !== undefined)
    .map(key => `@${attributes[key]}=${xpathLiteral(selector[key]!)}`).join(" and ");
}
export function androidNodeSelectorXPath(selector: AndroidNodeSelector): string {
  validateAndroidNodeSelector(selector);
  const target = identityXPath(selector);
  if (!selector.withinParent) return `//*[${target}]`;
  const parent = identityXPath(selector.withinParent.selector);
  const sibling = identityXPath(selector.withinParent.sibling);
  return `//*[${target}][parent::*[${parent}]][count(preceding-sibling::*[${sibling}] | following-sibling::*[${sibling}])=1]`;
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
export function isInvalidSessionError(error: unknown): boolean {
  const value = error instanceof Error ? error.message : String(error);
  return /invalid session id|session identified by .* is not known/i.test(value);
}
function keyCode(key: string): string { const normalized = key.toUpperCase().replaceAll(" ", "_"); const aliases: Record<string, string> = { ENTER: "KEYCODE_ENTER", RETURN: "KEYCODE_ENTER", BACKSPACE: "KEYCODE_DEL", DELETE: "KEYCODE_DEL", ESCAPE: "KEYCODE_BACK", BACK: "KEYCODE_BACK", HOME: "KEYCODE_HOME", APP_SWITCH: "KEYCODE_APP_SWITCH", TAB: "KEYCODE_TAB" }; return aliases[normalized] ?? (normalized.startsWith("KEYCODE_") ? normalized : `KEYCODE_${normalized}`); }

export function normalizeAndroidSource(xml: string): string {
  return JSON.stringify(new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "" }).parse(xml));
}

export type AndroidUiTreeNode = {
  type: string;
  attrs: Record<string, string>;
  bounds: { left: number; top: number; width: number; height: number };
  children: AndroidUiTreeNode[];
};

export type AndroidUiTree = {
  platform: "android";
  capturedAt: number;
  root: AndroidUiTreeNode;
};

/** Restore ancestry from normalizeAndroidSource's attribute-preserving JSON. */
export function androidNormalizedSourceToUiTree(source: string): AndroidUiTreeNode {
  const collect = (value: unknown): AndroidUiTreeNode[] => {
    if (Array.isArray(value)) return value.flatMap(collect);
    const entry = recordValue(value);
    if (!entry) return [];
    const children = Object.values(entry).flatMap(collect);
    if (typeof entry.class !== "string") return children;
    const attrs = Object.fromEntries(Object.entries(entry).filter((pair): pair is [string, string] => typeof pair[1] === "string"));
    return [{ type: entry.class, attrs, bounds: parseBounds(attrs.bounds, 1), children }];
  };
  const roots = collect(JSON.parse(source));
  if (!roots.length) throw new Error("Android source did not contain a UI node");
  return roots.length === 1 ? roots[0]! : { type: "hierarchy", attrs: {}, bounds: unionBounds(roots), children: roots };
}

export function findAndroidUiTreeNodes(
  root: AndroidUiTreeNode,
  selector: AndroidNodeSelector,
): AndroidUiTreeNode[] {
  validateAndroidNodeSelector(selector);
  const matches: AndroidUiTreeNode[] = [];
  const identityMatches = (node: AndroidUiTreeNode, selector: AndroidNodeIdentity) => (selector.type === undefined || node.type === selector.type)
      && (selector.text === undefined || node.attrs.text === selector.text)
      && (selector.contentDescription === undefined || node.attrs["content-desc"] === selector.contentDescription)
      && (selector.resourceId === undefined || node.attrs["resource-id"] === selector.resourceId);
  const visit = (node: AndroidUiTreeNode, parent?: AndroidUiTreeNode) => {
    if (identityMatches(node, selector)) {
      const context = selector.withinParent;
      if (!context) matches.push(node);
      else if (parent && typeof parent.attrs.class === "string" && identityMatches(parent, context.selector)) {
        const siblings = parent.children.filter(child => child !== node && identityMatches(child, context.sibling));
        if (siblings.length > 1) throw new Error("Android selector sibling context is ambiguous");
        if (siblings.length === 1) matches.push(node);
      }
    }
    for (const child of node.children) visit(child, node);
  };
  visit(root);
  return matches;
}

export function androidUiAutomatorXmlToUiTree(
  xml: string,
  devicePixelRatio = 1,
  capturedAt = Date.now(),
): AndroidUiTree {
  const parsed = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "",
    preserveOrder: true,
  }).parse(xml) as Array<Record<string, unknown>>;
  const hierarchy = parsed.find((entry) => Array.isArray(entry.hierarchy));
  if (!hierarchy) throw new Error("UIAutomator2 source did not contain a hierarchy root");
  const roots = (hierarchy.hierarchy as Array<Record<string, unknown>>)
    .map((entry) => orderedXmlNode(entry, devicePixelRatio))
    .filter((entry): entry is AndroidUiTreeNode => entry !== null);
  if (roots.length === 0) throw new Error("UIAutomator2 hierarchy did not contain a UI node");
  return {
    platform: "android",
    capturedAt,
    root: roots.length === 1 ? roots[0] : {
      type: "hierarchy",
      attrs: {},
      bounds: unionBounds(roots),
      children: roots,
    },
  };
}

function orderedXmlNode(
  entry: Record<string, unknown>,
  devicePixelRatio: number,
): AndroidUiTreeNode | null {
  const tag = Object.keys(entry).find((key) => key !== ":@" && key !== "#text");
  if (!tag || !Array.isArray(entry[tag])) return null;
  const rawAttrs = recordValue(entry[":@"]);
  const attrs = Object.fromEntries(
    Object.entries(rawAttrs ?? {}).map(([key, value]) => [key, String(value)]),
  );
  const bounds = parseBounds(attrs.bounds, devicePixelRatio);
  delete attrs.bounds;
  const children = (entry[tag] as Array<Record<string, unknown>>)
    .map((child) => orderedXmlNode(child, devicePixelRatio))
    .filter((child): child is AndroidUiTreeNode => child !== null);
  return { type: attrs.class || tag, attrs, bounds, children };
}

function parseBounds(raw: string | undefined, devicePixelRatio: number) {
  const match = raw?.match(/^\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]$/);
  const ratio = devicePixelRatio > 0 ? devicePixelRatio : 1;
  if (!match) return { left: 0, top: 0, width: 0, height: 0 };
  const left = Number(match[1]), top = Number(match[2]);
  const right = Number(match[3]), bottom = Number(match[4]);
  return {
    left: left / ratio,
    top: top / ratio,
    width: Math.max(0, right - left) / ratio,
    height: Math.max(0, bottom - top) / ratio,
  };
}

function unionBounds(nodes: AndroidUiTreeNode[]) {
  const left = Math.min(...nodes.map((node) => node.bounds.left));
  const top = Math.min(...nodes.map((node) => node.bounds.top));
  const right = Math.max(...nodes.map((node) => node.bounds.left + node.bounds.width));
  const bottom = Math.max(...nodes.map((node) => node.bounds.top + node.bounds.height));
  return { left, top, width: right - left, height: bottom - top };
}

export function validateAndroidTouchDuration(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 2_147_483_647)
    throw new TypeError("Android touch duration must be an integer between 0 and 2147483647 milliseconds");
  return value;
}
