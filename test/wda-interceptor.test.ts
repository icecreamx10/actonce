import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RecordingWriter } from "../interceptor/src/common/recording-writer.js";
import { WdaInterceptor } from "../interceptor/src/sources/wda/wda-interceptor.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((path) => rm(path, { recursive: true })),
  );
});

describe("WDA source interceptor", () => {
  it("forwards HTTP and emits causally linked request and response spans", async () => {
    const upstream = createServer((incoming, response) => {
      const chunks: Buffer[] = [];
      incoming.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
      incoming.on("end", () => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ value: Buffer.concat(chunks).toString() }));
      });
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    const upstreamAddress = upstream.address();
    if (!upstreamAddress || typeof upstreamAddress === "string") {
      throw new Error("Expected a TCP upstream address");
    }

    const rootDir = await mkdtemp(join(tmpdir(), "actonce-wda-test-"));
    temporaryRoots.push(rootDir);
    const session = await RecordingWriter.create({
      platform: "ios",
      recorder: "test",
      rootDir,
      recordingId: "recording",
    });
    const wda = new WdaInterceptor({
      listenHost: "127.0.0.1",
      listenPort: 0,
      upstreamHost: "127.0.0.1",
      upstreamPort: upstreamAddress.port,
    });
    await session.attach(wda);
    const proxyAddress = wda.address();
    if (!proxyAddress) throw new Error("WDA interceptor did not listen");

    const responseBody = await new Promise<string>((resolve, reject) => {
      const outgoing = request(
        {
          host: "127.0.0.1",
          port: proxyAddress.port,
          method: "POST",
          path: "/session/test/element/1/click",
          headers: { "content-type": "application/json" },
        },
        (response) => {
          const chunks: Buffer[] = [];
          response.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
          response.on("end", () => resolve(Buffer.concat(chunks).toString()));
        },
      );
      outgoing.on("error", reject);
      outgoing.end('{"tap":true}');
    });
    expect(JSON.parse(responseBody)).toEqual({ value: '{"tap":true}' });

    await session.close();
    await new Promise<void>((resolve, reject) =>
      upstream.close((error) => (error ? reject(error) : resolve())),
    );

    const events = (
      await readFile(join(rootDir, "recording", "events.ndjson"), "utf8")
    )
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(events.map((event) => event.kind)).toEqual([
      "http.request.started",
      "http.request.completed",
      "http.response.started",
      "http.response.completed",
    ]);
    expect(events.every((event) => event.source.type === "wda")).toBe(true);
    expect(new Set(events.map((event) => event.correlation.traceId)).size).toBe(1);
    expect(events[2].correlation.parentSpanId).toBe(
      events[0].correlation.spanId,
    );
  });
});

