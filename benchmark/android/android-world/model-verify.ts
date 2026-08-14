import { spawn } from "node:child_process";
import {
  modelProfileProvenance,
  requireAndroidWorldModelProfile,
  type AndroidWorldModelProfile,
} from "./model-profile.js";

const profileName = parseArgs(process.argv.slice(2));
const profile = requireAndroidWorldModelProfile(profileName);
console.log(JSON.stringify({ verifying: modelProfileProvenance(profileName) }, null, 2));

const code = await new Promise<number | null>((resolveRun, reject) => {
  const child = spawn("npm", ["run", "model:verify"], {
    cwd: process.cwd(),
    env: { ...process.env, ...profile.env },
    stdio: "inherit",
  });
  child.once("error", reject);
  child.once("exit", resolveRun);
});
if (code !== 0) process.exitCode = code ?? 1;

function parseArgs(values: string[]): AndroidWorldModelProfile {
  let profile: AndroidWorldModelProfile = "codex-luna";
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] === "--model-profile") profile = values[++index] as AndroidWorldModelProfile;
    else throw new Error(`Unknown argument: ${values[index]}`);
  }
  requireAndroidWorldModelProfile(profile);
  return profile;
}
