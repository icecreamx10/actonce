import { execFile } from "node:child_process";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const packageName = "net.gsantner.markor";
const mainActivity = `${packageName}/.activity.MainActivity`;
const notePath = "/sdcard/Documents/actonce-benchmark.md";

export type Point = { x: number; y: number };

export type MarkorFixtureResult = {
  serial: string;
  packageName: string;
  notePath: string;
  onboardingActions: number;
};

export function findNodeCenterByDescription(
  xml: string,
  description: string,
): Point | undefined {
  return findNodeCenterByAttribute(xml, "content-desc", description);
}

export function findNodeCenterByText(
  xml: string,
  text: string,
): Point | undefined {
  return findNodeCenterByAttribute(xml, "text", text);
}

function findNodeCenterByAttribute(
  xml: string,
  attribute: "content-desc" | "text",
  value: string,
): Point | undefined {
  const escapedValue = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const nodePattern = new RegExp(
    `<node(?=[^>]*${attribute}="${escapedValue}")(?=[^>]*bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]")[^>]*>`,
  );
  const match = xml.match(nodePattern);

  if (!match) {
    return undefined;
  }

  const [, left, top, right, bottom] = match.map(Number);
  return {
    x: Math.round((left + right) / 2),
    y: Math.round((top + bottom) / 2),
  };
}

export async function prepareMarkorFixture(): Promise<MarkorFixtureResult> {
  const adb =
    process.env.MIDSCENE_ADB_PATH ?? process.env.ACTONCE_ADB_PATH ?? "adb";
  const serial = process.env.ACTONCE_ANDROID_SERIAL ?? "emulator-5554";
  const runAdb = async (...args: string[]) =>
    execFileAsync(adb, ["-s", serial, ...args], {
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
    });

  await runAdb("get-state");
  await runAdb("shell", "pm", "path", packageName);
  await runAdb("shell", "pm", "clear", packageName);
  await runAdb(
    "shell",
    "appops",
    "set",
    packageName,
    "MANAGE_EXTERNAL_STORAGE",
    "allow",
  );
  await runAdb("shell", "mkdir", "-p", "/sdcard/Documents");
  await runAdb("shell", "rm", "-f", notePath);
  await runAdb("shell", "am", "start", "-W", "-n", mainActivity);

  let onboardingActions = 0;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await delay(250);
    const xml = await readUiHierarchy(runAdb);
    if (xml.includes('content-desc="Create a new file or folder"')) {
      break;
    }

    const nextTarget = findNodeCenterByDescription(xml, "NEXT");
    const doneTarget = findNodeCenterByText(xml, "DONE");
    const target = nextTarget ?? doneTarget;

    if (!target) {
      continue;
    }

    console.log(
      `Markor fixture: tapping onboarding action ${onboardingActions + 1} at ${target.x},${target.y}`,
    );
    await runAdb(
      "shell",
      "input",
      "tap",
      String(target.x),
      String(target.y),
    );
    onboardingActions += 1;

    if (doneTarget) {
      await delay(1_000);
      break;
    }
  }

  await runAdb("shell", "am", "force-stop", packageName);
  await runAdb("shell", "am", "start", "-W", "-n", mainActivity);
  await delay(500);

  const finalHierarchy = await readUiHierarchy(runAdb);
  if (
    !finalHierarchy.includes('package="net.gsantner.markor"') ||
    !finalHierarchy.includes('content-desc="Create a new file or folder"')
  ) {
    throw new Error("Markor did not reach the Documents list after fixture setup");
  }

  return { serial, packageName, notePath, onboardingActions };
}

type AdbRunner = (
  ...args: string[]
) => Promise<{ stdout: string; stderr: string }>;

async function readUiHierarchy(runAdb: AdbRunner): Promise<string> {
  await runAdb("shell", "rm", "-f", "/sdcard/actonce-window.xml");
  await runAdb("shell", "uiautomator", "dump", "/sdcard/actonce-window.xml");
  const { stdout } = await runAdb(
    "shell",
    "cat",
    "/sdcard/actonce-window.xml",
  );
  return stdout;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

const isEntrypoint =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntrypoint) {
  const result = await prepareMarkorFixture();
  console.log(JSON.stringify(result, null, 2));
}
