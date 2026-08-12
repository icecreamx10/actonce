import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ComputerDevice } from "@midscene/computer";
import { afterEach, describe, expect, it } from "vitest";
import { RecordingWriter } from "../interceptor/src/common/recording-writer.js";
import { installComputerRecorder } from "../interceptor/src/macos/recording-computer-device.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((path) => rm(path, { recursive: true })),
  );
});

describe("macOS Midscene hooks", () => {
  it("links a logical action to its device primitive with one checkpoint pair", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "actonce-macos-test-"));
    temporaryRoots.push(rootDir);
    const writer = await RecordingWriter.create({
      platform: "macos",
      recorder: "test",
      rootDir,
      recordingId: "recording",
    });
    const existingHooks: string[] = [];
    const device = {
      screenshotBase64: async () =>
        `data:image/png;base64,${Buffer.from("screen").toString("base64")}`,
      size: async () => ({ width: 100, height: 80 }),
      beforeInvokeAction: async (_actionName: string, _param: unknown) => {
        existingHooks.push("before");
      },
      afterInvokeAction: async (_actionName: string, _param: unknown) => {
        existingHooks.push("after");
      },
      inputPrimitives: {
        pointer: {
          tap: async (_point: { x: number; y: number }) => undefined,
          doubleClick: async () => undefined,
          rightClick: async () => undefined,
          hover: async () => undefined,
          dragAndDrop: async () => undefined,
        },
        keyboard: {
          typeText: async () => undefined,
          keyboardPress: async () => undefined,
          clearInput: async () => undefined,
        },
        scroll: { scroll: async () => undefined },
      },
    };

    const restore = installComputerRecorder(
      device as unknown as ComputerDevice,
      writer,
    );
    await device.beforeInvokeAction("Tap", { locate: "Save" });
    await device.inputPrimitives.pointer.tap({ x: 25, y: 30 });
    await device.afterInvokeAction("Tap", { point: { x: 25, y: 30 } });
    restore();
    await writer.close();

    const events = (await readFile(
      join(rootDir, "recording", "events.ndjson"),
      "utf8",
    ))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const logicalStart = events.find(
      (event) => event.kind === "logical.action.started",
    );
    const primitiveStart = events.find(
      (event) => event.kind === "device.primitive.started",
    );
    const logicalComplete = events.find(
      (event) => event.kind === "logical.action.completed",
    );

    expect(existingHooks).toEqual(["before", "after"]);
    expect(events.filter((event) => event.kind === "checkpoint.captured")).toHaveLength(2);
    expect(primitiveStart.logicalActionId).toBe(logicalStart.actionId);
    expect(logicalComplete.actionId).toBe(logicalStart.actionId);
    expect(logicalStart.rawArguments).toEqual({ locate: "Save" });
    expect(logicalComplete.normalizedArguments).toEqual({
      point: { x: 25, y: 30 },
    });
  });
});
