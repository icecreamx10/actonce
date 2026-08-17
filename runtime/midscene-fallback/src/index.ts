import type {
  CorrectiveAction,
  FallbackDriver,
  FallbackRequest,
  FallbackResult,
} from "@byted-lynx/actonce-replay";

export type MidsceneProgressEvent = {
  scope: string;
  phase: string;
  /** Optional concrete action descriptor, when the Midscene build reports one. */
  type?: string;
  actionType?: string;
  element?: { description?: string; id?: string };
};

export type MidsceneFallbackAgent = {
  aiAction(
    prompt: string,
    options?: { abortSignal?: AbortSignal; context?: string; cacheable?: boolean },
  ): Promise<string | undefined>;
  addProgressListener?: (
    listener: (event: MidsceneProgressEvent) => void | Promise<void>,
  ) => () => void;
};

export type MidsceneFallbackOptions = {
  context?: string;
  maxPromptValueLength?: number;
};

export class MidsceneFallbackDriver<TExpectation, TActual>
implements FallbackDriver<TExpectation, TActual> {
  constructor(
    private readonly agent: MidsceneFallbackAgent,
    private readonly options: MidsceneFallbackOptions = {},
  ) {}

  async recover(
    request: FallbackRequest<TExpectation, TActual>,
  ): Promise<FallbackResult> {
    if (request.constraints.observationOnly) {
      return {
        status: "declined",
        reason: "The segment is never-retry; action fallback is disabled for its postcondition.",
      };
    }

    const controller = new AbortController();
    const timeoutMs = request.constraints.timeoutMs ?? 30_000;
    const maxActions = request.constraints.maxActions ?? 5;
    let actionCount = 0;
    const actions: CorrectiveAction[] = [];
    const removeProgressListener = this.agent.addProgressListener?.((event) => {
      if (event.scope !== "aiAct" || event.phase !== "action_running") return;
      actionCount += 1;
      actions.push(normalizeCorrectiveAction(event));
      if (actionCount > maxActions) {
        controller.abort(new Error(`Midscene fallback exceeded ${maxActions} UI actions`));
      }
    });
    const timer = setTimeout(() => controller.abort(new Error("Midscene fallback timed out")), timeoutMs);
    try {
      await this.agent.aiAction(buildMidsceneFallbackPrompt(request, this.options), {
        abortSignal: controller.signal,
        cacheable: false,
        context: this.options.context,
      });
      if (controller.signal.aborted) throw controller.signal.reason;
      const result: FallbackResult = { status: "completed", actionCount };
      if (actions.length > 0) {
        result.corrective = {
          segmentId: request.segmentId,
          phase: request.phase,
          attempt: request.attempt,
          actions,
        };
      }
      return result;
    } catch (error) {
      return {
        status: "failed",
        reason: error instanceof Error ? error.message : String(error),
      };
    } finally {
      clearTimeout(timer);
      removeProgressListener?.();
    }
  }
}

export function buildMidsceneFallbackPrompt<TExpectation, TActual>(
  request: FallbackRequest<TExpectation, TActual>,
  options: MidsceneFallbackOptions = {},
): string {
  const allowedApps = request.constraints.allowedApps?.length
    ? request.constraints.allowedApps.join(", ")
    : "the currently controlled application only";
  const forbidden = request.constraints.forbiddenActions?.length
    ? request.constraints.forbiddenActions.join(", ")
    : "saving, destructive actions, and unrelated application changes";
  const maxActions = request.constraints.maxActions ?? 5;
  const details = compactJson({
    expected: request.expected.expected,
    differences: request.differences,
  }, options.maxPromptValueLength ?? 4_000);
  return [
    `Recover only replay segment '${request.segmentId}' at its ${request.phase}.`,
    `Local goal: ${request.goal}`,
    `Allowed applications: ${allowedApps}.`,
    `Forbidden actions: ${forbidden}.`,
    `Use at most ${maxActions} UI actions. Do not continue to later task steps.`,
    "Stop as soon as the local goal is visibly satisfied. The runtime will independently verify the checkpoint.",
    `Checkpoint evidence: ${details}`,
  ].join("\n");
}

/**
 * Reduce a Midscene progress event to a normalized corrective action. Only the
 * action kind and a normalized element description are kept — never typed text,
 * clipboard contents, coordinates, screenshots, or model reasoning
 * (skills/compile-device-recording/SKILL.md:46).
 */
function normalizeCorrectiveAction(event: MidsceneProgressEvent): CorrectiveAction {
  const kind = normalizeKind(event.actionType ?? event.type);
  const target = event.element?.description ?? event.element?.id;
  const action: CorrectiveAction = { kind };
  if (target) action.target = target;
  return action;
}

function normalizeKind(raw: string | undefined): string {
  if (!raw) return "action";
  return raw
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[_\s]+/g, "-")
    .toLowerCase();
}

function compactJson(value: unknown, maxLength: number): string {
  const serialized = JSON.stringify(value, (_key, nested) => {
    if (typeof nested === "string" && nested.length > 500) return `${nested.slice(0, 500)}…`;
    return nested;
  });
  return serialized.length <= maxLength ? serialized : `${serialized.slice(0, maxLength)}…`;
}
