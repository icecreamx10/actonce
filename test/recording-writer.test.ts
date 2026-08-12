import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { selectPlatform } from "../interceptor/src/common/platform.js";
import { RecordingWriter } from "../interceptor/src/common/recording-writer.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { recursive: true })));
});

describe("platform-neutral recording writer", () => {
  it("deduplicates artifacts and writes a finalized manifest", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "actonce-test-"));
    temporaryRoots.push(rootDir);
    const writer = await RecordingWriter.create({
      platform: "macos",
      recorder: "test",
      rootDir,
      recordingId: "recording",
    });

    const first = await writer.artifact(Buffer.from("same"), "text/plain");
    const second = await writer.artifact(Buffer.from("same"), "text/plain");
    writer.append({ kind: "test.event", artifact: first });
    await writer.close();

    expect(second).toEqual(first);
    expect(first.path).toMatch(/^artifacts\/[a-f0-9]{2}\/[a-f0-9]{64}$/);
    const manifest = JSON.parse(
      await readFile(join(rootDir, "recording", "manifest.json"), "utf8"),
    );
    expect(manifest).toMatchObject({
      platform: "macos",
      recorder: "test",
      status: "complete",
      eventCount: 1,
    });
  });

  it("honors an explicit platform without probing", async () => {
    await expect(selectPlatform("ios")).resolves.toBe("ios");
    await expect(selectPlatform("macos")).resolves.toBe("macos");
  });
});
