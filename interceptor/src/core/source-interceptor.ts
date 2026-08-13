export type SourceDescriptor = {
  type: "midscene" | "macos-ax" | "macos-input" | "wda" | "checkpoint" | string;
  instanceId: string;
  version?: string;
};

export type EventCorrelation = {
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
  logicalActionId?: string;
  requestId?: string;
  captureId?: string;
};

export type SourceEvent = Record<string, unknown> & {
  kind: string;
  lifecycle?: "started" | "completed" | "failed" | "instant";
  observedMonotonicNs?: string;
  correlation?: EventCorrelation;
};

export type EventReceipt = {
  sequence: number;
  sourceSequence: number;
};

export type ArtifactReference = {
  sha256: string;
  size: number;
  path: string;
  mediaType: string;
  complete: boolean;
};

export interface RecorderContext {
  readonly source: SourceDescriptor;
  monotonicNs(): string;
  emit(event: SourceEvent): EventReceipt;
  artifact(bytes: Buffer, mediaType: string): Promise<ArtifactReference>;
  storeArtifact(bytes: Buffer, mediaType: string): ArtifactReference;
  markIncomplete(reason: string): void;
}

/** A capture source with independently configurable lifecycle. */
export interface RecorderInterceptor {
  readonly source: SourceDescriptor;
  start(context: RecorderContext): Promise<void> | void;
  stop(): Promise<void> | void;
}
