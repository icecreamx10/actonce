import { randomUUID } from "node:crypto";
import { createServer, request as createUpstreamRequest } from "node:http";
import type { IncomingHttpHeaders, IncomingMessage } from "node:http";
import type { Socket } from "node:net";
import { RecordingWriter } from "../common/recording-writer.js";

type Header = {
  name: string;
  value: string;
};

const listenHost = process.env.ACTONCE_INTERCEPTOR_HOST ?? "127.0.0.1";
const listenPort = Number(process.env.ACTONCE_INTERCEPTOR_PORT ?? "8200");
const upstreamHost = process.env.ACTONCE_WDA_UPSTREAM_HOST ?? "127.0.0.1";
const upstreamPort = Number(process.env.ACTONCE_WDA_UPSTREAM_PORT ?? "8100");
const recordingId =
  process.env.ACTONCE_RECORDING_ID ??
  `${new Date().toISOString().replaceAll(":", "-")}-${randomUUID()}`;
const socketIds = new WeakMap<Socket, string>();
let stopping = false;

const writer = await RecordingWriter.create({
  platform: "ios",
  recorder: "wda-http-proxy",
  rootDir: process.env.ACTONCE_RECORDINGS_DIR,
  recordingId,
  metadata: {
    listen: `http://${listenHost}:${listenPort}`,
    upstream: `http://${upstreamHost}:${upstreamPort}`,
  },
});

function headerPairs(rawHeaders: string[]): Header[] {
  const pairs: Header[] = [];
  for (let index = 0; index < rawHeaders.length; index += 2) {
    pairs.push({
      name: rawHeaders[index] ?? "",
      value: rawHeaders[index + 1] ?? "",
    });
  }
  return pairs;
}

function sessionIdFromTarget(target: string): string | null {
  return /^\/session\/([^/]+)/.exec(target)?.[1] ?? null;
}

function mediaType(headers: IncomingHttpHeaders): string | null {
  const value = headers["content-type"];
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

function contentEncoding(headers: IncomingHttpHeaders): string | null {
  const value = headers["content-encoding"];
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

const recordEvent = (event: Record<string, unknown>): void => {
  writer.append(event);
};

function captureBlob(
  chunks: Buffer[],
  headers: IncomingHttpHeaders,
): Record<string, unknown> {
  const body = Buffer.concat(chunks);
  return {
    ...writer.storeArtifact(body, mediaType(headers) ?? "application/octet-stream"),
    contentEncoding: contentEncoding(headers),
  };
}

function connectionIdFor(request: IncomingMessage): string {
  const socket = request.socket;
  let connectionId = socketIds.get(socket);
  if (!connectionId) {
    connectionId = randomUUID();
    socketIds.set(socket, connectionId);
  }
  return connectionId;
}

function upstreamHeaders(request: IncomingMessage): {
  headers: IncomingHttpHeaders;
  transformations: string[];
} {
  return {
    headers: {
      ...request.headers,
      host: `${upstreamHost}:${upstreamPort}`,
    },
    transformations: [
      `host: ${request.headers.host ?? "<missing>"} -> ${upstreamHost}:${upstreamPort}`,
    ],
  };
}

const server = createServer((request, response) => {
  const requestId = randomUUID();
  const connectionId = connectionIdFor(request);
  const target = request.url ?? "/";
  const method = request.method ?? "GET";
  const sessionId = sessionIdFromTarget(target);
  const requestChunks: Buffer[] = [];
  const transformed = upstreamHeaders(request);

  recordEvent({
    kind: "http.request.started",
    origin: "client",
    connectionId,
    requestId,
    sessionId,
    http: {
      method,
      target,
      headers: headerPairs(request.rawHeaders),
      headerTransformations: transformed.transformations,
    },
  });

  const upstreamRequest = createUpstreamRequest(
    {
      host: upstreamHost,
      port: upstreamPort,
      method,
      path: target,
      headers: transformed.headers,
    },
    (upstreamResponse) => {
      const responseChunks: Buffer[] = [];
      const status = upstreamResponse.statusCode ?? 502;

      recordEvent({
        kind: "http.response.started",
        origin: "upstream",
        connectionId,
        requestId,
        sessionId,
        http: {
          status,
          headers: headerPairs(upstreamResponse.rawHeaders),
        },
      });

      response.writeHead(status, upstreamResponse.headers);
      upstreamResponse.on("data", (chunk: Buffer) => {
        const bytes = Buffer.from(chunk);
        responseChunks.push(bytes);
        response.write(bytes);
      });
      upstreamResponse.on("end", () => {
        response.end();
        const captured = captureBlob(responseChunks, upstreamResponse.headers);
        recordEvent({
          kind: "http.response.completed",
          origin: "upstream",
          connectionId,
          requestId,
          sessionId,
          http: { status },
          body: captured,
        });
      });
    },
  );

  upstreamRequest.on("error", (error) => {
    writer.markIncomplete(`upstream request failed: ${error.message}`);
    recordEvent({
      kind: "http.exchange.failed",
      origin: "interceptor",
      connectionId,
      requestId,
      sessionId,
      http: { method, target },
      error: {
        code: "UPSTREAM_REQUEST_FAILED",
        message: error.message,
      },
    });
    if (!response.headersSent) {
      response.writeHead(502, { "content-type": "application/json" });
    }
    response.end(JSON.stringify({ error: "WDA upstream request failed" }));
  });

  request.on("data", (chunk: Buffer) => {
    const bytes = Buffer.from(chunk);
    requestChunks.push(bytes);
    upstreamRequest.write(bytes);
  });
  request.on("end", () => {
    upstreamRequest.end();
    const captured = captureBlob(requestChunks, request.headers);
    recordEvent({
      kind: "http.request.completed",
      origin: "client",
      connectionId,
      requestId,
      sessionId,
      http: { method, target },
      body: captured,
    });
  });
  request.on("aborted", () => {
    upstreamRequest.destroy();
    writer.markIncomplete(`client aborted request ${requestId}`);
    recordEvent({
      kind: "http.exchange.failed",
      origin: "interceptor",
      connectionId,
      requestId,
      sessionId,
      http: { method, target },
      error: {
        code: "CLIENT_ABORTED",
        message: "Client aborted before the request completed",
      },
    });
  });
});

async function stop(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  server.close();
  await writer.close();
  console.log(`ActOnce interceptor stopped by ${signal}`);
  console.log(`Recording: ${writer.recordingDir}`);
}

process.on("SIGINT", () => {
  void stop("SIGINT").finally(() => process.exit(0));
});
process.on("SIGTERM", () => {
  void stop("SIGTERM").finally(() => process.exit(0));
});

server.listen(listenPort, listenHost, () => {
  console.log(
    `ActOnce interceptor listening at http://${listenHost}:${listenPort}`,
  );
  console.log(`Forwarding to WDA at http://${upstreamHost}:${upstreamPort}`);
  console.log(`Recording: ${writer.recordingDir}`);
});
