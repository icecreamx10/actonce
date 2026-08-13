import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { remote, type Browser, type Element } from "webdriverio";
import { ManagedAppiumServer } from "./appium-server.js";
import { MacElement } from "./element.js";
import { describeLocator, locatorToWebdriver } from "./locator.js";
import { waitUntil } from "./wait.js";
import type { MacLocator, MacSessionOptions, Point, WaitOptions } from "./types.js";

export class MacSession {
  private constructor(
    readonly driver: Browser,
    private readonly server?: ManagedAppiumServer,
  ) {}

  static async connect(options: MacSessionOptions = {}): Promise<MacSession> {
    const shouldStart = options.server?.start ?? true;
    const server = shouldStart
      ? await ManagedAppiumServer.start({
          hostname: options.server?.hostname,
          port: options.server?.port,
          logPath: options.server?.logPath,
          startupTimeoutMs: options.server?.startupTimeoutMs,
        })
      : undefined;
    const hostname = server?.hostname ?? options.server?.hostname ?? "127.0.0.1";
    const port = server?.port ?? options.server?.port ?? 4723;
    try {
      const driver = await remote({
        hostname,
        port,
        path: options.server?.path ?? "/",
        logLevel: options.logLevel ?? "warn",
        capabilities: {
          platformName: "mac",
          "appium:automationName": "mac2",
          ...(options.bundleId ? { "appium:bundleId": options.bundleId } : {}),
          ...(options.appPath ? { "appium:appPath": options.appPath } : {}),
          ...(options.arguments ? { "appium:arguments": options.arguments } : {}),
          ...(options.environment ? { "appium:environment": options.environment } : {}),
          ...(options.noReset !== undefined ? { "appium:noReset": options.noReset } : {}),
          ...(options.skipAppKill !== undefined
            ? { "appium:skipAppKill": options.skipAppKill }
            : {}),
          ...(options.mac2?.systemPort
            ? { "appium:systemPort": options.mac2.systemPort }
            : {}),
          ...(options.mac2?.showServerLogs !== undefined
            ? { "appium:showServerLogs": options.mac2.showServerLogs }
            : {}),
          ...(options.mac2?.webDriverAgentMacUrl
            ? { "appium:webDriverAgentMacUrl": options.mac2.webDriverAgentMacUrl }
            : {}),
          ...(options.capabilities ?? {}),
        },
      });
      return new MacSession(driver, server);
    } catch (error) {
      await server?.stop();
      throw error;
    }
  }

  async close(): Promise<void> {
    try {
      await this.driver.deleteSession();
    } finally {
      await this.server?.stop();
    }
  }

  async find(locator: MacLocator, options: WaitOptions = {}): Promise<MacElement> {
    const selector = locatorToWebdriver(locator);
    const description = describeLocator(locator);
    const raw = await waitUntil<Element>(async () => {
      const candidate = await this.driver.$(selector);
      return (await candidate.isExisting()) ? candidate.getElement() : undefined;
    }, {
      ...options,
      message: options.message ?? `Element not found: ${description}`,
    });
    return new MacElement(raw, description);
  }

  async findAll(locator: MacLocator): Promise<MacElement[]> {
    const description = describeLocator(locator);
    const elements = await this.driver.$$(locatorToWebdriver(locator)).getElements();
    return elements.map((element, index) =>
      new MacElement(element, `${description}[${index}]`),
    );
  }

  async click(point: Point): Promise<void> {
    await this.pointerSequence(point, 0);
  }

  async doubleClick(point: Point): Promise<void> {
    await this.driver.performActions([
      {
        type: "pointer",
        id: "actonce-mouse",
        parameters: { pointerType: "mouse" },
        actions: [
          { type: "pointerMove", duration: 10, origin: "viewport", ...point },
          { type: "pointerDown", button: 0 },
          { type: "pointerUp", button: 0 },
          { type: "pause", duration: 80 },
          { type: "pointerDown", button: 0 },
          { type: "pointerUp", button: 0 },
        ],
      },
    ]);
    await this.driver.releaseActions();
  }

  async rightClick(point: Point): Promise<void> {
    await this.pointerSequence(point, 2);
  }

  async hover(point: Point, durationMs = 100): Promise<void> {
    await this.driver.performActions([
      {
        type: "pointer",
        id: "actonce-mouse",
        parameters: { pointerType: "mouse" },
        actions: [
          { type: "pointerMove", duration: durationMs, origin: "viewport", ...point },
        ],
      },
    ]);
    await this.driver.releaseActions();
  }

  async dragAndDrop(from: Point, to: Point, durationMs = 300): Promise<void> {
    await this.driver.performActions([
      {
        type: "pointer",
        id: "actonce-mouse",
        parameters: { pointerType: "mouse" },
        actions: [
          { type: "pointerMove", duration: 10, origin: "viewport", ...from },
          { type: "pointerDown", button: 0 },
          { type: "pause", duration: 100 },
          { type: "pointerMove", duration: durationMs, origin: "viewport", ...to },
          { type: "pointerUp", button: 0 },
        ],
      },
    ]);
    await this.driver.releaseActions();
  }

  async scroll(
    delta: { x?: number; y?: number; deltaX: number; deltaY: number },
    durationMs = 100,
  ): Promise<void> {
    await this.driver.performActions([
      {
        type: "wheel",
        id: "actonce-wheel",
        actions: [
          {
            type: "scroll",
            duration: durationMs,
            origin: "viewport",
            x: delta.x ?? 0,
            y: delta.y ?? 0,
            deltaX: delta.deltaX,
            deltaY: delta.deltaY,
          },
        ],
      },
    ]);
    await this.driver.releaseActions();
  }

  async keys(keys: string | string[]): Promise<void> {
    await this.driver.keys(keys);
  }

  async keyChord(keys: string[]): Promise<void> {
    if (keys.length === 0) throw new TypeError("keyChord requires at least one key");
    await this.driver.performActions([
      {
        type: "key",
        id: "actonce-keyboard",
        actions: [
          ...keys.map((value) => ({ type: "keyDown" as const, value })),
          ...[...keys].reverse().map((value) => ({ type: "keyUp" as const, value })),
        ],
      },
    ]);
    await this.driver.releaseActions();
  }

  async source(): Promise<string> {
    return this.driver.getPageSource();
  }

  async screenshot(path?: string): Promise<string> {
    const base64 = await this.driver.takeScreenshot();
    if (path) {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, Buffer.from(base64, "base64"));
    }
    return base64;
  }

  async launchApp(options: {
    bundleId?: string;
    path?: string;
    arguments?: string[];
    environment?: Record<string, string>;
  }): Promise<void> {
    await this.driver.executeScript("macos: launchApp", [options]);
  }

  async activateApp(bundleId: string): Promise<void> {
    await this.driver.executeScript("macos: activateApp", [{ bundleId }]);
  }

  async terminateApp(bundleId: string): Promise<void> {
    await this.driver.executeScript("macos: terminateApp", [{ bundleId }]);
  }

  async queryAppState(bundleId: string): Promise<number> {
    return this.driver.executeScript("macos: queryAppState", [{ bundleId }]);
  }

  waitFor<T>(probe: () => Promise<T> | T, options?: WaitOptions): Promise<T> {
    return waitUntil(probe, options);
  }

  private async pointerSequence(point: Point, button: number): Promise<void> {
    await this.driver.performActions([
      {
        type: "pointer",
        id: "actonce-mouse",
        parameters: { pointerType: "mouse" },
        actions: [
          { type: "pointerMove", duration: 10, origin: "viewport", ...point },
          { type: "pointerDown", button },
          { type: "pause", duration: 50 },
          { type: "pointerUp", button },
        ],
      },
    ]);
    await this.driver.releaseActions();
  }
}
