import { selectPlatform } from "./common/platform.js";

const platform = await selectPlatform();
console.log(`ActOnce selected ${platform} capture`);

if (platform === "ios") {
  await import("./ios/wda-proxy.js");
} else {
  await import("./macos/smoke.js");
}
