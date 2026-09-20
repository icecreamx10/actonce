import type { Readable, Writable } from "node:stream";
export type StableTreeAnchor = {
    version: 1;
    source: "cdp-dom";
    canonicalHash: string;
};
/**
 * Bidirectional JSONL sidecar for products that already own a CDP connection.
 * The product only supplies raw DOM snapshots; ActOnce owns settling, stale
 * session rejection, canonicalization, deadlines, and metrics.
 */
export declare class ExternalCdpCheckpointService {
    private readonly output;
    private readonly pendingCaptures;
    private readonly activeRequests;
    constructor(output: Writable);
    serve(input: Readable): Promise<void>;
    private waitForStableTree;
    private waitForAnchor;
    private waitForReady;
    private capture;
    private resolveCapture;
    private write;
}
export declare function serveExternalCdpCheckpoints(input: Readable, output: Writable): Promise<void>;
//# sourceMappingURL=external-checkpoint-service.d.ts.map