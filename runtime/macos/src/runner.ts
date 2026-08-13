import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { MacSession } from "./session.js";
import { createMacReplayFlow, type MacReplayFlowOptions } from "./checkpoint.js";
import {
  setupMacWindow,
  snapshotProcessIds,
  type MacWindowSetupOptions,
} from "./window-setup.js";
import type {
  MacReplayModule,
  MacReplayScript,
  MacSessionOptions,
} from "./types.js";

export type RunScriptsOptions = {
  session?: MacSessionOptions;
  args?: string[];
  replay?: MacReplayFlowOptions;
  windowSetup?: MacWindowSetupOptions;
};

export async function runScripts(
  scriptPaths: string[],
  options: RunScriptsOptions = {},
): Promise<void> {
  if (!scriptPaths.length) throw new Error("At least one replay script is required");
  const modules = await Promise.all(scriptPaths.map(loadReplayModule));
  const sessionOptions = mergeConfigs([
    ...modules.map((entry) => entry.module.config),
    options.session,
  ]);
  const windowSetupOptions = options.windowSetup?.processName
    && options.windowSetup.previousPids === undefined
    ? {
        ...options.windowSetup,
        previousPids: await snapshotProcessIds(
          options.windowSetup.processName,
          options.windowSetup.excludeProcessArguments,
        ),
      }
    : options.windowSetup;
  const mac = await MacSession.connect(sessionOptions);
  try {
    const windowSetup = windowSetupOptions
      ? await setupMacWindow(windowSetupOptions)
      : undefined;
    const flow = createMacReplayFlow(mac, options.replay);
    for (let index = 0; index < modules.length; index += 1) {
      const entry = modules[index];
      await entry.run({
        mac,
        driver: mac.driver,
        args: options.args ?? [],
        scriptPath: entry.path,
        scriptIndex: index,
        flow,
        windowSetup,
      });
    }
  } finally {
    await mac.close();
  }
}

async function loadReplayModule(path: string): Promise<{
  path: string;
  module: MacReplayModule;
  run: MacReplayScript;
}> {
  const absolute = resolve(path);
  const module = (await import(pathToFileURL(absolute).href)) as MacReplayModule;
  const run = module.default ?? module.run;
  if (typeof run !== "function") {
    throw new Error(`${absolute} must export a default or named run function`);
  }
  return { path: absolute, module, run };
}

export function mergeConfigs(
  configs: Array<MacSessionOptions | undefined>,
): MacSessionOptions {
  let result: MacSessionOptions = {};
  for (const config of configs) {
    if (!config) continue;
    result = deepMerge(result, config, "config") as MacSessionOptions;
  }
  return result;
}

function deepMerge(left: unknown, right: unknown, path: string): unknown {
  if (right === undefined) return left;
  if (left === undefined) return right;
  if (isRecord(left) && isRecord(right)) {
    const result: Record<string, unknown> = { ...left };
    for (const [key, value] of Object.entries(right)) {
      result[key] = deepMerge(result[key], value, `${path}.${key}`);
    }
    return result;
  }
  if (JSON.stringify(left) !== JSON.stringify(right)) {
    throw new Error(`Conflicting replay session ${path}: ${JSON.stringify(left)} vs ${JSON.stringify(right)}`);
  }
  return left;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
