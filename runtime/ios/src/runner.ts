import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createIOSReplayFlow, type IOSReplayFlowOptions } from "./checkpoint.js";
import { IOSSession } from "./session.js";
import type { IOSReplayModule, IOSReplayScript, IOSSessionOptions } from "./types.js";

export async function runIOSScripts(scriptPaths: string[], options: { session?: IOSSessionOptions; args?: string[]; replay?: IOSReplayFlowOptions } = {}): Promise<void> {
  if (!scriptPaths.length) throw new Error("At least one replay script is required");
  const modules = await Promise.all(scriptPaths.map(load));
  const session = mergeIOSConfigs([...modules.map((item) => item.module.config), options.session]);
  const ios = await IOSSession.connect(session);
  try {
    const flow = createIOSReplayFlow(ios, options.replay);
    for (let index = 0; index < modules.length; index += 1) await modules[index].run({ ios, flow, args: options.args ?? [], scriptPath: modules[index].path, scriptIndex: index });
  } finally { await ios.close(); }
}
async function load(path: string): Promise<{ path: string; module: IOSReplayModule; run: IOSReplayScript }> {
  const absolute = resolve(path); const module = await import(pathToFileURL(absolute).href) as IOSReplayModule; const run = module.default ?? module.run;
  if (typeof run !== "function") throw new Error(`${absolute} must export a default or named run function`);
  return { path: absolute, module, run };
}
export function mergeIOSConfigs(configs: Array<IOSSessionOptions | undefined>): IOSSessionOptions {
  const result: IOSSessionOptions = {};
  for (const config of configs) for (const [key, value] of Object.entries(config ?? {})) {
    const current = (result as Record<string, unknown>)[key];
    if (current !== undefined && current !== value) throw new Error(`Conflicting iOS session config.${key}: ${String(current)} vs ${String(value)}`);
    (result as Record<string, unknown>)[key] = value;
  }
  return result;
}
