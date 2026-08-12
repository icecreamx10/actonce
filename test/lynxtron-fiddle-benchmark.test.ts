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
const testCase = JSON.parse(
  readFileSync(join(benchmarkDir, "testcase.json"), "utf8"),
) as {
  schemaVersion: number;
  naturalLanguageTask: string;
  expected: Record<string, unknown>;
  cleanup: { undoCount: number; save: boolean };
};

describe("Lynxtron Fiddle benchmark fixture", () => {
  it("pins the natural-language case and non-saving cleanup", () => {
    expect(testCase.schemaVersion).toBe(1);
    expect(testCase.naturalLanguageTask).toContain("red wavy underline");
    expect(testCase.naturalLanguageTask).toContain("Expression expected.");
    expect(testCase.expected).toEqual({
      syntaxErrorVisible: true,
      tooltipVisible: true,
      tooltipMessage: "Expression expected.",
    });
    expect(testCase.cleanup).toEqual({ undoCount: 2, save: false });
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
  });
});
