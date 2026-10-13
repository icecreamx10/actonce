import { describe, expect, it } from "vitest";
import { normalizeCameraPublication, scopedMediaRows } from "../benchmark/android/android-world/media-publication-fixture.js";

function fixture() {
  const calls: string[][] = [];
  let pictures = [{ id: "101", path: "/storage/emulated/0/Pictures/IMG_old.jpg" }];
  let movies = [{ id: "102", path: "/storage/emulated/0/Movies/VID_old.mp4" }, { id: "103", path: "/sdcard/Movies/VID_old2.mp4" }];
  const adb = async (args: string[]) => {
    calls.push(args);
    if (args[1]?.startsWith("content query")) {
      const rows = args[1].includes("images/media") ? pictures : movies;
      return rows.length ? rows.map((row, i) => `Row: ${i} _id=${row.id}, _data=${row.path}`).join("\n") : "No result found.\n";
    }
    if (args.includes("delete")) {
      const uri = args.at(-1)!;
      if (uri.includes("images/media")) pictures = pictures.filter(row => !uri.endsWith(`/${row.id}`));
      else movies = movies.filter(row => !uri.endsWith(`/${row.id}`));
    }
    return "";
  };
  return { adb, calls };
}

describe("official Camera publication fixture", () => {
  it("removes only selected orphan image/video row URIs and verifies empty scoped indexes", async () => {
    const { adb, calls } = fixture();
    expect(await normalizeCameraPublication(adb)).toEqual({ baseline: { kind: "official-camera-empty-directories-and-indexes", directories: ["Pictures", "Movies"], rowCounts: { Pictures: 0, Movies: 0 }, pendingOutputs: 0, preservedThumbnailCaches: true }, removed: { Pictures: 1, Movies: 2 }, quarantinedFiles: [], quarantineDirectory: null });
    expect(calls.filter(args => args.includes("delete")).map(args => args.at(-1))).toEqual(["content://media/external/images/media/101", "content://media/external/video/media/102", "content://media/external/video/media/103"]);
    expect(calls).toContainEqual(["shell", "su", "2000", "content", "delete", "--user", "0", "--uri", "content://media/external/video/media/102"]);
    expect(calls.some(args => args.includes("rm") || args.includes("clear") || args.at(-1) === "content://media/external/video/media")).toBe(false);
  });
  it("quarantines exact Camera-named unpublished files without deleting thumbnail caches or existing media", async () => {
    const { adb, calls } = fixture();
    const pending = "/sdcard/Movies/.pending-1697988850-VID_20231015_153410.mp4";
    const result = await normalizeCameraPublication(async args => args[1]?.includes("find '/sdcard/Movies'") ? pending : adb(args));
    expect(result.quarantinedFiles).toEqual([pending]);
    expect(result.quarantineDirectory).toMatch(/^\/data\/local\/tmp\/actonce-android-world\/quarantined-camera-publication\/[a-f0-9-]+$/);
    expect(calls).toContainEqual(["shell", "mv", "--", pending, `${result.quarantineDirectory}/Movies/.pending-1697988850-VID_20231015_153410.mp4`]);
    expect(calls.some(args => args.includes("rm"))).toBe(false);
    expect(() => scopedMediaRows("Row: 0 _id=1, _data=/storage/emulated/0/Pictures/.thumbnails/preserved.jpg", "Pictures")).toThrow("out-of-scope");
  });
  it("refuses a nonempty official folder before any deletion", async () => {
    const { adb, calls } = fixture();
    await expect(normalizeCameraPublication(async args => args[1]?.includes("find '/sdcard/Movies'") ? "/sdcard/Movies/actual.mp4" : adb(args))).rejects.toThrow("not empty");
    expect(calls.some(args => args.includes("delete"))).toBe(false);
  });
  it("validates both scopes before deleting either, refuses unknown provider output", async () => {
    const { adb, calls } = fixture();
    await expect(normalizeCameraPublication(async args => args[1]?.startsWith("content query") && args[1].includes("video/media") ? "Row: 0 _id=102, _data=/storage/emulated/0/Documents/private.mp4" : adb(args))).rejects.toThrow("out-of-scope");
    expect(calls.some(args => args.includes("delete"))).toBe(false);
    expect(() => scopedMediaRows("Permission Denial", "Movies")).toThrow("Unrecognized");
    expect(() => scopedMediaRows("Row: 0 _id=1, _data=/storage/emulated/0/Movies2/private.mp4", "Movies")).toThrow("out-of-scope");
  });
  it("refuses index deletion if an actual file appeared after preflight", async () => {
    const { adb, calls } = fixture();
    await expect(normalizeCameraPublication(async args => args[1]?.startsWith("if [ -e ") ? "exists" : adb(args))).rejects.toThrow("Media appeared");
    expect(calls.some(args => args.includes("delete"))).toBe(false);
  });
  it("fails closed if deletion did not update the scoped provider", async () => {
    const { adb } = fixture();
    await expect(normalizeCameraPublication(async args => args.includes("delete") ? "Deleted 0 rows." : adb(args))).rejects.toThrow("did not clear");
  });
});
