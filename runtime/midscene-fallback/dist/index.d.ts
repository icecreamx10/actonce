import type { FallbackDriver, FallbackRequest, FallbackResult } from "@byted-lynx/actonce-replay";
export type MidsceneProgressEvent = {
    scope: string;
    phase: string;
    /** Optional concrete action descriptor, when the Midscene build reports one. */
    type?: string;
    actionType?: string;
    element?: {
        description?: string;
        id?: string;
    };
};
export type MidsceneFallbackAgent = {
    aiAction(prompt: string, options?: {
        abortSignal?: AbortSignal;
        context?: string;
        cacheable?: boolean;
    }): Promise<string | undefined>;
    addProgressListener?: (listener: (event: MidsceneProgressEvent) => void | Promise<void>) => () => void;
};
export type MidsceneFallbackOptions = {
    context?: string;
    maxPromptValueLength?: number;
};
export declare class MidsceneFallbackDriver<TExpectation, TActual> implements FallbackDriver<TExpectation, TActual> {
    private readonly agent;
    private readonly options;
    constructor(agent: MidsceneFallbackAgent, options?: MidsceneFallbackOptions);
    recover(request: FallbackRequest<TExpectation, TActual>): Promise<FallbackResult>;
}
export declare function buildMidsceneFallbackPrompt<TExpectation, TActual>(request: FallbackRequest<TExpectation, TActual>, options?: MidsceneFallbackOptions): string;
//# sourceMappingURL=index.d.ts.map