import { spawn, type ChildProcess, type StdioOptions } from "node:child_process";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { mkdir, open, type FileHandle } from "node:fs/promises";

const require = createRequire(import.meta.url);
export type AppiumServerOptions = {
  hostname?: string;
  port?: number;
  logPath?: string;
  startupTimeoutMs?: number;
  homePath?: string;
};

export class ManagedAppiumServer {
  readonly hostname: string;
  readonly port: number;
  private constructor(
    private readonly child: ChildProcess,
    hostname: string,
    port: number,
  ) {
    this.hostname = hostname;
    this.port = port;
  }

  static async start(options: AppiumServerOptions = {}): Promise<ManagedAppiumServer> {
    const hostname = options.hostname ?? "127.0.0.1";
    const port = options.port ?? (await availablePort(hostname));
    const appiumEntry = require.resolve("appium");
    const appiumHome = resolveManagedAppiumHome(options.homePath);
    const log = options.logPath ? await logStdio(options.logPath) : undefined;
    const stdio: StdioOptions = log?.stdio ?? ["ignore", "inherit", "inherit"];
    const child = spawn(
      process.execPath,
      [appiumEntry, "server", "--address", hostname, "--port", String(port)],
      {
        cwd: appiumHome,
        env: { ...process.env, APPIUM_HOME: appiumHome, FORCE_COLOR: "0" },
        stdio,
      },
    );
    await log?.handle.close();
    const managed = new ManagedAppiumServer(child, hostname, port);
    try {
      await managed.waitUntilReady(options.startupTimeoutMs ?? 120_000);
      return managed;
    } catch (error) {
      await managed.stop();
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (this.child.exitCode !== null || this.child.signalCode !== null) return;
    this.child.kill("SIGTERM");
    await Promise.race([
      new Promise<void>((resolveExit) => this.child.once("exit", () => resolveExit())),
      new Promise<void>((resolveTimeout) => setTimeout(resolveTimeout, 5_000)),
    ]);
    if (this.child.exitCode === null && this.child.signalCode === null) {
      this.child.kill("SIGKILL");
    }
  }

  private async waitUntilReady(timeoutMs: number): Promise<void> {
    const deadline = performance.now() + timeoutMs;
    let lastError: unknown;
    while (performance.now() < deadline) {
      if (this.child.exitCode !== null) {
        throw new Error(`Appium exited before becoming ready (${this.child.exitCode})`);
      }
      try {
        const response = await fetch(`http://${this.hostname}:${this.port}/status`);
        if (response.ok) return;
      } catch (error) {
        lastError = error;
      }
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 200));
    }
    throw new Error(`Appium did not become ready within ${timeoutMs}ms`, {
      cause: lastError,
    });
  }
}

/**
 * npm workspaces may hoist appium-mac2-driver above runtime/macos. Appium stores
 * absolute extension paths under APPIUM_HOME, so derive the home from the
 * package that is actually installed instead of assuming a local node_modules.
 */
export function resolveManagedAppiumHome(explicit?: string): string {
  if (explicit) return resolve(explicit);
  const driverManifest = require.resolve("appium-mac2-driver/package.json");
  return dirname(dirname(dirname(driverManifest)));
}

async function availablePort(hostname: string): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, hostname, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Unable to allocate an Appium port"));
        return;
      }
      server.close((error) => (error ? reject(error) : resolvePort(address.port)));
    });
  });
}

async function logStdio(path: string): Promise<{
  handle: FileHandle;
  stdio: StdioOptions;
}> {
  await mkdir(dirname(resolve(path)), { recursive: true });
  const handle = await open(path, "a");
  return {
    handle,
    stdio: ["ignore", handle.fd, handle.fd],
  };
}
