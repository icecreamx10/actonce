import { randomUUID } from "node:crypto";
import { createConnection, type Socket } from "node:net";
import { createInterface } from "node:readline";
import type {
  DeviceTarget,
  VisualCaptureSession,
  VisualComparator,
  VisualFrame,
  VisualRegion,
} from "@byted-lynx/actonce-replay";
import type { CaptureServiceResponse } from "./capture-protocol.js";

export class MacCaptureClient {
  private readonly pending = new Map<string, { resolve: (result: unknown) => void; reject: (error: Error) => void }>();
  private constructor(private readonly socket: Socket) {
    createInterface({ input: socket }).on("line", (line) => {
      const response = JSON.parse(line) as CaptureServiceResponse;
      const pending = this.pending.get(response.id);
      if (!pending) return;
      this.pending.delete(response.id);
      if (response.error) pending.reject(Object.assign(new Error(response.error.message), { code: response.error.code }));
      else pending.resolve(response.result);
    });
    socket.once("close", () => {
      for (const pending of this.pending.values()) pending.reject(new Error("macOS capture service connection closed"));
      this.pending.clear();
    });
  }

  static async connect(socketPath: string): Promise<MacCaptureClient> {
    const socket = createConnection(socketPath);
    await new Promise<void>((resolveConnect, reject) => {
      socket.once("connect", resolveConnect);
      socket.once("error", reject);
    });
    return new MacCaptureClient(socket);
  }

  health(): Promise<{ ok: boolean; protocolVersion: number }> { return this.request("health"); }
  targets(): Promise<DeviceTarget[]> { return this.request("targets"); }

  async openVisualSession(options: {
    target: DeviceTarget;
    artifactDirectory?: string;
  }): Promise<VisualCaptureSession> {
    const opened = await this.request<{ sessionId: string }>("session.open", {
      targetId: options.target.targetId,
      artifactDirectory: options.artifactDirectory,
    });
    return new RemoteVisualCaptureSession(this, opened.sessionId);
  }

  close(): Promise<void> {
    if (this.socket.destroyed) return Promise.resolve();
    return new Promise((resolveClose) => this.socket.end(resolveClose));
  }

  request<TResult>(method: string, params: Record<string, unknown> = {}): Promise<TResult> {
    const id = randomUUID();
    return new Promise<TResult>((resolveRequest, reject) => {
      this.pending.set(id, { resolve: (result) => resolveRequest(result as TResult), reject });
      this.socket.write(`${JSON.stringify({ id, method, params })}\n`);
    });
  }
}

class RemoteVisualCaptureSession implements VisualCaptureSession {
  constructor(private readonly client: MacCaptureClient, private readonly sessionId: string) {}

  capture(options: { region?: VisualRegion; persist?: boolean } = {}): Promise<VisualFrame> {
    return this.client.request("capture", { sessionId: this.sessionId, ...options });
  }

  registerReference(options: { path: string; region?: VisualRegion }): Promise<{ referenceId: string; widthPx: number; heightPx: number }> {
    return this.client.request("reference.register", { sessionId: this.sessionId, ...options });
  }

  compare(options: { frameId: string; referenceId: string; region?: VisualRegion; comparator: VisualComparator }) {
    return this.client.request<Awaited<ReturnType<VisualCaptureSession["compare"]>>>("compare", { sessionId: this.sessionId, ...options });
  }

  waitStable(options: { region?: VisualRegion; comparator?: VisualComparator; consecutiveFrames?: number; timeoutMs: number; minimumObservationMs?: number }) {
    return this.client.request<Awaited<ReturnType<VisualCaptureSession["waitStable"]>>>("waitStable", { sessionId: this.sessionId, ...options });
  }

  async close(): Promise<void> {
    await this.client.request("session.close", { sessionId: this.sessionId });
  }
}
