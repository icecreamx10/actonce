import { createServer, type Server } from "node:net";

const DEFAULT_LEASE_PORT = 18_433;

export async function acquireAndroidWorldDeviceLease(): Promise<() => Promise<void>> {
  if (process.env.ACTONCE_ANDROID_WORLD_DEVICE_LEASE_OWNER) return async () => {};
  const port = Number(process.env.ACTONCE_ANDROID_WORLD_DEVICE_LEASE_PORT ?? DEFAULT_LEASE_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Invalid ACTONCE_ANDROID_WORLD_DEVICE_LEASE_PORT: ${port}`);
  }
  const server = createServer();
  await listen(server, port);
  return () => close(server);
}

function listen(server: Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException) => {
      server.off("listening", onListening);
      if (error.code === "EADDRINUSE") {
        reject(new Error(
          `AndroidWorld device lease ${port} is already held; stop the other benchmark before using emulator-5554`,
        ));
      } else reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, "127.0.0.1");
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
