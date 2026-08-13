import { execFile } from "node:child_process";
import { promisify } from "node:util";

const runFile = promisify(execFile);

export type MacDisplayFrame = {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type MacWindowFrame = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type MacWindowSetupOptions = {
  pid?: number;
  processName?: string;
  previousPids?: number[];
  excludeProcessArguments?: string[];
  displayId?: number;
  width: number;
  height: number;
  margin?: number;
  placement?: "center";
};

export type MacWindowSetupResult = {
  pid: number;
  display: MacDisplayFrame;
  frame: MacWindowFrame;
  margins: { left: number; top: number; right: number; bottom: number };
  frontmost: true;
  fullyVisible: true;
};

export async function listMacDisplays(): Promise<MacDisplayFrame[]> {
  const script = `ObjC.import("AppKit"); JSON.stringify($.NSScreen.screens.js.map(function(s,i){var f=s.frame; return {id:i,x:Number(f.origin.x),y:Number(f.origin.y),width:Number(f.size.width),height:Number(f.size.height)};}))`;
  const { stdout } = await runFile("/usr/bin/osascript", ["-l", "JavaScript", "-e", script]);
  const screens = JSON.parse(stdout) as MacDisplayFrame[];
  if (!screens.length) throw new Error("macOS reported no active displays");
  const mainHeight = screens[0].height;
  return screens.map((screen) => ({
    ...screen,
    // NSScreen uses a bottom-left origin; AX uses the main display's top-left.
    y: mainHeight - screen.y - screen.height,
  }));
}

export async function snapshotProcessIds(
  processName: string,
  excludeArguments: string[] = [],
): Promise<number[]> {
  try {
    const { stdout } = await runFile("/usr/bin/pgrep", ["-x", processName]);
    const candidates = stdout.trim().split(/\s+/).filter(Boolean).map(Number).filter(Number.isFinite);
    const accepted: number[] = [];
    for (const pid of candidates) {
      const { stdout: argumentsText } = await runFile("/bin/ps", ["-p", String(pid), "-o", "args="]);
      if (!excludeArguments.some((value) => argumentsText.includes(value))) accepted.push(pid);
    }
    return accepted;
  } catch (error) {
    if ((error as { code?: unknown }).code === 1) return [];
    throw error;
  }
}

export async function setupMacWindow(options: MacWindowSetupOptions): Promise<MacWindowSetupResult> {
  const displays = await listMacDisplays();
  const display = displays.find((entry) => entry.id === (options.displayId ?? 0));
  if (!display) throw new Error(`Unknown displayId ${options.displayId ?? 0}`);
  const margin = options.margin ?? 40;
  const frame = centeredWindowFrame(display, options.width, options.height, margin);
  const placed = options.pid !== undefined
    ? { pid: options.pid, stdout: await placeWindowWhenReady(options.pid, frame, 15_000) }
    : await placeNamedWindowWhenReady(
        options.processName,
        options.previousPids ?? [],
        options.excludeProcessArguments ?? [],
        frame,
        15_000,
      );
  const { pid, stdout } = placed;
  const actual = parseWindowFrame(stdout);
  const margins = windowMargins(display, actual);
  if (actual.width !== frame.width || actual.height !== frame.height) {
    throw new Error(`Window size is ${actual.width}x${actual.height}; expected ${frame.width}x${frame.height}`);
  }
  if (Object.values(margins).some((value) => value < margin)) {
    throw new Error(`Window is not fully visible with ${margin}px margin: ${JSON.stringify({ actual, display, margins })}`);
  }
  await runFile("/usr/bin/osascript", [
    "-e", `tell application "System Events" to tell first process whose unix id is ${pid} to if frontmost is false then error "target is not foreground"`,
  ]);
  return { pid, display, frame: actual, margins, frontmost: true, fullyVisible: true };
}

export function isMacAccessibilityPermissionError(error: unknown): boolean {
  const candidate = error as {
    message?: unknown;
    stderr?: unknown;
    cause?: unknown;
  };
  const text = [candidate?.message, candidate?.stderr]
    .filter((value): value is string => typeof value === "string")
    .join("\n");
  return /-25211|not allowed assistive access|not authorized to send apple events|不允许辅助访问/i.test(text)
    || (candidate?.cause !== undefined && isMacAccessibilityPermissionError(candidate.cause));
}

export function centeredWindowFrame(
  display: MacDisplayFrame,
  width: number,
  height: number,
  margin = 40,
): MacWindowFrame {
  for (const [name, value] of Object.entries({ width, height, margin })) {
    if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer`);
  }
  if (width + margin * 2 > display.width || height + margin * 2 > display.height) {
    throw new Error(`Window ${width}x${height} does not fit display ${display.id} with ${margin}px margin`);
  }
  return {
    x: display.x + Math.floor((display.width - width) / 2),
    y: display.y + Math.floor((display.height - height) / 2),
    width,
    height,
  };
}

function windowMargins(display: MacDisplayFrame, frame: MacWindowFrame) {
  return {
    left: frame.x - display.x,
    top: frame.y - display.y,
    right: display.x + display.width - frame.x - frame.width,
    bottom: display.y + display.height - frame.y - frame.height,
  };
}

async function placeWindowWhenReady(
  pid: number,
  frame: MacWindowFrame,
  timeoutMs: number,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  do {
    try {
      return await placeWindowOnce(pid, frame);
    } catch (error) {
      throwIfAccessibilityDenied(error);
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  } while (Date.now() < deadline);
  throw new Error(`Target process ${pid} did not expose a setup-ready window within ${timeoutMs}ms`, {
    cause: lastError,
  });
}

async function placeNamedWindowWhenReady(
  processName: string | undefined,
  previousPids: number[],
  excludeArguments: string[],
  frame: MacWindowFrame,
  timeoutMs: number,
): Promise<{ pid: number; stdout: string }> {
  if (!processName) throw new Error("Window setup requires pid or processName");
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  do {
    const current = await snapshotProcessIds(processName, excludeArguments);
    const fresh = current.filter((pid) => !previousPids.includes(pid));
    const candidates = fresh.length ? fresh : previousPids.length ? [] : current;
    for (const pid of candidates) {
      try {
        return { pid, stdout: await placeWindowOnce(pid, frame) };
      } catch (error) {
        throwIfAccessibilityDenied(error);
        lastError = error;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  throw new Error(
    `No new ${processName} process exposed a setup-ready window within ${timeoutMs}ms`,
    { cause: lastError },
  );
}

function throwIfAccessibilityDenied(error: unknown): void {
  if (!isMacAccessibilityPermissionError(error)) return;
  throw new Error(
    "macOS denied Accessibility access to /usr/bin/osascript; enable it in System Settings > Privacy & Security > Accessibility before window setup",
    { cause: error },
  );
}

async function placeWindowOnce(pid: number, frame: MacWindowFrame): Promise<string> {
  const { stdout } = await runFile("/usr/bin/osascript", [
    "-e", `tell application "System Events" to tell first process whose unix id is ${pid}`,
    "-e", "set targetWindow to missing value",
    "-e", "repeat with candidateWindow in windows",
    "-e", "try",
    "-e", 'if (subrole of candidateWindow as text) is "AXStandardWindow" then',
    "-e", "set targetWindow to candidateWindow",
    "-e", "exit repeat",
    "-e", "end if",
    "-e", "end try",
    "-e", "end repeat",
    "-e", "if targetWindow is missing value then error \"target standard window is not ready\"",
    "-e", `set size of targetWindow to {${frame.width}, ${frame.height}}`,
    "-e", `set position of targetWindow to {${frame.x}, ${frame.y}}`,
    "-e", 'perform action "AXRaise" of targetWindow',
    "-e", "set frontmost to true",
    "-e", "return (position of targetWindow) & (size of targetWindow)",
    "-e", "end tell",
  ]);
  const actual = parseWindowFrame(stdout);
  if (!sameWindowFrame(actual, frame)) {
    throw new Error(
      `Window has not settled at ${JSON.stringify(frame)}; observed ${JSON.stringify(actual)}`,
    );
  }
  return stdout;
}

export function sameWindowFrame(actual: MacWindowFrame, expected: MacWindowFrame): boolean {
  return actual.x === expected.x
    && actual.y === expected.y
    && actual.width === expected.width
    && actual.height === expected.height;
}

function parseWindowFrame(stdout: string): MacWindowFrame {
  const values = stdout.trim().split(/,\s*/).map(Number);
  if (values.length !== 4 || values.some((value) => !Number.isFinite(value))) {
    throw new Error(`Unable to parse window frame: ${JSON.stringify(stdout.trim())}`);
  }
  const [x, y, width, height] = values;
  return { x, y, width, height };
}
