import { randomUUID } from "node:crypto";
type Adb = (args: string[]) => Promise<string>;
// Exact directories cleared by pinned AndroidWorld _Camera.initialize_task().
const targets = [
  { directory: "Pictures", uri: "content://media/external/images/media" },
  { directory: "Movies", uri: "content://media/external/video/media" },
] as const;

export function scopedMediaRows(output: string, directory: "Pictures" | "Movies") {
  if (output.trim() === "No result found.") return [];
  const prefixes = [`/storage/emulated/0/${directory}/`, `/sdcard/${directory}/`];
  return output.trim().split(/\r?\n/).map(line => {
    const id = line.match(/^Row: \d+ _id=([1-9]\d*), /)?.[1];
    const path = line.match(/, _data=([^,\r\n]+)$/)?.[1];
    if (!id || !path || !prefixes.some(prefix => path.startsWith(prefix)) || path.includes("/.thumbnails/") || /\/\.{1,2}\//.test(path)) throw new Error("Unrecognized or out-of-scope MediaStore row; refusing cleanup");
    return { id, path };
  });
}

/** Repair orphan publication entries only after the official directory clear. */
export async function normalizeCameraPublication(adb: Adb) {
  // Validate every owned directory before the first mutation. Never delete files
  // or indexes for existing media, or reset the global MediaProvider database.
  const pending: Array<{ directory: string; path: string; name: string }> = [];
  for (const { directory } of targets) {
    const entries = (await adb(["shell", `if [ -d '/sdcard/${directory}' ]; then find '/sdcard/${directory}' -type f ! -path '/sdcard/${directory}/.thumbnails/*'; fi`])).trim();
    for (const path of entries ? entries.split(/\r?\n/) : []) {
      const pattern = directory === "Movies" ? /^\/sdcard\/Movies\/(\.pending-\d+-VID_\d{8}_\d{6}\.mp4)$/ : /^\/sdcard\/Pictures\/(\.pending-\d+-IMG_\d{8}_\d{6}\.jpe?g)$/;
      const name = path.match(pattern)?.[1];
      if (!name) throw new Error(`Official Camera fixture directory ${directory} is not empty; refusing MediaStore cleanup`);
      pending.push({ directory, path, name });
    }
  }
  const prepared = [];
  for (const { directory, uri } of targets) {
    const query = `content query --user 0 --uri '${uri}' --projection _id:_data --where \"(_data LIKE '/storage/emulated/0/${directory}/%' OR _data LIKE '/sdcard/${directory}/%') AND _data NOT LIKE '/storage/emulated/0/${directory}/.thumbnails/%' AND _data NOT LIKE '/sdcard/${directory}/.thumbnails/%'\"`;
    prepared.push({ directory, uri, query, rows: scopedMediaRows(await adb(["shell", query]), directory) });
  }
  const quarantineDirectory = pending.length ? `/data/local/tmp/actonce-android-world/quarantined-camera-publication/${randomUUID()}` : null;
  for (const item of pending) {
    await adb(["shell", "mkdir", "-p", `${quarantineDirectory}/${item.directory}`]);
    await adb(["shell", "mv", "--", item.path, `${quarantineDirectory}/${item.directory}/${item.name}`]);
  }
  const removed: Record<string, number> = {};
  for (const { directory, uri, query, rows } of prepared) {
    for (const row of rows) {
      // Recheck the exact selected path immediately before deleting its orphan
      // index. A newly created file must never be deleted as collateral damage.
      if ((await adb(["shell", `if [ -e '${row.path.replaceAll("'", "'\\''")}' ]; then printf 'exists'; fi`])).trim()) throw new Error("Media appeared during setup; refusing orphan index deletion");
      // MediaProvider write attribution rejects UID0 (no associated package).
      // Use the pinned emulator's real Android shell identity, not a forged
      // app attribution or direct SQLite edits; verify through the provider.
      await adb(["shell", "su", "2000", "content", "delete", "--user", "0", "--uri", `${uri}/${row.id}`]);
    }
    if (scopedMediaRows(await adb(["shell", query]), directory).length) throw new Error(`Camera ${directory} publication baseline did not clear`);
    removed[directory] = rows.length;
  }
  return { baseline: { kind: "official-camera-empty-directories-and-indexes" as const, directories: ["Pictures", "Movies"], rowCounts: { Pictures: 0, Movies: 0 }, pendingOutputs: 0, preservedThumbnailCaches: true }, removed, quarantinedFiles: pending.map(item => item.path), quarantineDirectory };
}
