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
import { IOSSession } from "./session.js";
import { createIOSReplayFlow } from "./checkpoint.js";
import type { IOSCheckpointActual, IOSCheckpointExpectation } from "./checkpoint.js";
import { replayIOSPrimitive } from "./primitives.js";
import type { RecordedIOSPrimitive } from "./primitives.js";
import type { IOSSessionOptions } from "./types.js";

export type IOSExecuteOptions = {
  fromSegmentId?: string;
  session?: IOSSessionOptions;
  emit?: (event: ReplayEvent<IOSCheckpointActual>) => void | Promise<void>;
  /** Injectable for tests; defaults to a real IOSSession.connect. */
  connect?: (options?: IOSSessionOptions) => Promise<IOSSession>;
};

export type IOSExecuteReport = {
  result: ReplayResult<IOSCheckpointExpectation, IOSCheckpointActual>;
  diagnostics: ReplayDiagnostics;
};

/** Parse + validate an iOS plan from a `plan.json` file path. */
export async function loadIOSPlan(path: string): Promise<ReplayPlanFile<IOSCheckpointExpectation>> {
  const raw = await readFile(path, "utf8");
  const plan = parseReplayPlan<IOSCheckpointExpectation>(raw);
  if (plan.platform !== "ios") {
    throw new Error(`plan.platform is ${plan.platform}, expected ios`);
  }
  return plan;
}

/**
 * Execute a compiled iOS plan (the "execute many" stage). Compile is a separate
 * stage that produced the `plan.json`; here we only run it. The result is
 * checkpoint-centric: a pass reports nothing about the path, a failure names the
 * important checkpoint that was not reached. Plan execution is deterministic;
 * an agent may restore the app and resume at a later segment with
 * `fromSegmentId`.
 */
export async function executeIOSPlan(
  plan: ReplayPlanFile<IOSCheckpointExpectation>,
  options: IOSExecuteOptions = {},
): Promise<IOSExecuteReport> {
  const connect = options.connect ?? ((session) => IOSSession.connect(session));
  const ios = await connect(options.session);
  try {
    const flow = createIOSReplayFlow(ios, {
      policy: "disabled",
      emit: options.emit,
    });
    const runOptions: RunReplayPlanOptions = {};
    if (options.fromSegmentId !== undefined) runOptions.fromSegmentId = options.fromSegmentId;
    const result = await runReplayPlan(
      flow,
      plan,
      (action: SerializablePrimitive) =>
        replayIOSPrimitive(ios, action as RecordedIOSPrimitive),
      runOptions,
    );
    return { result, diagnostics: flow.diagnostics() };
  } finally {
    await ios.close();
  }
}
