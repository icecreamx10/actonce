import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { AndroidDevice, getConnectedDevices } from "@midscene/android";
import type { AndroidSessionOptions } from "./types.js";

export class AndroidSession {
  private sourceCache?: string;
  private constructor(
    readonly device: AndroidDevice,
    readonly serial: string,
  ) {}

  static async connect(
    options: AndroidSessionOptions = {},
  ): Promise<AndroidSession> {
    const devices = await getConnectedDevices(
      options.androidAdbPath
        ? { androidAdbPath: options.androidAdbPath }
        : undefined,
    );
    const serial =
      options.serial ?? process.env.ACTONCE_ANDROID_SERIAL ?? devices[0]?.udid;
    if (!serial || !devices.some((item) => item.udid === serial))
      throw new Error(`Android device ${serial ?? "<none>"} is not connected`);
    const device = new AndroidDevice(serial, {
      androidAdbPath:
        options.androidAdbPath ??
        process.env.ACTONCE_ADB_PATH ??
        process.env.MIDSCENE_ADB_PATH,
      displayId: options.displayId,
      screenshotStrategy: options.screenshotStrategy ?? "auto",
      imeStrategy: "always-yadb",
      keyboardDismissStrategy: "back-first",
    });
    await device.connect();
    return new AndroidSession(device, serial);
  }

  async close(): Promise<void> {
    await this.device.destroy();
  }
  async launch(packageName: string): Promise<void> {
    await this.device.launch(packageName);
  }
  async terminate(packageName: string): Promise<void> {
    await this.device.terminate(packageName);
  }
  async source(): Promise<string> {
    if (this.sourceCache !== undefined) return this.sourceCache;
    this.sourceCache = JSON.stringify(await this.device.getUITree());
    return this.sourceCache;
  }
  invalidateObservation(): void {
    this.sourceCache = undefined;
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
