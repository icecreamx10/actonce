import { randomUUID } from "node:crypto";
import { createServer, type Server, type Socket } from "node:net";
import { lstat, mkdir, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline";
import sharp from "sharp";
import type { DeviceTarget, VisualComparator, VisualRegion } from "@byted-lynx/actonce-replay";
import type {
  CaptureBackendFrame,
  CaptureBackendTarget,
  CaptureServiceRequest,
  CaptureServiceResponse,
  MacCaptureBackend,
} from "./capture-protocol.js";
import { SwiftCaptureBackend } from "./swift-capture-backend.js";

type SessionState = { target: DeviceTarget; windowId: number; artifactDirectory?: string; sequence: number };
type StoredFrame = CaptureBackendFrame & { frameId: string; sessionId: string; sequence: number; capturedAtMonotonicNs: string; capturedAtWallTime: string; captureDurationMs: number; region?: VisualRegion; artifactRef?: string };
type StoredReference = { sessionId: string; png: Buffer; widthPx: number; heightPx: number };

export class MacCaptureService {
  private readonly sessions = new Map<string, SessionState>();
  private readonly frames = new Map<string, StoredFrame>();
  private readonly references = new Map<string, StoredReference>();
  private captureTail: Promise<void> = Promise.resolve();
  private constructor(
    readonly socketPath: string,
    private readonly backend: MacCaptureBackend,
    private readonly server: Server,
  ) {}

  static async start(options: {
    socketPath: string;
    backend?: MacCaptureBackend;
    helperExecutable?: string;
  }): Promise<MacCaptureService> {
    const socketPath = resolve(options.socketPath);
    await mkdir(dirname(socketPath), { recursive: true });
    await removeOwnedSocket(socketPath);
    const backend = options.backend ?? await SwiftCaptureBackend.start({ executable: options.helperExecutable });
    let service!: MacCaptureService;
    const server = createServer((socket) => service.handle(socket));
    service = new MacCaptureService(socketPath, backend, server);
    await new Promise<void>((resolveListen, reject) => {
      server.once("error", reject);
      server.listen(socketPath, () => {
        server.off("error", reject);
        resolveListen();
      });
    });
    return service;
  }

  async close(): Promise<void> {
    await new Promise<void>((resolveClose, reject) => this.server.close((error) => error ? reject(error) : resolveClose()));
    await this.backend.close();
    await unlink(this.socketPath).catch(() => undefined);
  }

  private handle(socket: Socket): void {
    const lines = createInterface({ input: socket });
    lines.on("line", (line) => void this.dispatchLine(socket, line));
  }

  private async dispatchLine(socket: Socket, line: string): Promise<void> {
    let request: CaptureServiceRequest | undefined;
    try {
      request = JSON.parse(line) as CaptureServiceRequest;
      const result = await this.dispatch(request);
      writeResponse(socket, { id: request.id, result });
    } catch (error) {
      writeResponse(socket, { id: request?.id ?? "unknown", error: { code: errorCode(error), message: errorMessage(error) } });
    }
  }

  private async dispatch(request: CaptureServiceRequest): Promise<unknown> {
    const params = request.params ?? {};
    if (request.method === "health") return { ok: true, protocolVersion: 1 };
    if (request.method === "targets") return (await this.backend.targets()).map(targetFromBackend);
    if (request.method === "session.open") {
      const targetId = requiredString(params.targetId, "targetId");
      const matches = (await this.backend.targets()).filter((entry) => entry.targetId === targetId);
      if (matches.length !== 1) throw serviceError("TARGET_NOT_FOUND", `targetId resolved ${matches.length} windows`);
      const sessionId = randomUUID();
      const target = targetFromBackend(matches[0]);
      this.sessions.set(sessionId, { target, windowId: matches[0].windowId, artifactDirectory: optionalString(params.artifactDirectory), sequence: 0 });
      return { sessionId, target };
    }
    const sessionId = requiredString(params.sessionId, "sessionId");
    const session = this.sessions.get(sessionId);
    if (!session) throw serviceError("SESSION_NOT_FOUND", `Unknown capture session ${sessionId}`);
    if (request.method === "session.close") {
      this.sessions.delete(sessionId);
      for (const [id, frame] of this.frames) if (frame.sessionId === sessionId) this.frames.delete(id);
      for (const [id, reference] of this.references) if (reference.sessionId === sessionId) this.references.delete(id);
      return { closed: true };
    }
    if (request.method === "capture") return this.capture(sessionId, session, params.region as VisualRegion | undefined, params.persist === true);
    if (request.method === "reference.register") return this.registerReference(sessionId, requiredString(params.path, "path"), params.region as VisualRegion | undefined);
    if (request.method === "compare") return this.compare(sessionId, requiredString(params.frameId, "frameId"), requiredString(params.referenceId, "referenceId"), params.region as VisualRegion | undefined, params.comparator as VisualComparator);
    if (request.method === "waitStable") return this.waitStable(sessionId, session, params);
    throw serviceError("UNKNOWN_METHOD", `Unknown capture method ${request.method}`);
  }

  private async capture(sessionId: string, session: SessionState, region?: VisualRegion, persist = false) {
    const started = performance.now();
    const raw = await this.serialCapture(session.windowId);
    const normalized = region ? await cropFrame(raw, region) : raw;
    const frameId = randomUUID();
    session.sequence += 1;
    const frame: StoredFrame = {
      ...normalized,
      frameId,
      sessionId,
      sequence: session.sequence,
      capturedAtMonotonicNs: process.hrtime.bigint().toString(),
      capturedAtWallTime: new Date().toISOString(),
      captureDurationMs: performance.now() - started,
      region,
    };
    if (persist && session.artifactDirectory) {
      frame.artifactRef = resolve(session.artifactDirectory, `${String(frame.sequence).padStart(6, "0")}-${frameId}.png`);
      await mkdir(dirname(frame.artifactRef), { recursive: true });
      await writeFile(frame.artifactRef, frame.png);
    }
    this.frames.set(frameId, frame);
    trimFrames(this.frames, sessionId, 60);
    return publicFrame(frame, session.target.targetId);
  }

  private serialCapture(windowId: number): Promise<CaptureBackendFrame> {
    const operation = this.captureTail.then(() => this.backend.capture(windowId));
    this.captureTail = operation.then(() => undefined, () => undefined);
    return operation;
  }

  private async registerReference(sessionId: string, path: string, region?: VisualRegion) {
    let image = sharp(resolve(path));
    if (region) image = image.extract(pixelRegion(region, 1));
    const png = await image.png().toBuffer();
    const metadata = await sharp(png).metadata();
    if (!metadata.width || !metadata.height) throw serviceError("INVALID_REFERENCE", "Reference has no dimensions");
    const referenceId = randomUUID();
    this.references.set(referenceId, { sessionId, png, widthPx: metadata.width, heightPx: metadata.height });
    return { referenceId, widthPx: metadata.width, heightPx: metadata.height };
  }

  private async compare(sessionId: string, frameId: string, referenceId: string, region: VisualRegion | undefined, comparator: VisualComparator) {
    const started = performance.now();
    const frame = this.frames.get(frameId);
    const reference = this.references.get(referenceId);
    if (!frame || frame.sessionId !== sessionId) throw serviceError("FRAME_NOT_FOUND", `Unknown frame ${frameId}`);
    if (!reference || reference.sessionId !== sessionId) throw serviceError("REFERENCE_NOT_FOUND", `Unknown reference ${referenceId}`);
    if (frame.region && region && !sameRegion(frame.region, region)) {
      throw serviceError("INVALID_REGION", "A frame captured from one region cannot be compared as a different region");
    }
    const actualPng = region && !frame.region
      ? await sharp(frame.png).extract(pixelRegion(region, frame.scaleFactor)).png().toBuffer()
      : frame.png;
    const compareStarted = performance.now();
    const comparison = await comparePng(actualPng, reference.png, comparator);
    const compareDurationMs = performance.now() - compareStarted;
    return {
      ...comparison,
      actualFrameId: frameId,
      referenceId,
      metrics: { captureDurationMs: frame.captureDurationMs, compareDurationMs, totalDurationMs: performance.now() - started },
    };
  }

  private async waitStable(sessionId: string, session: SessionState, params: Record<string, unknown>) {
    const timeoutMs = positiveNumber(params.timeoutMs, "timeoutMs");
    const required = optionalPositiveInteger(params.consecutiveFrames, 3, "consecutiveFrames");
    const minimumObservationMs = optionalNonNegativeNumber(params.minimumObservationMs, 100, "minimumObservationMs");
    const comparator = (params.comparator as VisualComparator | undefined) ?? { type: "pixelDiff", mismatchThreshold: 0.002, channelTolerance: 8 };
    const started = performance.now();
    let previous: StoredFrame | undefined;
    let consecutive = 0;
    let count = 0;
    let captureDurationMs = 0;
    let compareDurationMs = 0;
    let settleDelayMs = 0;
    let finalPublic: ReturnType<typeof publicFrame> | undefined;
    while (performance.now() - started <= timeoutMs) {
      const result = await this.capture(sessionId, session, params.region as VisualRegion | undefined, false);
      count += 1;
      finalPublic = result;
      const current = this.frames.get(result.frameId)!;
      captureDurationMs += current.captureDurationMs;
      if (previous) {
        const compareStarted = performance.now();
        const difference = await comparePng(current.png, previous.png, comparator);
        compareDurationMs += performance.now() - compareStarted;
        consecutive = difference.matched ? consecutive + 1 : 0;
      }
      if (consecutive >= required - 1 && performance.now() - started >= minimumObservationMs) {
        return stableResult("stable", result);
      }
      previous = current;
      const delayStarted = performance.now();
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 30));
      settleDelayMs += performance.now() - delayStarted;
    }
    if (!finalPublic) finalPublic = await this.capture(sessionId, session, params.region as VisualRegion | undefined, false);
    return stableResult("timeout", finalPublic);

    function stableResult(status: "stable" | "timeout", finalFrame: ReturnType<typeof publicFrame>) {
      return {
        status,
        finalFrame,
        frameCount: count,
        settleDelayMs,
        metrics: {
          captureDurationMs,
          compareDurationMs,
          settleDelayMs,
          totalDurationMs: performance.now() - started,
        },
      };
    }
  }
}

async function comparePng(actual: Buffer, reference: Buffer, comparator: VisualComparator) {
  const [actualMeta, referenceMeta] = await Promise.all([sharp(actual).metadata(), sharp(reference).metadata()]);
  if (!actualMeta.width || !actualMeta.height) throw serviceError("INVALID_FRAME", "Frame has no dimensions");
  if (!referenceMeta.width || !referenceMeta.height) throw serviceError("INVALID_REFERENCE", "Reference has no dimensions");
  if (actualMeta.width !== referenceMeta.width || actualMeta.height !== referenceMeta.height) {
    return { matched: false, differenceRatio: 1, meanAbsoluteDifference: 255 };
  }
  const [left, right] = await Promise.all([
    sharp(actual).greyscale().raw().toBuffer(),
    sharp(reference).greyscale().raw().toBuffer(),
  ]);
  let differing = 0;
  let absolute = 0;
  const tolerance = comparator.channelTolerance ?? 16;
  for (let index = 0; index < left.length; index += 1) {
    const delta = Math.abs(left[index] - right[index]);
    absolute += delta;
    if (delta > tolerance) differing += 1;
  }
  const differenceRatio = differing / left.length;
  const matched = differenceRatio <= comparator.mismatchThreshold;
  return { matched, differenceRatio, meanAbsoluteDifference: absolute / left.length };
}

async function cropFrame(frame: CaptureBackendFrame, region: VisualRegion): Promise<CaptureBackendFrame> {
  const png = await sharp(frame.png).extract(pixelRegion(region, frame.scaleFactor)).png().toBuffer();
  const metadata = await sharp(png).metadata();
  return { ...frame, png, widthPx: metadata.width!, heightPx: metadata.height! };
}

function pixelRegion(region: VisualRegion, scale: number) {
  if (region.space !== "targetLogical") throw serviceError("INVALID_REGION", "Only targetLogical regions are supported");
  const result = { left: Math.round(region.x * scale), top: Math.round(region.y * scale), width: Math.round(region.width * scale), height: Math.round(region.height * scale) };
  if (result.left < 0 || result.top < 0 || result.width <= 0 || result.height <= 0) {
    throw serviceError("INVALID_REGION", "Region must have non-negative origin and positive dimensions");
  }
  return result;
}

function sameRegion(left: VisualRegion | undefined, right: VisualRegion | undefined): boolean {
  return left !== undefined && right !== undefined &&
    left.space === right.space && left.x === right.x && left.y === right.y &&
    left.width === right.width && left.height === right.height;
}

function publicFrame(frame: StoredFrame, targetId: string) {
  return { frameId: frame.frameId, sequence: frame.sequence, capturedAtMonotonicNs: frame.capturedAtMonotonicNs, capturedAtWallTime: frame.capturedAtWallTime, widthPx: frame.widthPx, heightPx: frame.heightPx, scaleFactor: frame.scaleFactor, targetId, artifactRef: frame.artifactRef };
}

function targetFromBackend(target: CaptureBackendTarget): DeviceTarget {
  return { targetId: target.targetId, deviceId: "macos-local", app: { pid: target.pid, bundleId: target.bundleId || undefined, processName: target.processName || undefined }, window: { windowId: String(target.windowId), title: target.title || undefined, bounds: target.bounds, scaleFactor: 1 } };
}

function trimFrames(frames: Map<string, StoredFrame>, sessionId: string, maximum: number): void {
  const entries = [...frames].filter(([, frame]) => frame.sessionId === sessionId);
  for (const [id] of entries.slice(0, Math.max(0, entries.length - maximum))) frames.delete(id);
}

async function removeOwnedSocket(path: string): Promise<void> {
  try {
    const stats = await lstat(path);
    if (!stats.isSocket()) throw new Error(`Refusing to replace non-socket path ${path}`);
    await unlink(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

function writeResponse(socket: Socket, response: CaptureServiceResponse): void { socket.write(`${JSON.stringify(response)}\n`); }
function requiredString(value: unknown, name: string): string { if (typeof value !== "string" || !value) throw serviceError("INVALID_REQUEST", `${name} is required`); return value; }
function optionalString(value: unknown): string | undefined { return typeof value === "string" && value ? value : undefined; }
function positiveNumber(value: unknown, name: string): number { if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) throw serviceError("INVALID_REQUEST", `${name} must be positive`); return value; }
function optionalPositiveInteger(value: unknown, fallback: number, name: string): number { if (value === undefined) return fallback; if (!Number.isInteger(value) || (value as number) <= 0) throw serviceError("INVALID_REQUEST", `${name} must be a positive integer`); return value as number; }
function optionalNonNegativeNumber(value: unknown, fallback: number, name: string): number { if (value === undefined) return fallback; if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw serviceError("INVALID_REQUEST", `${name} must be non-negative`); return value; }
function serviceError(code: string, message: string): Error { return Object.assign(new Error(message), { code }); }
function errorCode(error: unknown): string { return typeof error === "object" && error !== null && "code" in error ? String((error as { code: unknown }).code) : "INTERNAL"; }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
