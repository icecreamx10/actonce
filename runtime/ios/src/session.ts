import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { IOSDevice } from "@midscene/ios";
import type { IOSSessionOptions } from "./types.js";

export class IOSSession {
  private constructor(readonly device: IOSDevice) {}

  static async connect(options: IOSSessionOptions = {}): Promise<IOSSession> {
    const device = new IOSDevice(options);
    await device.connect();
    return new IOSSession(device);
  }

  async close(): Promise<void> {
    await this.device.destroy();
  }

  async launch(bundleId: string): Promise<void> {
    await this.device.launch(bundleId);
  }

  async terminate(bundleId: string): Promise<void> {
    await this.device.terminate(bundleId);
  }

  async source(): Promise<string> {
    const response = await this.device.runWdaRequest<unknown>("GET", "/source");
    if (typeof response === "string") return response;
    if (isRecord(response) && typeof response.value === "string") return response.value;
    return JSON.stringify(response);
  }

  async screenshot(path?: string): Promise<string> {
    const dataUrl = await this.device.screenshotBase64();
    const base64 = dataUrl.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, "");
    if (path) {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, Buffer.from(base64, "base64"));
    }
    return base64;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
