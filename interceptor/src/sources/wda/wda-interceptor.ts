import { randomUUID } from "node:crypto";
import { createServer, request as createUpstreamRequest } from "node:http";
import type {
  IncomingHttpHeaders,
  IncomingMessage,
  Server,
} from "node:http";
import type { Socket } from "node:net";
import type {
  EventCorrelation,
  RecorderContext,
  RecorderInterceptor,
  SourceDescriptor,
} from "../../core/source-interceptor.js";

type Header = { name: string; value: string };

export type WdaInterceptorOptions = {
  listenHost?: string;
  listenPort?: number;
  upstreamHost?: string;
  upstreamPort?: number;
  currentCorrelation?: () => EventCorrelation | undefined;
};

/** Transparent WDA HTTP source. Persistence belongs to RecorderSession. */
export class WdaInterceptor implements RecorderInterceptor {
  readonly source: SourceDescriptor = {
    type: "wda",
    instanceId: "wda-http-proxy",
  };

  readonly listenHost: string;
  readonly listenPort: number;
  readonly upstreamHost: string;
  readonly upstreamPort: number;
  private readonly currentCorrelation?: () => EventCorrelation | undefined;

  private readonly socketIds = new WeakMap<Socket, string>();
  private context?: RecorderContext;
  private server?: Server;

  constructor(options: WdaInterceptorOptions = {}) {
    this.listenHost = options.listenHost ?? "127.0.0.1";
    this.listenPort = options.listenPort ?? 8200;
    this.upstreamHost = options.upstreamHost ?? "127.0.0.1";
    this.upstreamPort = options.upstreamPort ?? 8100;
    this.currentCorrelation = options.currentCorrelation;
  }

  async start(context: RecorderContext): Promise<void> {
    if (this.server) throw new Error("WDA interceptor is already started");
    this.context = context;
    this.server = createServer((request, response) => {
      const requestId = randomUUID();
      const requestSpanId = randomUUID();
      const responseSpanId = randomUUID();
      const connectionId = this.connectionIdFor(request);
      const target = request.url ?? "/";
      const method = request.method ?? "GET";
      const sessionId = sessionIdFromTarget(target);
      const requestChunks: Buffer[] = [];
      const transformed = this.upstreamHeaders(request);
      const parentCorrelation = this.currentCorrelation?.();
      const requestCorrelation = {
        traceId: parentCorrelation?.traceId ?? requestId,
        spanId: requestSpanId,
        parentSpanId: parentCorrelation?.spanId ?? parentCorrelation?.parentSpanId,
        logicalActionId: parentCorrelation?.logicalActionId,
        requestId,
      };

      context.emit({
        kind: "http.request.started",
        lifecycle: "started",
        origin: "client",
        connectionId,
        requestId,
        sessionId,
        correlation: requestCorrelation,
        http: {
          method,
          target,
          headers: headerPairs(request.rawHeaders),
          headerTransformations: transformed.transformations,
        },
      });

      const upstreamRequest = createUpstreamRequest(
        {
          host: this.upstreamHost,
          port: this.upstreamPort,
          method,
          path: target,
          headers: transformed.headers,
        },
        (upstreamResponse) => {
          const responseChunks: Buffer[] = [];
          const status = upstreamResponse.statusCode ?? 502;
          const responseCorrelation = {
            traceId: requestCorrelation.traceId,
            spanId: responseSpanId,
            parentSpanId: requestSpanId,
            logicalActionId: requestCorrelation.logicalActionId,
            requestId,
          };

          context.emit({
            kind: "http.response.started",
            lifecycle: "started",
            origin: "upstream",
            connectionId,
            requestId,
            sessionId,
            correlation: responseCorrelation,
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
            context.emit({
              kind: "http.response.completed",
              lifecycle: "completed",
              origin: "upstream",
              connectionId,
              requestId,
              sessionId,
              correlation: responseCorrelation,
              http: { status },
              body: captureBlob(context, responseChunks, upstreamResponse.headers),
            });
          });
        },
      );

      upstreamRequest.on("error", (error) => {
        context.markIncomplete(`upstream request failed: ${error.message}`);
        context.emit({
          kind: "http.exchange.failed",
          lifecycle: "failed",
          origin: "interceptor",
          connectionId,
          requestId,
          sessionId,
          correlation: requestCorrelation,
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
        context.emit({
          kind: "http.request.completed",
          lifecycle: "completed",
          origin: "client",
          connectionId,
          requestId,
          sessionId,
          correlation: requestCorrelation,
          http: { method, target },
          body: captureBlob(context, requestChunks, request.headers),
        });
      });
      request.on("aborted", () => {
        upstreamRequest.destroy();
        context.markIncomplete(`client aborted request ${requestId}`);
        context.emit({
          kind: "http.exchange.failed",
          lifecycle: "failed",
          origin: "interceptor",
          connectionId,
          requestId,
          sessionId,
          correlation: requestCorrelation,
          http: { method, target },
          error: {
            code: "CLIENT_ABORTED",
            message: "Client aborted before the request completed",
          },
        });
      });
    });

    await new Promise<void>((resolve, reject) => {
      const server = this.server!;
      const onError = (error: Error) => {
        server.off("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        server.off("error", onError);
        resolve();
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(this.listenPort, this.listenHost);
    });
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    this.context = undefined;
    if (!server?.listening) return;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }

  address(): { host: string; port: number } | undefined {
    const address = this.server?.address();
    return address && typeof address === "object"
      ? { host: address.address, port: address.port }
      : undefined;
  }

  private connectionIdFor(request: IncomingMessage): string {
    let connectionId = this.socketIds.get(request.socket);
    if (!connectionId) {
      connectionId = randomUUID();
      this.socketIds.set(request.socket, connectionId);
    }
    return connectionId;
  }

  private upstreamHeaders(request: IncomingMessage): {
    headers: IncomingHttpHeaders;
    transformations: string[];
  } {
    return {
      headers: {
        ...request.headers,
        host: `${this.upstreamHost}:${this.upstreamPort}`,
      },
      transformations: [
        `host: ${request.headers.host ?? "<missing>"} -> ${this.upstreamHost}:${this.upstreamPort}`,
      ],
    };
  }
}

function headerPairs(rawHeaders: string[]): Header[] {
  const pairs: Header[] = [];
  for (let index = 0; index < rawHeaders.length; index += 2) {
    pairs.push({
      name: rawHeaders[index] ?? "",
      value: redactHeader(rawHeaders[index] ?? "", rawHeaders[index + 1] ?? ""),
    });
  }
  return pairs;
}

function redactHeader(name: string, value: string): string {
  return /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key)$/i.test(
    name,
  )
    ? "[REDACTED]"
    : value;
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

function captureBlob(
  context: RecorderContext,
  chunks: Buffer[],
  headers: IncomingHttpHeaders,
): Record<string, unknown> {
  const body = Buffer.concat(chunks);
  return {
    ...context.storeArtifact(
      body,
      mediaType(headers) ?? "application/octet-stream",
    ),
    contentEncoding: contentEncoding(headers),
  };
}
