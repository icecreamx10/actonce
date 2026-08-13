import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { AndroidSessionOptions } from "./types.js";
import { NativeAndroidDevice } from "./native-device.js";

export class AndroidSession {
  private sourceCache?: string;
  private constructor(
    readonly device: NativeAndroidDevice,
    readonly serial: string,
  ) {}

  static async connect(
    options: AndroidSessionOptions = {},
  ): Promise<AndroidSession> {
    const device = await NativeAndroidDevice.connect(options);
    return new AndroidSession(device, device.serial);
  }

  async close(): Promise<void> {
    await this.device.close();
  }
  async launch(packageName: string): Promise<void> {
    await this.device.launch(packageName);
  }
  async terminate(packageName: string): Promise<void> {
    await this.device.terminate(packageName);
  }
  async source(): Promise<string> {
    if (this.sourceCache !== undefined) return this.sourceCache;
    this.sourceCache = await this.device.source();
    return this.sourceCache;
  }
  invalidateObservation(): void {
    this.sourceCache = undefined;
  }
  async screenshot(path?: string): Promise<string> {
    const base64 = await this.device.screenshotBase64();
    if (path) {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, Buffer.from(base64, "base64"));
    }
    return base64;
  }
}
