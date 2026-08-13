import { mkdir, writeFile } from "node:fs/promises";
import { IOSDevice } from "@byted-lynx/actonce-midscene-adapter";

const wdaHost = process.env.ACTONCE_WDA_HOST ?? "127.0.0.1";
const wdaPort = Number(process.env.ACTONCE_WDA_PORT ?? "8100");
const screenshotPath = ".cache/ios-runtime/wda-smoke.png";
const device = new IOSDevice({ wdaHost, wdaPort });

try {
  await device.connect();
  const deviceInfo = await device.getConnectedDeviceInfo();
  const screen = await device.getScreenSize();
  const screenshotDataUrl = await device.screenshotBase64();
  const screenshotBase64 = screenshotDataUrl.replace(
    /^data:image\/[a-zA-Z0-9.+-]+;base64,/,
    "",
  );
  const screenshot = Buffer.from(screenshotBase64, "base64");

  await mkdir(".cache/ios-runtime", { recursive: true });
  await writeFile(screenshotPath, screenshot);

  console.log(
    JSON.stringify(
      {
        connected: true,
        device: deviceInfo,
        screen,
        screenshotPath,
        screenshotBytes: screenshot.byteLength,
      },
      null,
      2,
    ),
  );
} finally {
  await device.destroy();
}
