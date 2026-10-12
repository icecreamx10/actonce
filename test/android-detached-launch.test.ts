import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("detached Android emulator launcher", () => {
  it("survives its launching process and owns a separate process group", async () => {
    const directory = await mkdtemp(join(tmpdir(), "actonce-detached-launch-"));
    const log = join(directory, "launch with spaces.log");
    let pid: number | undefined;
    try {
      const result = spawnSync(process.execPath, ["scripts/android/spawn-detached.mjs", log, process.execPath,
        "-e", "console.log(JSON.stringify(process.argv.slice(1))); setInterval(() => {}, 1000)", "arg with spaces"], { encoding: "utf8", timeout: 5000 });
      expect(result.status).toBe(0);
      pid = Number(result.stdout.trim());
      expect(Number.isSafeInteger(pid) && pid > 0).toBe(true);
      process.kill(pid, 0);
      const group = spawnSync("ps", ["-o", "pgid=", "-p", String(pid)], { encoding: "utf8" });
      expect(Number(group.stdout.trim())).toBe(pid);
      await expect.poll(async () => readFile(log, "utf8")).toContain('["arg with spaces"]');
    } finally {
      if (pid && Number.isSafeInteger(pid) && pid > 0) {
        try { process.kill(pid, "SIGTERM"); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
      }
    }
  });
  it("reports a spawn error rather than returning a fictitious pid", async () => {
    const directory = await mkdtemp(join(tmpdir(), "actonce-detached-error-"));
    const result = spawnSync(process.execPath, ["scripts/android/spawn-detached.mjs", join(directory, "launch.log"), join(directory, "missing-emulator")], { encoding: "utf8", timeout: 5000 });
    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("ENOENT");
  });
});
