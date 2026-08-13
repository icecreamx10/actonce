import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { IOSSessionOptions } from "./types.js";
import { NativeIOSDevice } from "./native-device.js";

export class IOSSession {
  private sourceCache?: string;
  private constructor(readonly device: NativeIOSDevice) {}

  static async connect(options: IOSSessionOptions = {}): Promise<IOSSession> {
    const device = await NativeIOSDevice.connect(options);
    return new IOSSession(device);
  }

  async close(): Promise<void> {
    await this.device.close();
  }

  async launch(bundleId: string): Promise<void> {
    await this.device.launch(bundleId);
  }

  async terminate(bundleId: string): Promise<void> {
    await this.device.terminate(bundleId);
  }

  async source(): Promise<string> {
    if (this.sourceCache === undefined) this.sourceCache = await this.device.source();
    return this.sourceCache;
  }

  invalidateObservation(): void { this.sourceCache = undefined; }

  async screenshot(path?: string): Promise<string> {
    const base64 = await this.device.screenshotBase64();
    if (path) {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, Buffer.from(base64, "base64"));
    }
    return base64;
  }
}
