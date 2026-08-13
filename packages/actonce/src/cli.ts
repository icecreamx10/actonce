#!/usr/bin/env node
import { cp, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";

const args = process.argv.slice(2);
const command = args.shift();

if (command === "record") await forward("actonce-record", args);
else if (command === "macos") await forward("actonce-macos", args);
else if (command === "ios") await forward("actonce-ios", args);
else if (command === "skill" && args.shift() === "install") await installSkill(args);
else usage(command ? 2 : 0);

async function forward(binary: string, values: string[]) {
  const child = spawn(binary, values, { stdio: "inherit", shell: process.platform === "win32" });
  const code = await new Promise<number>((resolve) => child.once("exit", (value) => resolve(value ?? 1)));
  process.exitCode = code;
}

async function installSkill(values: string[]) {
  const name = values[0];
  if (name !== "record-device-use" && name !== "compile-device-recording") usage(2);
  const targetIndex = values.indexOf("--target");
  const targetRoot = targetIndex >= 0 ? values[targetIndex + 1] : join(process.env.CODEX_HOME ?? join(homedir(), ".codex"), "skills");
  if (!targetRoot) throw new Error("--target requires a directory");
  const packageName = `@byted-lynx/actonce-skill-${name}`;
  const skillFile = createRequire(import.meta.url).resolve(`${packageName}/SKILL.md`);
  const source = dirname(skillFile);
  const destination = join(targetRoot, name);
  await mkdir(destination, { recursive: true });
  for (const entry of ["SKILL.md", "agents", "references", "scripts"]) {
    await cp(join(source, entry), join(destination, entry), { recursive: true, force: true });
  }
  console.log(destination);
}

function usage(code: number): never {
  console.log(`ActOnce

Usage:
  actonce record <profiles|record> [...args]
  actonce macos <command> [...args]
  actonce ios <command> [...args]
  actonce skill install <record-device-use|compile-device-recording> [--target <dir>]`);
  process.exit(code);
}
