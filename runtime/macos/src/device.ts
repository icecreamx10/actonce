import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import type {
  DeviceCapabilities,
  DeviceConnector,
  DeviceSession,
  DeviceTarget,
  TargetSelector,
  VisualCaptureCapability,
} from "@byted-lynx/actonce-replay";
import { MacCaptureClient } from "./capture-client.js";
import { MacCaptureService } from "./capture-service.js";

export type MacDeviceConnectOptions = {
  socketPath?: string;
  startCaptureService?: boolean;
  captureHelperExecutable?: string;
};

export class MacDeviceConnector implements DeviceConnector<MacDeviceConnectOptions> {
  readonly platform = "macos" as const;

  async connect(options: MacDeviceConnectOptions = {}): Promise<DeviceSession> {
    // Darwin limits sockaddr_un paths to roughly one hundred bytes. os.tmpdir()
    // commonly expands to a long /var/folders path, so embedded sessions use a
    // short, UUID-namespaced /tmp endpoint by default.
    const socketPath = resolve(options.socketPath ?? `/tmp/actonce-${randomUUID().slice(0, 12)}.sock`);
    const service = options.startCaptureService === false
      ? undefined
      : await MacCaptureService.start({ socketPath, helperExecutable: options.captureHelperExecutable });
    try {
      const client = await MacCaptureClient.connect(socketPath);
      await client.health();
      return new MacDeviceSession(client, service);
    } catch (error) {
      await service?.close();
      throw error;
    }
  }
}

class MacDeviceSession implements DeviceSession {
  readonly identity = {
    platform: "macos" as const,
    deviceId: "macos-local",
    name: "Local Mac",
    architecture: process.arch,
    isSimulator: false,
  };
  readonly capabilities: DeviceCapabilities = { visualCapture: true, input: false };

  constructor(
    private readonly capture: MacCaptureClient,
    private readonly service?: MacCaptureService,
  ) {}

  listTargets(): Promise<DeviceTarget[]> { return this.capture.targets(); }

  async resolveTarget(selector: TargetSelector): Promise<DeviceTarget> {
    const titlePattern = selector.titlePattern ? new RegExp(selector.titlePattern) : undefined;
    const matches = (await this.listTargets()).filter((target) =>
      (!selector.targetId || target.targetId === selector.targetId) &&
      (!selector.pid || target.app.pid === selector.pid) &&
      (!selector.bundleId || target.app.bundleId === selector.bundleId) &&
      (!selector.processName || target.app.processName === selector.processName) &&
      (!selector.windowId || target.window?.windowId === selector.windowId) &&
      (!titlePattern || titlePattern.test(target.window?.title ?? "")));
    if (matches.length !== 1) throw new Error(`macOS target selector resolved ${matches.length} windows; exactly one is required`);
    return matches[0];
  }

  async getCapability<T extends { kind: "visualCapture" | "input" }>(kind: T["kind"]): Promise<T> {
    if (kind !== "visualCapture") throw new Error(`macOS device capability is unavailable: ${kind}`);
    const capability: VisualCaptureCapability = {
      kind: "visualCapture",
      openStream: ({ target, artifactDirectory }) => this.capture.openVisualSession({ target, artifactDirectory }),
    };
    return capability as unknown as T;
  }

  async close(): Promise<void> {
    await this.capture.close();
    await this.service?.close();
  }
}
