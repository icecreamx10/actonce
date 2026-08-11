import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export type StepMetric = {
  name: string;
  durationMs: number;
  success: boolean;
  error?: string;
};

export type BenchmarkResult = {
  schemaVersion: 1;
  taskId: string;
  mode: "ai" | "replay";
  startedAt: string;
  durationMs: number;
  success: boolean;
  agentCalls: number;
  aiFallbacks: number;
  steps: StepMetric[];
  error?: string;
};

export async function measureStep(
  name: string,
  operation: () => Promise<void>,
): Promise<StepMetric> {
  const startedAt = performance.now();

  try {
    await operation();
    return {
      name,
      durationMs: Math.round(performance.now() - startedAt),
      success: true,
    };
  } catch (error) {
    return {
      name,
      durationMs: Math.round(performance.now() - startedAt),
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function writeBenchmarkResult(
  path: string,
  result: BenchmarkResult,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(result, null, 2)}\n`, "utf8");
}
