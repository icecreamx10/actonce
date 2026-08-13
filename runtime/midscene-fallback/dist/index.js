export class MidsceneFallbackDriver {
    agent;
    options;
    constructor(agent, options = {}) {
        this.agent = agent;
        this.options = options;
    }
    async recover(request) {
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
        const removeProgressListener = this.agent.addProgressListener?.((event) => {
            if (event.scope !== "aiAct" || event.phase !== "action_running")
                return;
            actionCount += 1;
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
            if (controller.signal.aborted)
                throw controller.signal.reason;
            return { status: "completed", actionCount };
        }
        catch (error) {
            return {
                status: "failed",
                reason: error instanceof Error ? error.message : String(error),
            };
        }
        finally {
            clearTimeout(timer);
            removeProgressListener?.();
        }
    }
}
export function buildMidsceneFallbackPrompt(request, options = {}) {
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
function compactJson(value, maxLength) {
    const serialized = JSON.stringify(value, (_key, nested) => {
        if (typeof nested === "string" && nested.length > 500)
            return `${nested.slice(0, 500)}…`;
        return nested;
    });
    return serialized.length <= maxLength ? serialized : `${serialized.slice(0, maxLength)}…`;
}
//# sourceMappingURL=index.js.map