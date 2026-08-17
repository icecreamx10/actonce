const DEFAULT_WINDOW = 20;
const DEFAULT_EWMA_ALPHA = 0.3;
/**
 * Persistent per-segment profile store. Injectable `readFile`/`writeFile`/`now`
 * keep it unit-testable and keep `runtime/common` free of a hard `node:fs`
 * dependency at import time (the default fs is loaded lazily on use).
 */
export class ProfileStore {
    options;
    window;
    ewmaAlpha;
    now;
    segments;
    constructor(options, initial) {
        this.options = options;
        this.window = options.window ?? DEFAULT_WINDOW;
        this.ewmaAlpha = options.ewmaAlpha ?? DEFAULT_EWMA_ALPHA;
        this.now = options.now ?? Date.now;
        this.segments = initial;
    }
    static async load(options) {
        const file = await readStoreFile(options);
        return new ProfileStore(options, file?.segments ?? {});
    }
    get(segmentId) {
        return this.segments[segmentId];
    }
    record(profile, correctives = []) {
        const didDeopt = profile.fallback.count > 0;
        const guardMs = totalGuardMs(profile);
        const timestamp = new Date(this.now()).toISOString();
        const prev = this.segments[profile.segmentId];
        const alpha = this.ewmaAlpha;
        const recentOutcomes = [...(prev?.recentOutcomes ?? []), profile.outcome].slice(-this.window);
        const deoptRateEwma = prev
            ? alpha * Number(didDeopt) + (1 - alpha) * prev.deoptRateEwma
            : Number(didDeopt);
        const guardMsEwma = prev
            ? alpha * guardMs + (1 - alpha) * prev.guardMsEwma
            : guardMs;
        const matched = recentOutcomes.filter((outcome) => outcome === "matched").length;
        this.segments[profile.segmentId] = {
            recordingId: this.options.recordingId,
            segmentId: profile.segmentId,
            sampleCount: (prev?.sampleCount ?? 0) + 1,
            deoptCount: (prev?.deoptCount ?? 0) + (didDeopt ? 1 : 0),
            deterministicFailures: (prev?.deterministicFailures ?? 0) + profile.deterministicFailures,
            deoptRateEwma,
            guardMsEwma,
            recentOutcomes,
            fallbackOutcomes: addOutcomes(prev?.fallbackOutcomes, profile.fallback.outcomes),
            hotness: 1 - deoptRateEwma,
            stability: recentOutcomes.length ? matched / recentOutcomes.length : 0,
            lastCorrectiveRefs: correctiveRefs(correctives) ?? prev?.lastCorrectiveRefs,
            firstSeenAt: prev?.firstSeenAt ?? timestamp,
            updatedAt: timestamp,
        };
    }
    snapshot() {
        return {
            schemaVersion: 1,
            recordingId: this.options.recordingId,
            segments: structuredClone(this.segments),
            updatedAt: new Date(this.now()).toISOString(),
        };
    }
    /**
     * Persist to disk with a per-segment read-merge-write so concurrent runs of
     * the same recording do not clobber each other's segments. Segments touched
     * in this process win; segments only present on disk are preserved.
     */
    async save() {
        const onDisk = await readStoreFile(this.options);
        const merged = { ...(onDisk?.segments ?? {}) };
        for (const [id, record] of Object.entries(this.segments)) {
            merged[id] = record;
        }
        this.segments = merged;
        const file = {
            schemaVersion: 1,
            recordingId: this.options.recordingId,
            segments: merged,
            updatedAt: new Date(this.now()).toISOString(),
        };
        const write = this.options.writeFile ?? (async (p, data) => {
            const { writeFile } = await import("node:fs/promises");
            await writeFile(p, data);
        });
        await write(this.options.path, `${JSON.stringify(file, null, 2)}\n`);
    }
}
async function readStoreFile(options) {
    const read = options.readFile ?? (async (p) => {
        const { readFile } = await import("node:fs/promises");
        return readFile(p, "utf8");
    });
    try {
        const raw = await read(options.path);
        const parsed = JSON.parse(raw);
        return parsed;
    }
    catch (error) {
        if (isNotFound(error))
            return undefined;
        throw error;
    }
}
function isNotFound(error) {
    return typeof error === "object" && error !== null && error.code === "ENOENT";
}
function totalGuardMs(profile) {
    const pre = profile.guard.precondition;
    const post = profile.guard.postcondition;
    return pre.captureDurationMs + pre.settleDelayMs + post.captureDurationMs + post.settleDelayMs;
}
function addOutcomes(prev, next) {
    return {
        completed: (prev?.completed ?? 0) + next.completed,
        declined: (prev?.declined ?? 0) + next.declined,
        failed: (prev?.failed ?? 0) + next.failed,
    };
}
function correctiveRefs(correctives) {
    if (!correctives.length)
        return undefined;
    const refs = [];
    for (const corrective of correctives) {
        for (const ref of corrective.evidenceRefs ?? [])
            refs.push(ref);
        for (const action of corrective.actions)
            refs.push(action.kind);
    }
    return refs.length ? refs : undefined;
}
//# sourceMappingURL=profile-store.js.map