import { connect } from "node:net";

export type InterceptorPlatform = "ios" | "macos";

export async function selectPlatform(
  requested = process.env.ACTONCE_PLATFORM ?? "auto",
): Promise<InterceptorPlatform> {
  if (requested === "ios" || requested === "macos") return requested;
  if (requested !== "auto") {
    throw new Error(`Unsupported ACTONCE_PLATFORM: ${requested}`);
  }
  if (process.platform !== "darwin") {
    throw new Error("Auto selection currently supports Apple hosts only; set ACTONCE_PLATFORM explicitly");
  }

  // WDA listening is positive evidence of an iOS target. Otherwise the local
  // Darwin desktop is the only capture boundary available.
  const host = process.env.ACTONCE_WDA_UPSTREAM_HOST ?? "127.0.0.1";
  const port = Number(process.env.ACTONCE_WDA_UPSTREAM_PORT ?? "8100");
  return (await canConnect(host, port, 200)) ? "ios" : "macos";
}

function canConnect(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port });
    const done = (result: boolean) => {
      socket.destroy();
      resolve(result);
    };
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
    socket.setTimeout(timeoutMs, () => done(false));
  });
}
