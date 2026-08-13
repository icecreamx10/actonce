import type { ArtifactReference, SourceEvent } from "../../core/source-interceptor.js";

type JsonRecord = Record<string, unknown>;

export type ObservationScreenshotEvidence = {
  sequence: number;
  artifact: ArtifactReference;
};

/** Converts completed Midscene insight tasks into stable first-class events. */
export class MidsceneDumpNormalizer {
  private readonly emittedTasks = new Set<string>();

  events(
    dump: string,
    sourceDumpArtifact: ArtifactReference,
    screenshotEvidence: ObservationScreenshotEvidence[] = [],
  ): SourceEvent[] {
    let parsed: unknown;
    try {
      parsed = JSON.parse(dump);
    } catch {
      return [];
    }
    if (!isRecord(parsed) || !Array.isArray(parsed.executions)) return [];

    const events: SourceEvent[] = [];
    for (const executionValue of parsed.executions) {
      if (!isRecord(executionValue) || !Array.isArray(executionValue.tasks)) continue;
      const executionId = stringValue(executionValue.id) ?? "unknown-execution";
      for (const taskValue of executionValue.tasks) {
        if (!isRecord(taskValue)) continue;
        const operation = stringValue(taskValue.subType);
        if (!operation || !["Assert", "Boolean", "Query"].includes(operation)) {
          continue;
        }
        const status = stringValue(taskValue.status);
        if (status !== "finished" && status !== "failed") continue;
        const taskId = stringValue(taskValue.taskId) ?? `${operation}-unknown`;
        const key = `${executionId}:${taskId}:${status}`;
        if (this.emittedTasks.has(key)) continue;
        this.emittedTasks.add(key);
        const param = isRecord(taskValue.param) ? taskValue.param : {};
        const prompt = stringValue(param.dataDemand) ?? stringValue(param.prompt);
        const uiContext = isRecord(taskValue.uiContext) ? taskValue.uiContext : {};
        const screenshotContext = isRecord(uiContext.screenshot) ? uiContext.screenshot : null;
        const domIncluded = typeof param.domIncluded === "boolean" ? param.domIncluded : null;
        const evidenceSource = screenshotContext
          ? "screenshot"
          : domIncluded === true
            ? "dom"
            : "unknown";
        events.push({
          kind:
            status === "finished"
              ? "observation.completed"
              : "observation.failed",
          lifecycle: status === "finished" ? "completed" : "failed",
          origin: "midscene-dump-normalizer",
          provider: "midscene",
          operation,
          executionId,
          taskId,
          prompt: prompt ?? null,
          result: taskValue.output ?? null,
          thought: taskValue.thought ?? null,
          modelTiming: taskValue.timing ?? null,
          usage: taskValue.usage ?? null,
          sourceDumpArtifact,
          evidenceSource,
          evidence: {
            domIncluded,
            screenshotContext: screenshotContext
              ? {
                  id: stringValue(screenshotContext.id) ?? null,
                  capturedAt: screenshotContext.capturedAt ?? null,
                  mediaType: stringValue(screenshotContext.mimeType) ?? null,
                }
              : null,
            screenshots: screenshotEvidence,
          },
          correlation: {
            traceId: executionId,
            spanId: taskId,
          },
        });
      }
    }
    return events;
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
