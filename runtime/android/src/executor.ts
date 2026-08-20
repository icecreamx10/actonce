import { readFile } from "node:fs/promises";
import {
  parseReplayPlan,
  runReplayPlan,
} from "@byted-lynx/actonce-replay";
import type {
  ReplayDiagnostics,
  ReplayEvent,
  ReplayPlanFile,
  ReplayResult,
  RunReplayPlanOptions,
  SerializablePrimitive,
} from "@byted-lynx/actonce-replay";
import { AndroidSession } from "./session.js";
import { createAndroidReplayFlow } from "./checkpoint.js";
import type {
  AndroidCheckpointActual,
  AndroidCheckpointExpectation,
} from "./checkpoint.js";
import { replayAndroidPrimitive } from "./primitives.js";
import type { RecordedAndroidPrimitive } from "./primitives.js";
import type { AndroidSessionOptions } from "./types.js";

export type AndroidExecuteOptions = {
  fromSegmentId?: string;
  session?: AndroidSessionOptions;
  emit?: (event: ReplayEvent<AndroidCheckpointActual>) => void | Promise<void>;
  /** Injectable for tests; defaults to a real AndroidSession.connect. */
  connect?: (options?: AndroidSessionOptions) => Promise<AndroidSession>;
};

export type AndroidExecuteReport = {
  result: ReplayResult<AndroidCheckpointExpectation, AndroidCheckpointActual>;
  diagnostics: ReplayDiagnostics;
};

/** Parse + validate an Android plan from a `plan.json` file path. */
export async function loadAndroidPlan(
  path: string,
): Promise<ReplayPlanFile<AndroidCheckpointExpectation>> {
  const raw = await readFile(path, "utf8");
  const plan = parseReplayPlan<AndroidCheckpointExpectation>(raw);
  if (plan.platform !== "android") {
    throw new Error(`plan.platform is ${plan.platform}, expected android`);
  }
  return plan;
}

/**
 * Execute a compiled Android plan (the "execute many" stage). Compile produced
 * the `plan.json`; this only runs it. The result is checkpoint-centric: a pass
 * reports nothing about the path, a failure names the important checkpoint that
 * was not reached. Plan execution is deterministic; an agent may restore the app
 * and resume at a later segment with `fromSegmentId`.
 */
export async function executeAndroidPlan(
  plan: ReplayPlanFile<AndroidCheckpointExpectation>,
  options: AndroidExecuteOptions = {},
): Promise<AndroidExecuteReport> {
  const connect = options.connect ?? ((session) => AndroidSession.connect(session));
  const android = await connect(options.session);
  try {
    const flow = createAndroidReplayFlow(android, {
      policy: "disabled",
      emit: options.emit,
    });
    const runOptions: RunReplayPlanOptions = {};
    if (options.fromSegmentId !== undefined) runOptions.fromSegmentId = options.fromSegmentId;
    const result = await runReplayPlan(
      flow,
      plan,
      (action: SerializablePrimitive) =>
        replayAndroidPrimitive(android, action as RecordedAndroidPrimitive),
      runOptions,
    );
    return { result, diagnostics: flow.diagnostics() };
  } finally {
    await android.close();
  }
}
