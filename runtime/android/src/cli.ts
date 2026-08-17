#!/usr/bin/env node
import { compileAndroidPrimitivesFile } from "./primitive-compiler.js";
import { runAndroidScripts } from "./runner.js";
import { AndroidSession } from "./session.js";
import { executeAndroidPlan, loadAndroidPlan } from "./executor.js";

const args = process.argv.slice(2);
const command = args.shift();
if (command === "doctor") {
  const android = await AndroidSession.connect(parseSession(args));
  try {
    console.log(
      JSON.stringify(
        {
          ok: true,
          serial: android.serial,
          viewport: await android.device.size(),
        },
        null,
        2,
      ),
    );
  } finally {
    await android.close();
  }
} else if (command === "source") {
  const android = await AndroidSession.connect(parseSession(args));
  try {
    console.log(await android.source());
  } finally {
    await android.close();
  }
} else if (command === "compile-primitives") {
  const input = required(args.shift(), "recording or segment");
  const outputIndex = args.indexOf("--output");
  if (outputIndex < 0)
    throw new Error("compile-primitives requires --output <file>");
  console.log(
    JSON.stringify(
      await compileAndroidPrimitivesFile(
        input,
        required(args[outputIndex + 1], "output"),
      ),
      null,
      2,
    ),
  );
} else if (command === "run") {
  const separator = args.indexOf("--");
  const scripts = args
    .slice(0, separator < 0 ? undefined : separator)
    .filter((item) => !item.startsWith("--"));
  await runAndroidScripts(scripts, {
    args: separator < 0 ? [] : args.slice(separator + 1),
    session: parseSession(args),
  });
} else if (command === "replay") {
  // Execute a compiled plan.json many times over. Result is checkpoint-centric:
  // a pass says nothing; a failure names the important checkpoint not reached.
  const planPath = args.find((value) => !value.startsWith("--"));
  if (!planPath) throw new Error("replay requires <plan.json> [--from-segment <id>]");
  const plan = await loadAndroidPlan(planPath);
  const report = await executeAndroidPlan(plan, {
    fromSegmentId: optionValue("--from-segment"),
    session: parseSession(args),
  });
  console.log(JSON.stringify(report.result, null, 2));
  if (report.result.status === "failed") process.exitCode = 2;
} else {
  console.log(
    "Usage: actonce-android doctor|source [--serial id] [--adb-path path]\n       actonce-android compile-primitives <recording> --output <file>\n       actonce-android run <script...> [-- args...]\n       actonce-android replay <plan.json> [--from-segment <id>]",
  );
  if (command && command !== "help" && command !== "--help")
    process.exitCode = 2;
}
function optionValue(name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}
function parseSession(values: string[]) {
  const options: { serial?: string; androidAdbPath?: string } = {};
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] === "--serial") options.serial = values[++index];
    else if (values[index] === "--adb-path")
      options.androidAdbPath = values[++index];
  }
  return options;
}
function required(value: string | undefined, label: string): string {
  if (!value) throw new Error(`Missing ${label}`);
  return value;
}
