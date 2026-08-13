import type { Browser } from "webdriverio";
import type { ReplayFlow } from "@actonce/replay";
import type { MacCheckpointActual, MacCheckpointExpectation } from "./checkpoint.js";

export type MacLocator =
  | { accessibilityId: string }
  | { id: string }
  | { name: string }
  | { className: string }
  | { predicate: string }
  | { classChain: string }
  | { xpath: string }
  | { raw: string };

export type MacSessionOptions = {
  bundleId?: string;
  appPath?: string;
  arguments?: string[];
  environment?: Record<string, string>;
  noReset?: boolean;
  skipAppKill?: boolean;
  server?: {
    hostname?: string;
    port?: number;
    path?: string;
    start?: boolean;
    logPath?: string;
    startupTimeoutMs?: number;
  };
  mac2?: {
    systemPort?: number;
    showServerLogs?: boolean;
    webDriverAgentMacUrl?: string;
  };
  capabilities?: Record<string, unknown>;
  logLevel?: "trace" | "debug" | "info" | "warn" | "error" | "silent";
};

export type WaitOptions = {
  timeoutMs?: number;
  intervalMs?: number;
  message?: string;
};

export type Point = { x: number; y: number };
export type Rect = { x: number; y: number; width: number; height: number };

export type MacReplayContext = {
  mac: import("./session.js").MacSession;
  driver: Browser;
  args: string[];
  scriptPath: string;
  scriptIndex: number;
  flow: ReplayFlow<MacCheckpointExpectation, MacCheckpointActual>;
  windowSetup?: import("./window-setup.js").MacWindowSetupResult;
};

export type MacReplayScript = (
  context: MacReplayContext,
) => Promise<void> | void;

export type MacReplayModule = {
  default?: MacReplayScript;
  run?: MacReplayScript;
  config?: MacSessionOptions;
};
