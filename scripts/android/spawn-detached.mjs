import { spawn } from "node:child_process";
import { once } from "node:events";
import { closeSync, openSync } from "node:fs";

// The background emulator must not share the launching terminal's process group.
// Foreground mode is deliberately still owned by the calling coordinator.
const [logPath, executable, ...args] = process.argv.slice(2);
if (!logPath || !executable) throw new Error("Usage: spawn-detached.mjs <log> <executable> [args...]");
const log = openSync(logPath, "w", 0o600);
try {
  const child = spawn(executable, args, { detached: true, stdio: ["ignore", log, log] });
  await once(child, "spawn");
  child.unref();
  process.stdout.write(`${child.pid}\n`);
} finally {
  closeSync(log);
}
