import type { ReplayFlow } from "@byted-lynx/actonce-replay";
import type {
  AndroidCheckpointActual,
  AndroidCheckpointExpectation,
} from "./checkpoint.js";
import type { AndroidSession } from "./session.js";

export type Point = { x: number; y: number };
export type AndroidNodeSelector = {
  type?: string;
  text?: string;
  contentDescription?: string;
  resourceId?: string;
};
export type AndroidSessionOptions = {
  serial?: string;
  androidAdbPath?: string;
  displayId?: number;
  screenshotStrategy?: "auto" | "always-yadb";
  systemPort?: number;
};
export type AndroidReplayContext = {
  android: AndroidSession;
  args: string[];
  scriptPath: string;
  scriptIndex: number;
  flow: ReplayFlow<AndroidCheckpointExpectation, AndroidCheckpointActual>;
};
export type AndroidReplayScript = (
  context: AndroidReplayContext,
) => Promise<void> | void;
export type AndroidReplayModule = {
  default?: AndroidReplayScript;
  run?: AndroidReplayScript;
  config?: AndroidSessionOptions;
};
