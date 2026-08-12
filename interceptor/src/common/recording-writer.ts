import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type RecordingPlatform = "ios" | "macos";

export type ArtifactReference = {
  sha256: string;
  size: number;
  path: string;
  mediaType: string;
  complete: boolean;
};

export type RecordingWriterOptions = {
  platform: RecordingPlatform;
  recorder: string;
  rootDir?: string;
  recordingId?: string;
  metadata?: Record<string, unknown>;
};

/**
 * Platform-neutral append-only event and content-addressed artifact writer.
 * Capture adapters own protocol semantics; this class owns persistence only.
 */
export class RecordingWriter {
  readonly recordingId: string;
  readonly recordingDir: string;
  readonly platform: RecordingPlatform;

  private readonly startedAt = new Date().toISOString();
  private readonly eventsPath: string;
  private readonly artifactsDir: string;
  private readonly manifestPath: string;
  private sequence = 0;
  private queue = Promise.resolve();
  private integrity: "complete" | "incomplete" = "complete";
  private readonly integrityReasons = new Set<string>();

  private constructor(private readonly options: RecordingWriterOptions) {
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

  static async create(options: RecordingWriterOptions): Promise<RecordingWriter> {
    const writer = new RecordingWriter(options);
    await mkdir(writer.artifactsDir, { recursive: true });
    await writer.writeManifest("recording");
    return writer;
  }

  monotonicNs(): string {
    return process.hrtime.bigint().toString();
  }

  append(event: Record<string, unknown>): number {
    const eventSequence = this.sequence++;
    const envelope = {
      schemaVersion: 1,
      recordingId: this.recordingId,
      platform: this.platform,
      sequence: eventSequence,
      wallTime: new Date().toISOString(),
      monotonicNs: this.monotonicNs(),
      ...event,
    };
    this.schedule(() =>
      appendFile(this.eventsPath, `${JSON.stringify(envelope)}\n`, "utf8"),
    );
    return eventSequence;
  }

  async artifact(
    bytes: Buffer,
    mediaType: string,
  ): Promise<ArtifactReference> {
    const reference = this.storeArtifact(bytes, mediaType);
    await this.queue;
    return reference;
  }

  storeArtifact(bytes: Buffer, mediaType: string): ArtifactReference {
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const relativePath = `artifacts/${sha256.slice(0, 2)}/${sha256}`;
    const absolutePath = join(this.recordingDir, relativePath);
    const reference = { sha256, size: bytes.byteLength, path: relativePath, mediaType, complete: true };
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
    await this.queue;
    await this.writeManifest(this.integrity);
  }

  private schedule(task: () => Promise<void>): void {
    this.queue = this.queue.then(task).catch((error) => {
      this.markIncomplete(`event persistence failed: ${String(error)}`);
    });
  }

  private async writeManifest(status: "recording" | "complete" | "incomplete"): Promise<void> {
    await writeFile(
      this.manifestPath,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          recorderVersion: "0.2.0",
          recordingId: this.recordingId,
          platform: this.platform,
          recorder: this.options.recorder,
          startedAt: this.startedAt,
          completedAt: status === "recording" ? null : new Date().toISOString(),
          status,
          integrity: status === "recording" ? "recording" : this.integrity,
          integrityReasons: [...this.integrityReasons],
          eventCount: this.sequence,
          metadata: this.options.metadata ?? {},
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
  }
}

export function decodeDataUrl(value: string): { bytes: Buffer; mediaType: string } {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(value);
  if (!match) {
    return { bytes: Buffer.from(value, "base64"), mediaType: "image/png" };
  }
  return { bytes: Buffer.from(match[2], "base64"), mediaType: match[1] };
}
