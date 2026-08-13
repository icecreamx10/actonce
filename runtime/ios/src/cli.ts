#!/usr/bin/env node
import { IOSSession } from "./session.js";
import { runIOSScripts } from "./runner.js";
import { compileIOSPrimitivesFile } from "./primitive-compiler.js";

const args = process.argv.slice(2); const command = args.shift();
const host = option("--host") ?? process.env.ACTONCE_WDA_HOST ?? "127.0.0.1";
const port = Number(option("--port") ?? process.env.ACTONCE_WDA_PORT ?? "8100");
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Invalid WDA port: ${port}`);
if (command === "compile-primitives") {
  const input = args[0]; const output = option("--output");
  if (!input || !output) throw new Error("compile-primitives requires <recording-or-segment> --output <script.js>");
  const result = await compileIOSPrimitivesFile(input, output);
  console.log(JSON.stringify({ output: result.output, primitiveCount: result.primitiveCount, sequenceRange: result.sequenceRange }, null, 2));
} else if (command === "doctor") {
  const ios = await IOSSession.connect({ wdaHost: host, wdaPort: port });
  try { console.log(JSON.stringify({ ok: true, wda: `http://${host}:${port}`, device: await ios.device.getConnectedDeviceInfo(), screen: await ios.device.getScreenSize() }, null, 2)); } finally { await ios.close(); }
} else if (command === "source") {
  const ios = await IOSSession.connect({ wdaHost: host, wdaPort: port });
  try { console.log(await ios.source()); } finally { await ios.close(); }
} else if (command === "run") {
  const files = args.filter((value, index) => !["--host", "--port"].includes(value) && !(["--host", "--port"].includes(args[index - 1] ?? "")));
  await runIOSScripts(files, { session: { wdaHost: host, wdaPort: port }, replay: { policy: "disabled" } });
} else {
  console.log("actonce-ios <compile-primitives|doctor|source|run> [options] [scripts...]");
  if (command && command !== "help" && command !== "--help") process.exitCode = 2;
}
function option(name: string): string | undefined { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; }
