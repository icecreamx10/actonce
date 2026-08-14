import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { IOSAgent, IOSDevice, AndroidAgent, AndroidDevice, ComputerAgent, ComputerDevice } from "@byted-lynx/actonce-midscene-adapter";
import { RecordingWriter } from "./common/recording-writer.js";
import { agentForRecordedIOS } from "./ios/recording-ios-device.js";
import { agentForRecordedComputer } from "./macos/recording-computer-device.js";
import { WdaInterceptor } from "./sources/wda/wda-interceptor.js";
import { agentForRecordedAndroid } from "./android/recording-android-device.js";

export const RECORDING_PROFILES = [
  {
    id: "midscene-android",
    platform: "android",
    mode: "task-module",
    sources: ["midscene", "android-input", "checkpoint"],
    description:
      "Run a Midscene Android task with semantic, normalized input, screenshot, and UI-tree checkpoints.",
  },
  {
    id: "midscene-macos",
    platform: "macos",
    mode: "task-module",
    sources: ["midscene", "macos-input", "checkpoint"],
    description:
      "Run a Midscene Computer task with semantic, input, and screenshot checkpoints.",
  },
  {
    id: "midscene-ios",
    platform: "ios",
    mode: "task-module",
    sources: ["midscene", "wda", "checkpoint"],
    description:
      "Run a Midscene iOS task through WDA with semantic and native UI checkpoints.",
  },
  {
    id: "ios-wda",
    platform: "ios",
    mode: "proxy",
    sources: ["wda"],
    description: "Record any WDA client through a transparent HTTP proxy.",
  },
] as const;

export type RecordingProfileId = (typeof RECORDING_PROFILES)[number]["id"];

export function recordingProfile(id: string) {
  return RECORDING_PROFILES.find((profile) => profile.id === id);
}

export type RecordingRunOptions = {
  entry?: string;
  taskArgs?: string[];
  rootDir?: string;
  recordingId?: string;
  displayId?: string;
  listenHost?: string;
  listenPort?: number;
  upstreamHost?: string;
  upstreamPort?: number;
  serial?: string;
  adbPath?: string;
  exposeAdbShellAction?: boolean;
};

export type RecordingTaskContext<TAgent, TDevice> = {
  profile: RecordingProfileId;
  agent: TAgent;
  device: TDevice;
  recordingDir: string;
  args: string[];
};

type TaskFunction<TAgent, TDevice> = (
  context: RecordingTaskContext<TAgent, TDevice>,
) => Promise<void> | void;

export async function runRecordingProfile(
  profileId: RecordingProfileId,
  options: RecordingRunOptions,
): Promise<void> {
  if (profileId === "midscene-macos") {
    const task = await loadTask<ComputerAgent<ComputerDevice>, ComputerDevice>(
      requiredEntry(options),
    );
    const recorded = await agentForRecordedComputer(
      { displayId: options.displayId },
      { rootDir: options.rootDir, recordingId: options.recordingId },
    );
    try {
      await task({
        profile: profileId,
        agent: recorded.agent,
        device: recorded.device,
        recordingDir: recorded.writer.recordingDir,
        args: options.taskArgs ?? [],
      });
    } catch (error) {
      recorded.writer.markIncomplete(
        `Recording task failed: ${errorMessage(error)}`,
      );
      throw error;
    } finally {
      await recorded.close();
      console.log(`Recording: ${recorded.writer.recordingDir}`);
    }
    return;
  }

  if (profileId === "midscene-ios") {
    const task = await loadTask<IOSAgent, IOSDevice>(requiredEntry(options));
    const recorded = await agentForRecordedIOS(
      {},
      {},
      {
        rootDir: options.rootDir,
        recordingId: options.recordingId,
        listenHost: options.listenHost,
        listenPort: options.listenPort,
        upstreamHost: options.upstreamHost,
        upstreamPort: options.upstreamPort,
      },
    );
    try {
      await task({
        profile: profileId,
        agent: recorded.agent,
        device: recorded.device,
        recordingDir: recorded.writer.recordingDir,
        args: options.taskArgs ?? [],
      });
    } catch (error) {
      recorded.writer.markIncomplete(
        `Recording task failed: ${errorMessage(error)}`,
      );
      throw error;
    } finally {
      await recorded.close();
      console.log(`Recording: ${recorded.writer.recordingDir}`);
    }
    return;
  }

  if (profileId === "midscene-android") {
    const task = await loadTask<AndroidAgent, AndroidDevice>(
      requiredEntry(options),
    );
    const recorded = await agentForRecordedAndroid(
      {
        serial: options.serial,
        androidAdbPath: options.adbPath,
        exposeRunAdbShellAction: options.exposeAdbShellAction,
      },
      {},
      { rootDir: options.rootDir, recordingId: options.recordingId },
    );
    try {
      await task({
        profile: profileId,
        agent: recorded.agent,
        device: recorded.device,
        recordingDir: recorded.writer.recordingDir,
        args: options.taskArgs ?? [],
      });
    } catch (error) {
      recorded.writer.markIncomplete(
        `Recording task failed: ${errorMessage(error)}`,
      );
      throw error;
    } finally {
      await recorded.close();
      console.log(`Recording: ${recorded.writer.recordingDir}`);
    }
    return;
  }

  await runIOSWdaProxy(options);
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

export async function runIOSWdaProxy(
  options: RecordingRunOptions = {},
): Promise<void> {
  const listenHost = options.listenHost ?? "127.0.0.1";
  const listenPort = options.listenPort ?? 8200;
  const upstreamHost = options.upstreamHost ?? "127.0.0.1";
  const upstreamPort = options.upstreamPort ?? 8100;
  const session = await RecordingWriter.create({
    platform: "ios",
    recorder: "ios-wda-profile",
    rootDir: options.rootDir,
    recordingId: options.recordingId,
    metadata: {
      profile: "ios-wda",
      proxy: { listenHost, listenPort, upstreamHost, upstreamPort },
    },
  });
  const wda = new WdaInterceptor({
    listenHost,
    listenPort,
    upstreamHost,
    upstreamPort,
  });
  await session.attach(wda);
  const address = wda.address();
  console.log(
    `ActOnce ios-wda proxy: http://${address?.host ?? listenHost}:${address?.port ?? listenPort}`,
  );
  console.log(`WDA upstream: http://${upstreamHost}:${upstreamPort}`);
  console.log(`Recording: ${session.recordingDir}`);

  const signal = await waitForSignal();
  await session.close();
  console.log(`ActOnce recorder stopped by ${signal}`);
}

async function loadTask<TAgent, TDevice>(
  entry: string,
): Promise<TaskFunction<TAgent, TDevice>> {
  const module = (await import(pathToFileURL(resolve(entry)).href)) as {
    default?: unknown;
    run?: unknown;
  };
  const task = module.default ?? module.run;
  if (typeof task !== "function") {
    throw new Error(
      `Recording task module ${entry} must export default or named run function`,
    );
  }
  return task as TaskFunction<TAgent, TDevice>;
}

function requiredEntry(options: RecordingRunOptions): string {
  if (!options.entry) {
    throw new Error("This recording profile requires --entry <task-module>");
  }
  return options.entry;
}

function waitForSignal(): Promise<"SIGINT" | "SIGTERM"> {
  return new Promise((resolveSignal) => {
    const finish = (signal: "SIGINT" | "SIGTERM") => {
      process.off("SIGINT", onInterrupt);
      process.off("SIGTERM", onTerminate);
      resolveSignal(signal);
    };
    const onInterrupt = () => finish("SIGINT");
    const onTerminate = () => finish("SIGTERM");
    process.once("SIGINT", onInterrupt);
    process.once("SIGTERM", onTerminate);
  });
}
