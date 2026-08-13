import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  ArtifactReference,
  EventReceipt,
  RecorderContext,
  RecorderInterceptor,
  SourceDescriptor,
  SourceEvent,
} from "./source-interceptor.js";

export type RecordingPlatform = "ios" | "macos";

export type RecorderSessionOptions = {
  platform: RecordingPlatform;
  recorder: string;
  rootDir?: string;
  recordingId?: string;
  metadata?: Record<string, unknown>;
};

/**
 * One append-only clock, sequence and artifact store shared by every source.
 * Source interceptors never write recording files directly.
 */
export class RecorderSession {
  readonly recordingId: string;
  readonly recordingDir: string;
  readonly platform: RecordingPlatform;

  private readonly startedAt = new Date().toISOString();
  private readonly eventsPath: string;
  private readonly artifactsDir: string;
  private readonly manifestPath: string;
  private sequence = 0;
  private readonly sourceSequences = new Map<string, number>();
  private readonly sourceDescriptors = new Map<string, SourceDescriptor>();
  private readonly legacySource: SourceDescriptor = {
    type: "legacy",
    instanceId: "recording-writer",
  };
  private readonly interceptors: RecorderInterceptor[] = [];
  private queue = Promise.resolve();
  private integrity: "complete" | "incomplete" = "complete";
  private readonly integrityReasons = new Set<string>();
  private closed = false;
  private closePromise?: Promise<void>;

  private constructor(private readonly options: RecorderSessionOptions) {
    this.platform = options.platform;
    this.recordingId =
      options.recordingId ??
      `${new Date().toISOString().replaceAll(":", "-")}-${randomUUID()}`;
    this.recordingDir = join(
      options.rootDir ?? join(process.cwd(), "recordings"),
      this.recordingId,
    );
    this.eventsPath = join(this.recordingDir, "events.ndjson");
    this.artifactsDir = join(this.recordingDir, "artifacts");
    this.manifestPath = join(this.recordingDir, "manifest.json");
  }

  static async create(options: RecorderSessionOptions): Promise<RecorderSession> {
    const session = new RecorderSession(options);
    await mkdir(session.artifactsDir, { recursive: true });
    await session.writeManifest("recording");
    return session;
  }

  monotonicNs(): string {
    return process.hrtime.bigint().toString();
  }

  /** Compatibility path for legacy producers. New interceptors use source().emit(). */
  append(event: Record<string, unknown>): number {
    this.sourceDescriptors.set(this.sourceKey(this.legacySource), this.legacySource);
    return this.writeEvent(event, this.legacySource).sequence;
  }

  source(source: SourceDescriptor): RecorderContext {
    this.sourceDescriptors.set(this.sourceKey(source), source);
    return {
      source,
      monotonicNs: () => this.monotonicNs(),
      emit: (event) => this.writeEvent(event, source),
      artifact: (bytes, mediaType) => this.artifact(bytes, mediaType),
      storeArtifact: (bytes, mediaType) => this.storeArtifact(bytes, mediaType),
      markIncomplete: (reason) => this.markIncomplete(reason),
    };
  }

  async attach(interceptor: RecorderInterceptor): Promise<void> {
    if (this.closed || this.closePromise) {
      throw new Error("Cannot attach an interceptor to a closing recording");
    }
    await interceptor.start(this.source(interceptor.source));
    this.interceptors.push(interceptor);
  }

  async artifact(bytes: Buffer, mediaType: string): Promise<ArtifactReference> {
    const reference = this.storeArtifact(bytes, mediaType);
    await this.queue;
    return reference;
  }

  storeArtifact(bytes: Buffer, mediaType: string): ArtifactReference {
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const relativePath = `artifacts/${sha256.slice(0, 2)}/${sha256}`;
    const absolutePath = join(this.recordingDir, relativePath);
    const reference = {
      sha256,
      size: bytes.byteLength,
      path: relativePath,
      mediaType,
      complete: true,
    };
    this.schedule(async () => {
      await mkdir(join(this.artifactsDir, sha256.slice(0, 2)), { recursive: true });
      try {
        await writeFile(absolutePath, bytes, { flag: "wx" });
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) {
          this.markIncomplete(`artifact write failed: ${String(error)}`);
          throw error;
        }
      }
    });
    return reference;
  }

  markIncomplete(reason: string): void {
    this.integrity = "incomplete";
    this.integrityReasons.add(reason);
  }

  async close(): Promise<void> {
    this.closePromise ??= this.finishClose();
    await this.closePromise;
  }

  private async finishClose(): Promise<void> {
    for (const interceptor of [...this.interceptors].reverse()) {
      try {
        await interceptor.stop();
      } catch (error) {
        this.markIncomplete(
          `interceptor ${interceptor.source.instanceId} stop failed: ${String(error)}`,
        );
      }
    }
    this.closed = true;
    await this.queue;
    await this.writeManifest(this.integrity);
  }

  private writeEvent(
    event: Record<string, unknown> | SourceEvent,
    source: SourceDescriptor,
  ): EventReceipt {
    if (this.closed) throw new Error("Cannot append to a closed recording");
    const sequence = this.sequence++;
    const ingestedMonotonicNs = this.monotonicNs();
    const sourceKey = this.sourceKey(source);
    const sourceSequence = this.sourceSequences.get(sourceKey) ?? 0;
    this.sourceSequences.set(sourceKey, sourceSequence + 1);
    const {
      observedMonotonicNs,
      timing: eventTiming,
      ...payload
    } = event as SourceEvent & { timing?: Record<string, unknown> };
    const envelope = {
      ...payload,
      schemaVersion: 1,
      recordingId: this.recordingId,
      platform: this.platform,
      sequence,
      sourceSequence,
      wallTime: new Date().toISOString(),
      monotonicNs: ingestedMonotonicNs,
      timing: {
        ...(eventTiming ?? {}),
        observedMonotonicNs: observedMonotonicNs ?? ingestedMonotonicNs,
        ingestedMonotonicNs,
      },
      source,
    };
    this.schedule(() =>
      appendFile(this.eventsPath, `${JSON.stringify(envelope)}\n`, "utf8"),
    );
    return { sequence, sourceSequence };
  }

  private schedule(task: () => Promise<void>): void {
    this.queue = this.queue.then(task).catch((error) => {
      this.markIncomplete(`event persistence failed: ${String(error)}`);
    });
  }

  private async writeManifest(
    status: "recording" | "complete" | "incomplete",
  ): Promise<void> {
    await writeFile(
      this.manifestPath,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          recorderVersion: "0.3.0",
          recordingId: this.recordingId,
          platform: this.platform,
          recorder: this.options.recorder,
          startedAt: this.startedAt,
          completedAt: status === "recording" ? null : new Date().toISOString(),
          status,
          integrity: status === "recording" ? "recording" : this.integrity,
          integrityReasons: [...this.integrityReasons],
          eventCount: this.sequence,
          sources: [...this.sourceDescriptors.entries()].map(
            ([key, descriptor]) => ({
              ...descriptor,
              eventCount: this.sourceSequences.get(key) ?? 0,
            }),
          ),
          metadata: this.options.metadata ?? {},
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
  }

  private sourceKey(source: SourceDescriptor): string {
    return `${source.type}\u0000${source.instanceId}`;
  }
}
