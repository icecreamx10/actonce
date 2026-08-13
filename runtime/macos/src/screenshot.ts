import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";

const runFile = promisify(execFile);

export type MacScreenshotRegion = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type MacRegionScreenshotOptions = {
  timeoutMs?: number;
  executable?: string;
};

/** Capture a macOS screen region directly, without routing PNG data through WDA. */
export async function captureMacRegionScreenshot(
  path: string,
  region: MacScreenshotRegion,
  options: MacRegionScreenshotOptions = {},
): Promise<string> {
  const outputPath = resolve(path);
  const timeoutMs = options.timeoutMs ?? 2_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError("timeoutMs must be a positive finite number");
  }
  await mkdir(dirname(outputPath), { recursive: true });
  try {
    await runFile(options.executable ?? "/usr/sbin/screencapture", [
      "-x",
      "-t", "png",
      regionArgument(region),
      outputPath,
    ], {
      timeout: timeoutMs,
      killSignal: "SIGKILL",
    });
  } catch (error) {
    const candidate = error as { killed?: unknown; signal?: unknown };
    if (candidate.killed === true || candidate.signal === "SIGKILL") {
      throw new Error(`macOS region screenshot exceeded ${timeoutMs}ms`, { cause: error });
    }
    throw new Error("macOS region screenshot failed", { cause: error });
  }
  return outputPath;
}

export function regionArgument(region: MacScreenshotRegion): string {
  const normalized = Object.fromEntries(Object.entries(region).map(([name, value]) => {
    if (!Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
    return [name, Math.round(value)];
  })) as MacScreenshotRegion;
  if (normalized.width <= 0 || normalized.height <= 0) {
    throw new TypeError("screenshot width and height must be positive");
  }
  return `-R${normalized.x},${normalized.y},${normalized.width},${normalized.height}`;
}
