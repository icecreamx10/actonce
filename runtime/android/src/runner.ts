import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  createAndroidReplayFlow,
  type AndroidReplayFlowOptions,
} from "./checkpoint.js";
import { AndroidSession } from "./session.js";
import type {
  AndroidReplayModule,
  AndroidReplayScript,
  AndroidSessionOptions,
} from "./types.js";

export async function runAndroidScripts(
  scriptPaths: string[],
  options: {
    session?: AndroidSessionOptions;
    args?: string[];
    replay?: AndroidReplayFlowOptions;
  } = {},
): Promise<void> {
  if (!scriptPaths.length)
    throw new Error("At least one replay script is required");
  const modules = await Promise.all(scriptPaths.map(load));
  const session = mergeAndroidConfigs([
    ...modules.map((item) => item.module.config),
    options.session,
  ]);
  const android = await AndroidSession.connect(session);
  try {
    const flow = createAndroidReplayFlow(android, options.replay);
    for (let index = 0; index < modules.length; index += 1)
      await modules[index].run({
        android,
        flow,
        args: options.args ?? [],
        scriptPath: modules[index].path,
        scriptIndex: index,
      });
  } finally {
    await android.close();
  }
}
async function load(
  path: string,
): Promise<{
  path: string;
  module: AndroidReplayModule;
  run: AndroidReplayScript;
}> {
  const absolute = resolve(path);
  const module = (await import(
    pathToFileURL(absolute).href
  )) as AndroidReplayModule;
  const run = module.default ?? module.run;
  if (typeof run !== "function")
    throw new Error(`${absolute} must export a default or named run function`);
  return { path: absolute, module, run };
}
export function mergeAndroidConfigs(
  configs: Array<AndroidSessionOptions | undefined>,
): AndroidSessionOptions {
  const result: AndroidSessionOptions = {};
  for (const config of configs)
    for (const [key, value] of Object.entries(config ?? {})) {
      const current = (result as Record<string, unknown>)[key];
      if (current !== undefined && current !== value)
        throw new Error(
          `Conflicting Android session config.${key}: ${String(current)} vs ${String(value)}`,
        );
      (result as Record<string, unknown>)[key] = value;
    }
  return result;
}
