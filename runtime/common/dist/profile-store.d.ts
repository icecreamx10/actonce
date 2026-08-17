import type { CorrectiveDemonstration, SegmentFallbackOutcomes, SegmentOutcome, SegmentProfile } from "./types.js";
/**
 * Cross-run rolling statistics for one segment, persisted between replays.
 * PR1 only accumulates and persists these; the tiering/retirement controller
 * (PR2) consumes them via a separate pure classifier.
 */
export type SegmentProfileRecord = {
    recordingId: string;
    segmentId: string;
    sampleCount: number;
    deoptCount: number;
    deterministicFailures: number;
    deoptRateEwma: number;
    guardMsEwma: number;
    recentOutcomes: SegmentOutcome[];
    fallbackOutcomes: SegmentFallbackOutcomes;
    hotness: number;
    stability: number;
    lastCorrectiveRefs?: string[];
    firstSeenAt: string;
    updatedAt: string;
};
export type ProfileStoreFile = {
    schemaVersion: 1;
    recordingId: string;
    segments: Record<string, SegmentProfileRecord>;
    updatedAt: string;
};
export type ProfileStoreOptions = {
    path: string;
    recordingId: string;
    now?: () => number;
    window?: number;
    ewmaAlpha?: number;
    readFile?: (p: string) => Promise<string>;
    writeFile?: (p: string, data: string) => Promise<void>;
};
/**
 * Persistent per-segment profile store. Injectable `readFile`/`writeFile`/`now`
 * keep it unit-testable and keep `runtime/common` free of a hard `node:fs`
 * dependency at import time (the default fs is loaded lazily on use).
 */
export declare class ProfileStore {
    private readonly options;
    private readonly window;
    private readonly ewmaAlpha;
    private readonly now;
    private segments;
    private constructor();
    static load(options: ProfileStoreOptions): Promise<ProfileStore>;
    get(segmentId: string): SegmentProfileRecord | undefined;
    record(profile: SegmentProfile, correctives?: CorrectiveDemonstration[]): void;
    snapshot(): ProfileStoreFile;
    /**
     * Persist to disk with a per-segment read-merge-write so concurrent runs of
     * the same recording do not clobber each other's segments. Segments touched
     * in this process win; segments only present on disk are preserved.
     */
    save(): Promise<void>;
}
//# sourceMappingURL=profile-store.d.ts.map