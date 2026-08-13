import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildEvidenceManifest } from "../benchmark/macos/lynxtron-fiddle/evidence.js";

const onePixelPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

describe("Lynxtron benchmark evidence selection", () => {
  it("copies only the last three declared screenshots per run", async () => {
    const root = await mkdtemp(join(tmpdir(), "actonce-evidence-"));
    const resultPaths: string[] = [];
    for (const mode of ["original", "replay"] as const) {
      const runDir = join(root, mode);
      await mkdir(runDir, { recursive: true });
      const screenshots: string[] = [];
      for (let index = 0; index < 4; index += 1) {
        const name = `${index}.png`;
        await writeFile(join(runDir, name), onePixelPng);
        screenshots.push(name);
      }
      const resultPath = join(runDir, "result.json");
      await writeFile(resultPath, JSON.stringify({
        schemaVersion: 1,
        benchmark: "diagnostic-hover",
        mode,
        runId: `${mode}-1`,
        status: "passed",
        executionDurationMs: 100,
        steps: [],
        artifacts: { screenshots },
      }));
      resultPaths.push(resultPath);
    }

    const manifest = await buildEvidenceManifest(resultPaths, join(root, "review"));
    expect(manifest.benchmark).toBe("diagnostic-hover");
    expect(manifest.runs).toHaveLength(2);
    expect(manifest.runs.every((run) => run.screenshots.length === 3)).toBe(true);
    expect(manifest.runs.flatMap((run) => run.screenshots).every((item) =>
      item.sha256.match(/^[0-9a-f]{64}$/),
    )).toBe(true);
  });
});
