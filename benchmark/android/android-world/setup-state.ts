export interface AppResult {
  app: string;
  status: "ready" | "failed";
  durationMs: number;
  exitCode: number | null;
  fixtureRevision?: number;
}

export function fixtureRevision(app: string) {
  return ["clipper", "vlc"].includes(app) ? 1 : 0;
}

export function invalidateStaleReady(
  results: Map<string, AppResult>,
  packages: Record<string, string>,
  snapshots: ReadonlySet<string>,
) {
  for (const [app, result] of results) {
    if (result.status === "ready" && (!snapshots.has(packages[app])
        || (result.fixtureRevision ?? 0) !== fixtureRevision(app))) {
      results.delete(app);
    }
  }
}
