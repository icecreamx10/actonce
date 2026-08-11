import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { fileURLToPath, pathToFileURL } from "node:url";

const fixturePath = fileURLToPath(new URL("./index.html", import.meta.url));

export type FixtureServer = {
  url: string;
  close: () => Promise<void>;
};

export async function startFixtureServer(port = 4173): Promise<FixtureServer> {
  const html = await readFile(fixturePath, "utf8");
  const server = createServer((request, response) => {
    if (request.url !== "/" && request.url !== "/index.html") {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }

    response.writeHead(200, {
      "cache-control": "no-store",
      "content-type": "text/html; charset=utf-8",
    });
    response.end(html);
  });

  await listen(server, port);
  const address = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => close(server),
  };
}

function listen(server: Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

const isEntrypoint =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntrypoint) {
  const fixture = await startFixtureServer();
  console.log(`ActOnce benchmark fixture: ${fixture.url}`);

  const shutdown = async () => {
    await fixture.close();
    process.exit(0);
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
