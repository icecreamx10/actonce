import { createHash } from "node:crypto";
import { readFile, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type FixtureProvenance = {
  archive: string;
  archiveSha256: string;
};

export type ResetFixtureResult = {
  fixtureRoot: string;
  desktopBundle: string;
  configPath: string;
  temporaryDirectory: string;
};

const benchmarkDir = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(benchmarkDir, "../../..");

/** Rebuild every mutable Fiddle input before either original or replay starts. */
export async function resetBenchmarkFixture(outputDirectory: string): Promise<ResetFixtureResult> {
  const output = resolve(outputDirectory);
  const provenance = JSON.parse(
    await readFile(join(benchmarkDir, "fixture/provenance.json"), "utf8"),
  ) as FixtureProvenance;
  const archive = join(benchmarkDir, "fixture", provenance.archive);
  const archiveBytes = await readFile(archive);
  const actualSha256 = createHash("sha256").update(archiveBytes).digest("hex");
  if (actualSha256 !== provenance.archiveSha256) {
    throw new Error(
      `Fixture archive checksum mismatch: expected ${provenance.archiveSha256}, got ${actualSha256}`,
    );
  }

  const fixtureRoot = join(
    repositoryRoot,
    ".cache/benchmarks/lynxtron-fiddle",
    provenance.archiveSha256.slice(0, 12),
  );
  const desktopBundle = join(fixtureRoot, "desktop");
  const configPath = join(output, "fixture-config.json");
  const temporaryDirectory = join(output, "fixture-tmp");

  // These targets are benchmark-owned and fully derived from the pinned archive.
  await rm(fixtureRoot, { recursive: true, force: true });
  await rm(temporaryDirectory, { recursive: true, force: true });
  await mkdir(fixtureRoot, { recursive: true });
  await mkdir(temporaryDirectory, { recursive: true });
  await extractArchive(archive, fixtureRoot);
  await linkPinnedTypeScript(desktopBundle);
  await linkPinnedPackage(desktopBundle, "@lynx-js/lynxtron");
  await patchConfigPath(desktopBundle);
  await writeFreshConfig(configPath);

  return { fixtureRoot, desktopBundle, configPath, temporaryDirectory };
}

async function extractArchive(archive: string, destination: string): Promise<void> {
  const { execFile } = await import("node:child_process");
  await new Promise<void>((resolveExec, rejectExec) => {
    execFile("/usr/bin/tar", ["-xzf", archive, "-C", destination], (error) =>
      error ? rejectExec(error) : resolveExec(),
    );
  });
}

async function linkPinnedTypeScript(desktopBundle: string): Promise<void> {
  await linkPinnedPackage(desktopBundle, "typescript");
}

async function linkPinnedPackage(desktopBundle: string, packageName: string): Promise<void> {
  const source = join(benchmarkDir, "node_modules", packageName);
  const target = join(desktopBundle, "node_modules", packageName);
  await rm(target, { recursive: true, force: true });
  await mkdir(dirname(target), { recursive: true });
  await symlink(source, target, "dir");
}

async function patchConfigPath(desktopBundle: string): Promise<void> {
  const preloadPath = join(desktopBundle, "preload.js");
  const original =
    'D=k().join(_().homedir(),".lynxtron-ide.".concat(T,".json"))';
  const isolated =
    'D=process.env.ACTONCE_LYNXTRON_CONFIG_PATH||k().join(_().homedir(),".lynxtron-ide.".concat(T,".json"))';
  const source = await readFile(preloadPath, "utf8");
  if (!source.includes(original)) {
    throw new Error("Pinned Lynxtron preload config hook no longer matches the fixture");
  }
  await writeFile(preloadPath, source.replace(original, isolated), "utf8");
}

async function writeFreshConfig(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(
    path,
    `${JSON.stringify(
      {
        "fiddle.settings": {
          theme: "dark",
          fontSize: 13,
          blockAccelerators: false,
          runtimeFlags: "",
          githubToken: "",
          showWelcomeTour: false,
        },
        "fiddle.tour.seen": true,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}
