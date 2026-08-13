import type { ReplayFlow } from "@actonce/replay";
import type { IOSCheckpointActual, IOSCheckpointExpectation } from "./checkpoint.js";
import type { IOSSession } from "./session.js";

export type Point = { x: number; y: number };

export type IOSSessionOptions = {
  wdaHost?: string;
  wdaPort?: number;
  sessionId?: string;
  wdaMjpegPort?: number;
  autoDismissKeyboard?: boolean;
};

export type IOSReplayContext = {
  ios: IOSSession;
  args: string[];
  scriptPath: string;
  scriptIndex: number;
  flow: ReplayFlow<IOSCheckpointExpectation, IOSCheckpointActual>;
};

export type IOSReplayScript = (context: IOSReplayContext) => Promise<void> | void;
export type IOSReplayModule = {
  default?: IOSReplayScript;
  run?: IOSReplayScript;
  config?: IOSSessionOptions;
};
