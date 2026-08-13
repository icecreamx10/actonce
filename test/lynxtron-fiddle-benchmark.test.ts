import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const benchmarkDir = join(repositoryRoot, "benchmark/macos/lynxtron-fiddle");
const provenance = JSON.parse(
  readFileSync(join(benchmarkDir, "fixture/provenance.json"), "utf8"),
) as {
  archive: string;
  archiveSha256: string;
  commit: string;
  platform: string;
  architecture: string;
  lynxtronDownloadUrl: string;
  lynxtronArchiveSha256: string;
};
const benchmarkLock = JSON.parse(
  readFileSync(join(benchmarkDir, "package-lock.json"), "utf8"),
) as { packages: Record<string, { version?: string }> };
const suite = JSON.parse(readFileSync(join(benchmarkDir, "suite.json"), "utf8")) as {
  schemaVersion: number;
  cases: string[];
};
const cliSource = readFileSync(join(benchmarkDir, "cli.ts"), "utf8");
const fixtureStateSource = readFileSync(join(benchmarkDir, "fixture-state.ts"), "utf8");
const suiteRunnerSource = readFileSync(join(benchmarkDir, "suite-runner.ts"), "utf8");
const rootPackage = JSON.parse(readFileSync(join(repositoryRoot, "package.json"), "utf8")) as {
  scripts: Record<string, string>;
};
const testCases = suite.cases.map((id) =>
  JSON.parse(readFileSync(join(benchmarkDir, "cases", `${id}.json`), "utf8")) as {
    schemaVersion: number;
    id: string;
    complexity: string;
    dimensions: string[];
    naturalLanguageTask: string;
    setup: { readyAssertion: string };
    precondition: string;
    steps: Array<{ id: string; kind: string; prompt?: string }>;
    cleanup: { mode: string; save: boolean; steps: Array<{ id: string }> };
  }
);

describe("Lynxtron Fiddle benchmark fixture", () => {
  it("defines a layered suite with unique, non-saving cases", () => {
    expect(suite.schemaVersion).toBe(1);
    expect(suite.cases).toHaveLength(5);
    expect(new Set(suite.cases).size).toBe(suite.cases.length);
    expect(testCases.map((testCase) => testCase.id)).toEqual(suite.cases);
    expect(testCases.map((testCase) => testCase.complexity)).toEqual([
      "basic",
      "intermediate",
      "advanced",
      "advanced",
      "deep",
    ]);

    for (const testCase of testCases) {
      expect(testCase.schemaVersion).toBe(1);
      expect(testCase.naturalLanguageTask.length).toBeGreaterThan(80);
      expect(testCase.dimensions.length).toBeGreaterThanOrEqual(4);
      expect(testCase.steps.length).toBeGreaterThanOrEqual(5);
      expect(testCase.cleanup.save).toBe(false);
      expect(testCase.setup.readyAssertion).toMatch(/no Welcome|no modal/i);
      const stepIds = testCase.steps.map((step) => step.id);
      expect(new Set(stepIds).size).toBe(stepIds.length);
    }

    const diagnostic = testCases[0];
    expect(diagnostic.naturalLanguageTask).toContain("red wavy underline");
    expect(diagnostic.naturalLanguageTask).toContain("Expression expected.");
    expect(diagnostic.precondition).toContain("no modal dialog is open");
    expect(diagnostic.precondition).toContain("app.whenReady");
    expect(diagnostic.precondition).toContain("LynxWindow");
    expect(diagnostic.steps.map((step) => step.id)).toEqual(
      expect.arrayContaining(["error-source-applied", "red-squiggle", "tooltip-message"]),
    );
    expect(
      testCases
        .flatMap((testCase) => testCase.steps)
        .filter((step) => step.id.includes("applied") || step.id.includes("filtered")),
    ).toHaveLength(8);
    const deepest = testCases.at(-1)!;
    expect(deepest.steps.length).toBeGreaterThanOrEqual(20);
    expect(deepest.dimensions).toContain("multi-window");
    expect(deepest.dimensions).toContain("state-recovery");
  });

  it("matches the pinned archive checksum and expected bundle structure", () => {
    const archive = join(benchmarkDir, "fixture", provenance.archive);
    const checksum = createHash("sha256")
      .update(readFileSync(archive))
      .digest("hex");
    expect(checksum).toBe(provenance.archiveSha256);
    expect(provenance.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(provenance.platform).toBe("darwin");
    expect(provenance.architecture).toBe("arm64");
    expect(provenance.lynxtronDownloadUrl).toContain(
      "/v0.0.8/lynxtron-v0.0.8-darwin-arm64.zip",
    );
    expect(provenance.lynxtronArchiveSha256).toMatch(/^[0-9a-f]{64}$/);

    const members = new Set(
      execFileSync("/usr/bin/tar", ["-tzf", archive], { encoding: "utf8" })
        .trim()
        .split("\n"),
    );
    expect(members.has("desktop/main.js")).toBe(true);
    expect(members.has("desktop/preload.js")).toBe(true);
    expect(
      members.has(
        "desktop/node_modules/lynxtron-scintilla-editor/build/Release/lynx_scintilla_module.node",
      ),
    ).toBe(true);
    expect(members.has("desktop/node_modules/typescript/package.json")).toBe(false);
    expect(benchmarkLock.packages["node_modules/typescript"]?.version).toBe("5.9.3");
  });

  it("resets file-backed Fiddle state before every CLI run", () => {
    expect(cliSource).toContain("await resetBenchmarkFixture(output)");
    expect(cliSource).toContain("ACTONCE_LYNXTRON_TMPDIR: fixture.temporaryDirectory");
    expect(cliSource).not.toContain("\n    TMPDIR: fixture.temporaryDirectory");
    expect(cliSource.indexOf("await resetBenchmarkFixture(output)"))
      .toBeLessThan(cliSource.indexOf("await spawnAndWait("));
    expect(fixtureStateSource).toContain("await rm(fixtureRoot, { recursive: true, force: true })");
    expect(fixtureStateSource).toContain("await extractArchive(archive, fixtureRoot)");
    expect(fixtureStateSource).toContain("await rm(temporaryDirectory, { recursive: true, force: true })");
    expect(fixtureStateSource).toContain('"fiddle.tour.seen": true');
    expect(fixtureStateSource).toContain("process.env.ACTONCE_LYNXTRON_CONFIG_PATH||");
    expect(suiteRunnerSource).toContain('join(benchmarkDir, "cli.ts")');
    expect(suiteRunnerSource).not.toContain('join(benchmarkDir, "runner.ts")');
    expect(rootPackage.scripts["benchmark:macos:lynxtron"]).toContain("cli.ts run");
    expect(rootPackage.scripts["benchmark:macos:lynxtron"]).not.toContain("runner.ts");
  });
});
