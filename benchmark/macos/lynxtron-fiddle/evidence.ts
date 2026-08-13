import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { LynxtronRunResult } from "./evaluation.js";

export type EvidenceRun = {
  mode: "original" | "replay";
  runId: string;
  resultPath: string;
  status: "passed" | "failed";
  assertions: LynxtronRunResult["steps"];
  screenshots: Array<{ path: string; sha256: string }>;
};

export type EvidenceManifest = {
  schemaVersion: 1;
  benchmark: string;
  instruction: string;
  runs: EvidenceRun[];
};

export async function buildEvidenceManifest(
  resultPaths: string[],
  outputDir: string,
): Promise<EvidenceManifest> {
  await mkdir(outputDir, { recursive: true });
  const runs: EvidenceRun[] = [];
  for (const resultPath of resultPaths) {
    const absoluteResult = resolve(resultPath);
    const result = JSON.parse(await readFile(absoluteResult, "utf8")) as LynxtronRunResult;
    const screenshots = await screenshotCandidates(result, absoluteResult);
    if (!screenshots.length) throw new Error(`${result.runId} has no screenshot evidence`);
    const selected = screenshots.slice(-3);
    const copied: EvidenceRun["screenshots"] = [];
    for (let index = 0; index < selected.length; index += 1) {
      const bytes = await readFile(selected[index]);
      if (!isPng(bytes)) throw new Error(`${selected[index]} is not a PNG screenshot`);
      const name = `${safe(result.mode)}-${safe(result.runId)}-${index + 1}.png`;
      const destination = join(outputDir, name);
      await copyFile(selected[index], destination);
      copied.push({
        path: name,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      });
    }
    runs.push({
      mode: result.mode,
      runId: result.runId,
      resultPath: absoluteResult,
      status: result.status,
      assertions: result.steps,
      screenshots: copied,
    });
  }
  const benchmark = runs[0]?.resultPath
    ? (JSON.parse(await readFile(runs[0].resultPath, "utf8")) as LynxtronRunResult).benchmark
    : "";
  return {
    schemaVersion: 1,
    benchmark,
    instruction:
      "Compare original and replay screenshots. Pass only if replay visibly reproduces the red syntax underline and the 'Expression expected.' hover tooltip, then restores the editor without saving.",
    runs,
  };
}

async function screenshotCandidates(
  result: LynxtronRunResult,
  resultPath: string,
): Promise<string[]> {
  const resultDir = dirname(resultPath);
  if (result.artifacts?.screenshots?.length) {
    return result.artifacts.screenshots.map((path) => resolve(resultDir, path));
  }
  const recording = result.artifacts?.recording;
  if (!recording) return [];
  const recordingDir = resolve(resultDir, recording);
  const lines = (await readFile(join(recordingDir, "events.ndjson"), "utf8"))
    .split("\n")
    .filter(Boolean);
  const paths: string[] = [];
  for (const line of lines) {
    const event = JSON.parse(line) as {
      artifact?: { path?: string; mediaType?: string; complete?: boolean };
    };
    if (event.artifact?.mediaType === "image/png" && event.artifact.complete !== false && event.artifact.path) {
      paths.push(resolve(recordingDir, event.artifact.path));
    }
  }
  return [...new Set(paths)];
}

function isPng(bytes: Buffer): boolean {
  return bytes.length >= 8 && bytes.subarray(0, 8).equals(
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  );
}

function safe(value: string): string {
  return value.replaceAll(/[^a-zA-Z0-9._-]/g, "_");
}
