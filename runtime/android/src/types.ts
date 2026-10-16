import type { ReplayFlow } from "@byted-lynx/actonce-replay";
import type {
  AndroidCheckpointActual,
  AndroidCheckpointExpectation,
} from "./checkpoint.js";
import type { AndroidSession } from "./session.js";

export type Point = { x: number; y: number };
export type AndroidNodeIdentity = {
  type?: string;
  text?: string;
  contentDescription?: string;
  resourceId?: string;
};
export type AndroidNodeSelector = AndroidNodeIdentity & {
  /** Exact direct-parent and unique direct-sibling context; never a global index. */
  withinParent?: { selector: AndroidNodeIdentity; sibling: AndroidNodeIdentity };
};
export type AndroidSessionOptions = {
  serial?: string;
  androidAdbPath?: string;
  displayId?: number;
  screenshotStrategy?: "auto" | "always-yadb";
  systemPort?: number;
  /** Evidence-backed logical app names mapped to Android package names. */
  appNameMapping?: Readonly<Record<string, string>>;
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
