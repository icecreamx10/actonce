#!/usr/bin/env node
import {
  RECORDING_PROFILES,
  recordingProfile,
  runRecordingProfile,
  type RecordingRunOptions,
} from "./recording-profiles.js";

const args = process.argv.slice(2);
const command = args[0];

if (command === "profiles") {
  if (args.includes("--json")) {
    console.log(JSON.stringify(RECORDING_PROFILES, null, 2));
  } else {
    for (const profile of RECORDING_PROFILES) {
      console.log(`${profile.id}\t${profile.description}`);
    }
  }
} else if (command === "record") {
  const profileId = args[1];
  const profile = recordingProfile(profileId ?? "");
  if (!profile) {
    throw new Error(
      `Unknown recording profile: ${profileId ?? "<missing>"}. Run 'profiles' to list profiles.`,
    );
  }
  const separator = args.indexOf("--");
  const optionArgs = args.slice(2, separator < 0 ? undefined : separator);
  const options = parseOptions(optionArgs);
  options.taskArgs = separator < 0 ? [] : args.slice(separator + 1);
  await runRecordingProfile(profile.id, options);
} else {
  printUsage();
  if (command && command !== "help" && command !== "--help") process.exitCode = 2;
}

function parseOptions(values: string[]): RecordingRunOptions {
  const options: RecordingRunOptions = {};
  for (let index = 0; index < values.length; index += 1) {
    const name = values[index];
    const value = values[index + 1];
    if (!name?.startsWith("--") || value === undefined) {
      throw new Error(`Expected --option value, received: ${name ?? "<missing>"}`);
    }
    index += 1;
    if (name === "--entry") options.entry = value;
    else if (name === "--recording-id") options.recordingId = value;
    else if (name === "--recordings-dir") options.rootDir = value;
    else if (name === "--display-id") options.displayId = value;
    else if (name === "--listen-host") options.listenHost = value;
    else if (name === "--listen-port") options.listenPort = port(value, name);
    else if (name === "--upstream-host") options.upstreamHost = value;
    else if (name === "--upstream-port") options.upstreamPort = port(value, name);
    else if (name === "--serial") options.serial = value;
    else if (name === "--adb-path") options.adbPath = value;
    else throw new Error(`Unknown option: ${name}`);
  }
  return options;
}

function port(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
    throw new Error(`${name} must be an integer between 0 and 65535`);
  }
  return parsed;
}

function printUsage(): void {
  console.log(`ActOnce recorder CLI

Usage:
  npm run interceptor:start -- profiles [--json]
  npm run interceptor:start -- record midscene-macos --entry <task.ts> [--display-id 0]
  npm run interceptor:start -- record midscene-ios --entry <task.ts> [WDA options]
  npm run interceptor:start -- record midscene-android --entry <task.ts> [--serial <adb-serial>] [--adb-path <path>]
  npm run interceptor:start -- record ios-wda [WDA options]

Common options:
  --recording-id <id>
  --recordings-dir <path>

WDA options:
  --listen-host <host>       default 127.0.0.1
  --listen-port <port>       default 8200
  --upstream-host <host>     default 127.0.0.1
  --upstream-port <port>     default 8100

Arguments after -- are passed to task modules as context.args.`);
}
