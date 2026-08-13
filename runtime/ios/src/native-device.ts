import type { IOSSessionOptions, Point } from "./types.js";

export class NativeIOSDevice {
  private sessionId?: string;
  private ownsSession = false;
  private constructor(private readonly baseUrl: string) {}

  static async connect(options: IOSSessionOptions = {}): Promise<NativeIOSDevice> {
    const host = options.wdaHost ?? "127.0.0.1";
    const device = new NativeIOSDevice(`http://${host}:${options.wdaPort ?? 8100}`);
    const status = await device.request<unknown>("GET", "/status").catch((error) => { throw new Error(`WebDriverAgent is not reachable at ${device.baseUrl}: ${message(error)}`); });
    if (!status) throw new Error("WebDriverAgent returned an empty status response");
    if (options.sessionId) device.sessionId = options.sessionId;
    else {
      const response = await device.request<Record<string, unknown>>("POST", "/session", { capabilities: { alwaysMatch: {} } });
      device.sessionId = stringValue(response.sessionId) ?? stringValue(recordValue(response.value)?.sessionId);
      device.ownsSession = true;
    }
    if (!device.sessionId) throw new Error("WebDriverAgent did not return a session id");
    return device;
  }

  async close(): Promise<void> { if (this.ownsSession && this.sessionId) await this.request("DELETE", this.path()).catch(() => undefined); }
  async source(): Promise<string> { const response = await this.request<unknown>("GET", this.path("/source")); const value = recordValue(response)?.value; return typeof value === "string" ? value : JSON.stringify(response); }
  async screenshotBase64(): Promise<string> { const response = await this.request<unknown>("GET", this.path("/screenshot")); const value = typeof response === "string" ? response : recordValue(response)?.value; if (typeof value !== "string") throw new Error("WDA screenshot response did not contain base64 data"); return value; }
  async tap(point: Point): Promise<void> { await this.request("POST", this.path("/wda/tap"), rounded(point)); }
  async doubleClick(point: Point): Promise<void> { await this.request("POST", this.path("/wda/doubleTap"), rounded(point)); }
  async longPress(point: Point, duration = 1_000): Promise<void> { await this.request("POST", this.path("/wda/touchAndHold"), { ...rounded(point), duration: duration / 1_000 }); }
  async swipe(start: Point, end: Point, duration = 500): Promise<void> { await this.request("POST", this.path("/actions"), { actions: [{ type: "pointer", id: "finger1", parameters: { pointerType: "touch" }, actions: [{ type: "pointerMove", duration: 0, ...rounded(start) }, { type: "pointerDown", button: 0 }, { type: "pause", duration: 100 }, { type: "pointerMove", duration, ...rounded(end) }, { type: "pointerUp", button: 0 }] }] }); }
  async typeText(value: string): Promise<void> { await this.request("POST", this.path("/wda/keys"), { value: [...value] }); }
  async keyboardPress(key: string): Promise<void> { await this.request("POST", this.path("/wda/keys"), { value: [keyValue(key)] }); }
  async clearInput(): Promise<void> { const active = await this.request<unknown>("GET", this.path("/element/active")); const value = recordValue(active)?.value; const element = stringValue(recordValue(value)?.["element-6066-11e4-a52e-4f735466cecf"]) ?? stringValue(recordValue(value)?.ELEMENT); if (!element) throw new Error("WDA did not return an active input element"); await this.request("POST", this.path(`/element/${element}/clear`), {}); }
  async launch(bundleId: string): Promise<void> { await this.request("POST", this.path("/wda/apps/launch"), { bundleId }); }
  async terminate(bundleId: string): Promise<void> { await this.request("POST", this.path("/wda/apps/terminate"), { bundleId }); }
  async home(): Promise<void> { await this.request("POST", this.path("/wda/pressButton"), { name: "home" }); }
  async windowSize(): Promise<{ width: number; height: number }> { const response = await this.request<unknown>("GET", this.path("/window/size")); const value = recordValue(recordValue(response)?.value); return { width: numberValue(value?.width), height: numberValue(value?.height) }; }
  async getScreenSize(): Promise<{ width: number; height: number }> { return this.windowSize(); }
  async getConnectedDeviceInfo(): Promise<unknown> { const response = await this.request<unknown>("GET", this.path("/wda/device/info")); return recordValue(response)?.value ?? response; }

  private path(suffix = ""): string { if (!this.sessionId) throw new Error("WDA session is not ready"); return `/session/${this.sessionId}${suffix}`; }
  private async request<T = unknown>(method: string, path: string, body?: unknown): Promise<T> { const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 30_000); try { const response = await fetch(`${this.baseUrl}${path}`, { method, headers: { accept: "application/json", "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal }); const text = await response.text(); const data = text ? JSON.parse(text) : {}; if (!response.ok) throw new Error(`WDA ${method} ${path} failed (${response.status}): ${text}`); return data as T; } finally { clearTimeout(timeout); } }
}

function rounded(point: Point): Point { return { x: Math.round(point.x), y: Math.round(point.y) }; }
function recordValue(value: unknown): Record<string, unknown> | undefined { return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }
function stringValue(value: unknown): string | undefined { return typeof value === "string" ? value : undefined; }
function numberValue(value: unknown): number { if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`Expected finite WDA number, got ${String(value)}`); return value; }
function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function keyValue(key: string): string { const values: Record<string, string> = { Enter: "\n", Return: "\n", Backspace: "\b", Delete: "\b", Space: " ", Tab: "\t", ArrowUp: "\uE013", ArrowDown: "\uE015", ArrowLeft: "\uE012", ArrowRight: "\uE014", Home: "\uE011", End: "\uE010" }; return values[key] ?? (key.length === 1 ? key : (() => { throw new Error(`Unsupported iOS key ${key}`); })()); }
