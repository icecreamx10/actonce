import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(import.meta.dirname, "..");
const tsx = resolve(repositoryRoot, "node_modules/tsx/dist/cli.mjs");

const cases = [
  {
    replay: "diagnostic-hover.ts",
    range: { from: 1, to: 92 },
    steps: [
      "precondition",
      "error-source-applied",
      "red-squiggle",
      "tooltip-message",
    ],
  },
  {
    replay: "console-gallery-roundtrip.ts",
    range: { from: 1, to: 130 },
    steps: [
      "precondition",
      "console-hidden",
      "gallery-visible",
      "electron-section-visible",
      "fiddle-cards-query",
      "editors-restored",
      "console-restored",
    ],
  },
  {
    replay: "editor-undo-redo-roundtrip.ts",
    range: { from: 1, to: 106 },
    steps: [
      "precondition",
      "probe-source-applied",
      "first-restore",
      "redo-source-visible",
      "final-source-restored",
    ],
  },
] as const;

describe("checked-in macOS replays", () => {
  for (const replayCase of cases) {
    it(`${replayCase.replay} compiles its recorded assertion decisions`, async () => {
      const outputDir = await mkdtemp(resolve(tmpdir(), "actonce-replay-"));
      try {
        await execFileAsync(
          process.execPath,
          [
            tsx,
            resolve(
              repositoryRoot,
              "benchmark/macos/lynxtron-fiddle/replays",
              replayCase.replay,
            ),
          ],
          {
            cwd: repositoryRoot,
            env: {
              ...process.env,
              ACTONCE_BENCHMARK_OUTPUT_DIR: outputDir,
              ACTONCE_DECISION_ONLY: "1",
            },
          },
        );

        const decision = JSON.parse(
          await readFile(resolve(outputDir, "assertion-decision.json"), "utf8"),
        ) as {
          schemaVersion: number;
          recording: string;
          selectedSequenceRange: { from: number; to: number };
          decisions: Array<{
            stepId: string;
            evidence: Array<{ artifact?: string }>;
            compiledEvaluator: string;
          }>;
        };

        expect(decision.schemaVersion).toBe(1);
        expect(decision.selectedSequenceRange).toEqual(replayCase.range);
        expect(decision.decisions.map(({ stepId }) => stepId)).toEqual(
          replayCase.steps,
        );
        for (const item of decision.decisions) {
          expect(item.compiledEvaluator).toMatch(
            /^recorded-screenshot-(?:region|contrastive)-comparison$/,
          );
          expect(item.evidence.length).toBeGreaterThan(0);
          for (const evidence of item.evidence) {
            if (!evidence.artifact) continue;
            await expect(
              readFile(resolve(decision.recording, evidence.artifact)),
            ).resolves.toBeInstanceOf(Buffer);
          }
        }
      } finally {
        await rm(outputDir, { recursive: true, force: true });
      }
    });
  }
});
