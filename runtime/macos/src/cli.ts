#!/usr/bin/env node
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { doctor } from "./doctor.js";
import { compileMacPrimitivesFile } from "./primitive-compiler.js";
import {
  compileMacObservationPlanFile,
  validateMacObservationDecisionsFile,
} from "./observation-compiler.js";
import { runScripts } from "./runner.js";
import { MacSession } from "./session.js";
import type { MacFallbackPluginModule } from "./checkpoint.js";
import type { MacSessionOptions } from "./types.js";
import type { MacWindowSetupOptions } from "./window-setup.js";

const args = process.argv.slice(2);
const command = args[0];

if (command === "doctor") {
  const report = await doctor();
  if (args.includes("--json")) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    for (const check of report.checks) {
      const marker = check.status === "pass" ? "✓" : check.status === "warn" ? "!" : "✗";
      console.log(`${marker} ${check.id}: ${check.message}`);
      if (check.fix) console.log(`  ${check.fix}`);
    }
  }
  if (!report.ok) process.exitCode = 1;
} else if (command === "compile-primitives") {
  const input = args[1];
  const outputIndex = args.indexOf("--output");
  const output = outputIndex >= 0 ? args[outputIndex + 1] : undefined;
  if (!input || !output) throw new Error("compile-primitives requires <recording-or-segment> --output <script.js>");
  const result = await compileMacPrimitivesFile(input, output);
  console.log(JSON.stringify({
    output: result.output,
    primitiveCount: result.primitiveCount,
    omittedNestedCount: result.omittedNestedCount,
    sequenceRange: result.sequenceRange,
  }, null, 2));
} else if (command === "plan-observations") {
  const input = args[1];
  const output = optionValue(args, "--output");
  if (!input || !output) throw new Error("plan-observations requires <recording-or-segment> --output <plan.json>");
  const from = optionalInteger(args, "--from");
  const to = optionalInteger(args, "--to");
  if ((from === undefined) !== (to === undefined)) throw new Error("--from and --to must be provided together");
  const result = await compileMacObservationPlanFile(input, output,
    from === undefined ? undefined : { from, to: to! });
  console.log(JSON.stringify({ output: resolve(output), status: result.status, observationCount: result.observations.length }, null, 2));
  if (result.status === "uncompilable") process.exitCode = 2;
} else if (command === "validate-observations") {
  const input = args[1];
  const decisions = optionValue(args, "--decisions");
  if (!input || !decisions) throw new Error("validate-observations requires <recording-or-segment> --decisions <decision.json>");
  console.log(JSON.stringify(await validateMacObservationDecisionsFile(input, decisions), null, 2));
} else if (command === "run") {
  const parsed = parseSessionAndFiles(args.slice(1));
  const plugin = parsed.fallbackModule
    ? await loadFallbackPlugin(parsed.fallbackModule)
    : undefined;
  try {
    await runScripts(parsed.files, {
      session: parsed.session,
      args: parsed.scriptArgs,
      windowSetup: parsed.windowSetup,
      replay: plugin
        ? { policy: "recover", fallback: plugin.driver }
        : { policy: "disabled" },
    });
  } finally {
    await plugin?.close?.();
  }
} else if (command === "source") {
  const parsed = parseSessionAndFiles(args.slice(1));
  const mac = await MacSession.connect(parsed.session);
  try {
    console.log(await mac.source());
  } finally {
    await mac.close();
  }
} else {
  printUsage();
  if (command && command !== "help" && command !== "--help") process.exitCode = 2;
}

function parseSessionAndFiles(values: string[]) {
  const separator = values.indexOf("--");
  const commandValues = values.slice(0, separator < 0 ? undefined : separator);
  const scriptArgs = separator < 0 ? [] : values.slice(separator + 1);
  const session: MacSessionOptions = {};
  const files: string[] = [];
  let fallbackModule: string | undefined;
  let windowSetup: Partial<MacWindowSetupOptions> | undefined;
  for (let index = 0; index < commandValues.length; index += 1) {
    const token = commandValues[index];
    if (!token.startsWith("--")) {
      files.push(token);
      continue;
    }
    if (token === "--external-server") {
      session.server = { ...session.server, start: false };
      continue;
    }
    if (token === "--no-reset") {
      session.noReset = true;
      continue;
    }
    if (token === "--skip-app-kill") {
      session.skipAppKill = true;
      continue;
    }
    const value = commandValues[++index];
    if (value === undefined) throw new Error(`${token} requires a value`);
    if (token === "--bundle-id") session.bundleId = value;
    else if (token === "--app-path") session.appPath = value;
    else if (token === "--host") session.server = { ...session.server, hostname: value };
    else if (token === "--port") session.server = { ...session.server, port: parsePort(value) };
    else if (token === "--appium-log") session.server = { ...session.server, logPath: value };
    else if (token === "--fallback-module") fallbackModule = resolve(value);
    else if (token === "--setup-window-pid") {
      windowSetup = { ...windowSetup, pid: parseNonNegativeInteger(value, token) };
    } else if (token === "--setup-window-process-name") {
      windowSetup = { ...windowSetup, processName: value };
    } else if (token === "--setup-display-id") {
      windowSetup = { ...windowSetup, displayId: parseNonNegativeInteger(value, token) };
    } else if (token === "--setup-window-width") {
      windowSetup = { ...windowSetup, width: parsePositiveInteger(value, token) };
    } else if (token === "--setup-window-height") {
      windowSetup = { ...windowSetup, height: parsePositiveInteger(value, token) };
    } else if (token === "--setup-window-margin") {
      windowSetup = { ...windowSetup, margin: parseNonNegativeInteger(value, token) };
    }
    else throw new Error(`Unknown option: ${token}`);
  }
  return {
    session,
    files,
    scriptArgs,
    fallbackModule,
    windowSetup: validateRunWindowSetup(windowSetup),
  };
}

function validateRunWindowSetup(
  options: Partial<MacWindowSetupOptions> | undefined,
): MacWindowSetupOptions | undefined {
  if (!options) return undefined;
  if ((options.pid === undefined) === (options.processName === undefined)) {
    throw new Error("run window setup requires exactly one of --setup-window-pid or --setup-window-process-name");
  }
  if (options.width === undefined || options.height === undefined) {
    throw new Error("run window setup requires --setup-window-width and --setup-window-height");
  }
  return {
    ...options,
    displayId: options.displayId ?? 0,
    margin: options.margin ?? 40,
    placement: "center",
  } as MacWindowSetupOptions;
}

async function loadFallbackPlugin(path: string) {
  const module = await import(pathToFileURL(path).href) as Partial<MacFallbackPluginModule>;
  if (typeof module.createFallback !== "function") {
    throw new Error(`${path} must export createFallback()`);
  }
  const plugin = await module.createFallback();
  if (!plugin || typeof plugin.driver?.recover !== "function") {
    throw new Error(`${path} createFallback() must return { driver }`);
  }
  return plugin;
}

function parsePort(value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Invalid port: ${value}`);
  return port;
}

function parseNonNegativeInteger(value: string, option: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${option} requires a non-negative integer`);
  return parsed;
}

function parsePositiveInteger(value: string, option: string): number {
  const parsed = parseNonNegativeInteger(value, option);
  if (parsed < 1) throw new Error(`${option} requires a positive integer`);
  return parsed;
}

function optionValue(values: string[], option: string): string | undefined {
  const index = values.indexOf(option);
  return index >= 0 ? values[index + 1] : undefined;
}

function optionalInteger(values: string[], option: string): number | undefined {
  const value = optionValue(values, option);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${option} requires a non-negative integer`);
  return parsed;
}

function printUsage() {
  console.log(`@byted-lynx/actonce-macos

Usage:
  actonce-macos doctor [--json]
  actonce-macos compile-primitives <recording-dir|segment.json|events.ndjson> --output <script.js>
  actonce-macos plan-observations <recording-dir|segment.json|events.ndjson> --output <plan.json> [--from n --to n]
  actonce-macos validate-observations <recording-dir|segment.json|events.ndjson> --decisions <decision.json>
  actonce-macos source [--bundle-id id] [session options]
  actonce-macos run [session options] [window setup options] [--fallback-module module.js] <script.js...> [-- script args...]

Session options:
  --bundle-id <id>
  --app-path <path>
  --host <host>
  --port <port>
  --appium-log <path>
  --external-server
  --no-reset
  --skip-app-kill`);
  console.log(`
Window setup options for run:
  --setup-window-process-name <name> | --setup-window-pid <pid>
  --setup-display-id <id>
  --setup-window-width <points>
  --setup-window-height <points>
  --setup-window-margin <points>`);
}
