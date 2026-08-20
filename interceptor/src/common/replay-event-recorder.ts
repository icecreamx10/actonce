import type { RecorderSession } from "../core/recorder-session.js";

export type ReplayTimelineEvent = Record<string, unknown> & {
  kind: string;
  monotonicNs: string;
};

/**
 * Adapts ReplayFlow.emit to the recorder's one append-only session clock.
 * The replay timestamp is retained as observedMonotonicNs while RecorderSession
 * assigns global/source sequence numbers and the ingestion timestamp.
 */
export function createReplayEventRecorder(
  session: RecorderSession,
  options: { instanceId?: string; version?: string } = {},
): (event: ReplayTimelineEvent) => void {
  const context = session.source({
    type: "checkpoint",
    instanceId: options.instanceId ?? "replay-checkpoint",
    version: options.version,
  });
  return (event) => {
    const { monotonicNs, ...payload } = event;
    context.emit({
      ...payload,
      kind: event.kind,
      observedMonotonicNs: monotonicNs,
    });
  };
}
