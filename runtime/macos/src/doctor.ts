import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);

export type DoctorCheck = {
  id: string;
  status: "pass" | "warn" | "fail";
  message: string;
  fix?: string;
};

export type DoctorReport = {
  ok: boolean;
  checks: DoctorCheck[];
};

export async function doctor(): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];
  if (process.platform !== "darwin") {
    checks.push({ id: "platform", status: "fail", message: `Expected macOS, found ${process.platform}` });
  } else {
    checks.push({ id: "platform", status: "pass", message: "Running on macOS" });
  }

  await commandCheck(checks, "xcode", "xcodebuild", ["-version"], "Install full Xcode 13 or newer and select its Command Line Tools.");
  await commandCheck(checks, "xcode-select", "xcode-select", ["-p"], "Run xcode-select with the full Xcode developer directory.");
  await commandCheck(
    checks,
    "accessibility",
    "osascript",
    ["-e", 'tell application "System Events" to get UI elements enabled'],
    "Grant Accessibility permission to the terminal or host application and Xcode Helper.",
    (stdout) => stdout.trim() === "true",
  );

  const manifest = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  ) as { dependencies: Record<string, string> };
  for (const dependency of ["appium", "appium-mac2-driver", "webdriverio"]) {
    try {
      require.resolve(dependency === "appium-mac2-driver" ? `${dependency}/package.json` : dependency);
      checks.push({ id: dependency, status: "pass", message: `${dependency} ${manifest.dependencies[dependency]}` });
    } catch (error) {
      checks.push({
        id: dependency,
        status: "fail",
        message: `${dependency} is unavailable: ${errorMessage(error)}`,
        fix: "Install @byted-lynx/actonce-macos dependencies with npm install.",
      });
    }
  }

  const automationMode = await optionalCommand(
    "automationmodetool",
    ["diagnose-automation-mode-without-authentication"],
  );
  if (automationMode.ok) {
    checks.push({ id: "automation-mode", status: "pass", message: "Automation Mode is configured" });
  } else {
    checks.push({
      id: "automation-mode",
      status: "warn",
      message: "macOS may request authentication when XCTest starts",
      fix: "Optionally run: automationmodetool enable-automationmode-without-authentication",
    });
  }

  return { ok: checks.every((check) => check.status !== "fail"), checks };
}

async function commandCheck(
  checks: DoctorCheck[],
  id: string,
  command: string,
  args: string[],
  fix: string,
  validate: (stdout: string) => boolean = () => true,
): Promise<void> {
  const result = await optionalCommand(command, args);
  if (result.ok && validate(result.stdout)) {
    checks.push({ id, status: "pass", message: result.stdout.trim().split("\n").join("; ") });
  } else {
    checks.push({
      id,
      status: "fail",
      message: result.ok ? `Unexpected response: ${result.stdout.trim()}` : result.error,
      fix,
    });
  }
}

async function optionalCommand(command: string, args: string[]) {
  try {
    const { stdout } = await execFileAsync(command, args, { timeout: 15_000 });
    return { ok: true as const, stdout };
  } catch (error) {
    return { ok: false as const, stdout: "", error: errorMessage(error) };
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
