import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import sharp from "sharp";
import {
  MacSession,
  captureMacRegionScreenshot,
  setupMacWindow,
  snapshotProcessIds,
} from "../../../../runtime/macos/src/index.js";

export type Point = { x: number; y: number };
export type WindowFrame = Point & { width: number; height: number };
export type PixelRegion = { left: number; top: number; width: number; height: number };
export const DISPLAY = { width: 1728, height: 1117, dpr: 2 };
export const RECORDED_WINDOW = { x: 178, y: 118, width: 1372, height: 880 };
export const FULL_WINDOW_REGION = {
  left: 0,
  top: 0,
  width: RECORDED_WINDOW.width * DISPLAY.dpr,
  height: RECORDED_WINDOW.height * DISPLAY.dpr,
};

export type VisualReplay = Awaited<ReturnType<typeof launchVisualReplay>>;

export async function launchVisualReplay(outputDir: string) {
  const repositoryRoot = resolve(import.meta.dirname, "../../../..");
  const fixtureRoot = requiredEnv("ACTONCE_LYNXTRON_FIXTURE_ROOT");
  const desktopBundle = requiredEnv("ACTONCE_LYNXTRON_DESKTOP_BUNDLE");
  const fixtureConfig = requiredEnv("ACTONCE_LYNXTRON_CONFIG_PATH");
  const fixtureTmp = requiredEnv("ACTONCE_LYNXTRON_TMPDIR");
  const displayId = Number(process.env.ACTONCE_DISPLAY_ID ?? "0");
  if (displayId !== 0) throw new Error(`Recorded replay requires displayId 0; received ${displayId}`);
  const screenshotsDir = join(outputDir, "screenshots");
  await mkdir(screenshotsDir, { recursive: true });
  const appPath = join(repositoryRoot, ".cache/benchmarks/lynxtron-host/0.0.8-f924bcbb81ce/Lynxtron.app");
  const previousPids = await snapshotProcessIds("lynxtron", ["extension-host.js"]);
  const mac = await MacSession.connect({
    appPath,
    arguments: [desktopBundle],
    environment: {
      LYNXTRON_ALLOW_MULTI: "1",
      LYNXTRON_FIDDLE_DEV: "1",
      ACTONCE_LYNXTRON_CONFIG_PATH: fixtureConfig,
      TMPDIR: fixtureTmp,
      NODE_PATH: join(repositoryRoot, "benchmark/macos/lynxtron-fiddle/node_modules"),
      PATH: process.env.PATH ?? "/usr/bin:/bin:/usr/sbin:/sbin",
    },
    noReset: true,
    skipAppKill: false,
    logLevel: "error",
  });
  let liveWindow: WindowFrame;
  try {
    const setup = await setupMacWindow({
      processName: "lynxtron",
      previousPids,
      excludeProcessArguments: ["extension-host.js"],
      displayId,
      width: RECORDED_WINDOW.width,
      height: RECORDED_WINDOW.height,
      margin: 40,
      placement: "center",
    });
    liveWindow = setup.frame;
  } catch (error) {
    await mac.close();
    throw error;
  }
  const screenshots: string[] = [];
  const metrics = {
    checkpointPollCount: 0,
    checkpointWaitDurationMs: 0,
    checkpointTimeoutCount: 0,
    visualEvaluationCount: 0,
    visualEvaluationDurationMs: 0,
    screenshotCaptureCount: 0,
    screenshotCaptureDurationMs: 0,
    screenshotBackend: "native-region",
  };

  async function capture(name: string): Promise<string> {
    const path = join(screenshotsDir, name);
    const started = process.hrtime.bigint();
    await captureMacRegionScreenshot(path, liveWindow, { timeoutMs: 2_000 });
    metrics.screenshotCaptureCount += 1;
    metrics.screenshotCaptureDurationMs += elapsed(started);
    const reference = `screenshots/${name}`;
    if (!screenshots.includes(reference)) screenshots.push(reference);
    const metadata = await sharp(path).metadata();
    if (metadata.width !== liveWindow.width * DISPLAY.dpr || metadata.height !== liveWindow.height * DISPLAY.dpr) {
      throw new Error(`Window capture guard failed: screenshot is ${metadata.width}x${metadata.height}`);
    }
    return path;
  }

  async function matches(
    actualPath: string,
    referencePath: string,
    region: PixelRegion = FULL_WINDOW_REGION,
    maximum = 0.03,
  ): Promise<boolean> {
    const started = process.hrtime.bigint();
    const [expected, actual] = await Promise.all([
      sharp(referencePath).extract(windowRegion(RECORDED_WINDOW, region)).greyscale().raw().toBuffer(),
      sharp(actualPath).extract(region).greyscale().raw().toBuffer(),
    ]);
    if (expected.length !== actual.length || expected.length === 0) return false;
    let differing = 0;
    for (let index = 0; index < expected.length; index += 1) {
      if (Math.abs(expected[index] - actual[index]) > 16) differing += 1;
    }
    metrics.visualEvaluationCount += 1;
    metrics.visualEvaluationDurationMs += elapsed(started);
    return differing / expected.length <= maximum;
  }

  async function waitForReference(
    name: string,
    referencePath: string,
    options: { timeoutMs?: number; intervalMs?: number; maximum?: number; region?: PixelRegion } = {},
  ): Promise<string> {
    const timeoutMs = options.timeoutMs ?? 2_500;
    const intervalMs = options.intervalMs ?? 100;
    const started = process.hrtime.bigint();
    let checks = 0;
    let lastPath = "";
    do {
      lastPath = await capture(name);
      checks += 1;
      if (await matches(lastPath, referencePath, options.region, options.maximum)) {
        metrics.checkpointPollCount += Math.max(0, checks - 1);
        metrics.checkpointWaitDurationMs += elapsed(started);
        return lastPath;
      }
      const spent = elapsed(started);
      if (spent >= timeoutMs) break;
      await delay(Math.min(intervalMs, timeoutMs - spent));
    } while (true);
    metrics.checkpointPollCount += Math.max(0, checks - 1);
    metrics.checkpointWaitDurationMs += elapsed(started);
    metrics.checkpointTimeoutCount += 1;
    throw new Error(`Visual checkpoint ${name} did not match its recorded window-relative reference`);
  }

  function recordedPhysicalPoint(center: [number, number]): Point {
    const logical = { x: center[0] / DISPLAY.dpr, y: center[1] / DISPLAY.dpr };
    return {
      x: liveWindow.x + logical.x - RECORDED_WINDOW.x,
      y: liveWindow.y + logical.y - RECORDED_WINDOW.y,
    };
  }

  function recordedLogicalTarget(center: [number, number], description: string) {
    const point = {
      x: liveWindow.x + center[0] - RECORDED_WINDOW.x,
      y: liveWindow.y + center[1] - RECORDED_WINDOW.y,
    };
    return { center: [point.x, point.y] as [number, number], description };
  }

  return {
    mac,
    liveWindow,
    screenshots,
    metrics,
    repositoryRoot,
    fixtureRoot,
    fixtureConfig,
    fixtureTmp,
    capture,
    matches,
    waitForReference,
    recordedPhysicalPoint,
    recordedLogicalTarget,
    close: () => mac.close(),
  };
}

function windowRegion(window: WindowFrame, region: PixelRegion): PixelRegion {
  return {
    left: Math.round(window.x * DISPLAY.dpr + region.left),
    top: Math.round(window.y * DISPLAY.dpr + region.top),
    width: region.width,
    height: region.height,
  };
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required; invoke through the benchmark CLI`);
  return value;
}

export function elapsed(started: bigint): number {
  return Number(process.hrtime.bigint() - started) / 1_000_000;
}

export function serializeError(error: unknown): { name: string; message: string; stack?: string } {
  return error instanceof Error
    ? { name: error.name, message: error.message, stack: error.stack }
    : { name: "Error", message: String(error) };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}
