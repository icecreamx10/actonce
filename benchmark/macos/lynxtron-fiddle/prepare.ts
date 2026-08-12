import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type Provenance = {
  platform: string;
  architecture: string;
  lynxtronVersion: string;
  lynxtronDownloadUrl: string;
  lynxtronArchiveSha256: string;
};

const benchmarkDir = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(benchmarkDir, "../../..");
const provenance = JSON.parse(
  await readFile(join(benchmarkDir, "fixture/provenance.json"), "utf8"),
) as Provenance;

if (process.platform !== provenance.platform || process.arch !== provenance.architecture) {
  throw new Error(
    `Lynxtron benchmark requires ${provenance.platform}/${provenance.architecture}; current host is ${process.platform}/${process.arch}`,
  );
}

// The upstream postinstall currently hangs while extracting the macOS framework.
// Install the exact npm graph without lifecycle scripts, then fetch and verify the
// exact official host archive ourselves and extract it with macOS ditto.
await exec("npm", ["ci", "--ignore-scripts", "--prefix", benchmarkDir], repositoryRoot);

const hostRoot = join(
  repositoryRoot,
  ".cache/benchmarks/lynxtron-host",
  `${provenance.lynxtronVersion}-${provenance.lynxtronArchiveSha256.slice(0, 12)}`,
);
const executable = join(hostRoot, "Lynxtron.app/Contents/MacOS/lynxtron");

try {
  await access(executable, constants.X_OK);
  console.log(`Lynxtron ${provenance.lynxtronVersion} is ready at ${hostRoot}`);
  process.exit(0);
} catch {
  await rm(hostRoot, { recursive: true, force: true });
}

const response = await fetch(provenance.lynxtronDownloadUrl);
if (!response.ok) {
  throw new Error(
    `Failed to download Lynxtron: ${response.status} ${response.statusText}`,
  );
}
const archiveBytes = Buffer.from(await response.arrayBuffer());
const actualSha256 = createHash("sha256").update(archiveBytes).digest("hex");
if (actualSha256 !== provenance.lynxtronArchiveSha256) {
  throw new Error(
    `Lynxtron archive checksum mismatch: expected ${provenance.lynxtronArchiveSha256}, got ${actualSha256}`,
  );
}

await mkdir(hostRoot, { recursive: true });
const archivePath = join(hostRoot, "lynxtron.zip");
await writeFile(archivePath, archiveBytes);
try {
  await exec("/usr/bin/ditto", ["-x", "-k", archivePath, hostRoot], repositoryRoot);
} finally {
  await rm(archivePath, { force: true });
}
await chmod(executable, 0o755);
console.log(`Lynxtron ${provenance.lynxtronVersion} is ready at ${hostRoot}`);

function exec(command: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolveExec, rejectExec) => {
    const child = execFile(command, args, { cwd });
    child.stdout?.pipe(process.stdout);
    child.stderr?.pipe(process.stderr);
    child.once("error", rejectExec);
    child.once("exit", (code, signal) => {
      if (code === 0) resolveExec();
      else rejectExec(new Error(`${command} exited with code=${code}, signal=${signal}`));
    });
  });
}
