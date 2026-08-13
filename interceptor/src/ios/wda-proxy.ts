import { runIOSWdaProxy } from "../recording-profiles.js";

await runIOSWdaProxy({
  rootDir: process.env.ACTONCE_RECORDINGS_DIR,
  recordingId: process.env.ACTONCE_RECORDING_ID,
  listenHost: process.env.ACTONCE_INTERCEPTOR_HOST,
  listenPort: numberFromEnvironment("ACTONCE_INTERCEPTOR_PORT"),
  upstreamHost: process.env.ACTONCE_WDA_UPSTREAM_HOST,
  upstreamPort: numberFromEnvironment("ACTONCE_WDA_UPSTREAM_PORT"),
});

function numberFromEnvironment(name: string): number | undefined {
  const value = process.env[name];
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new Error(`${name} must be an integer`);
  return parsed;
}
