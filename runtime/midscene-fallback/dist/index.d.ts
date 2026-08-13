import type { FallbackDriver, FallbackRequest, FallbackResult } from "@byted-lynx/actonce-replay";
export type MidsceneFallbackAgent = {
    aiAction(prompt: string, options?: {
        abortSignal?: AbortSignal;
        context?: string;
        cacheable?: boolean;
    }): Promise<string | undefined>;
    addProgressListener?: (listener: (event: {
        scope: string;
        phase: string;
    }) => void | Promise<void>) => () => void;
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