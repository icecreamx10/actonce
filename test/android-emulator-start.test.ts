import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";

const exec = promisify(execFile);

async function withFakeAdb(cameraMode: string, body: string) {
  const directory = await mkdtemp(join(tmpdir(), "actonce-camera-start-"));
  try {
    await mkdir(join(directory, "platform-tools"));
    await mkdir(join(directory, "emulator"));
    // Prevent the launcher from invoking SDK bootstrap before the reuse check.
    await writeFile(join(directory, "emulator/emulator"), "#!/usr/bin/env bash\nexit 99\n", { mode: 0o755 });
    await writeFile(join(directory, "platform-tools/adb"), `#!/usr/bin/env bash\nset -euo pipefail\nif [[ "$*" == *get-state ]]; then echo device; exit 0; fi\n${body}\n`, { mode: 0o755 });
    return await exec("bash", [resolve("scripts/android/start-emulator.sh")], {
      timeout: 5000,
      env: {
        ...process.env,
        ANDROID_SDK_ROOT: directory,
        ANDROID_HOME: directory,
        ACTONCE_EMULATOR_CAMERA_BACK: cameraMode,
        ACTONCE_EMULATOR_CAMERA_FRONT: cameraMode,
      },
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

it("reads a full large camera dump without grep early-exit/SIGPIPE false failure", async () => {
  const { stdout, stderr } = await withFakeAdb("emulated", `
if [[ "$*" == *"shell dumpsys media.camera" ]]; then
  echo 'Number of camera devices: 2'
  for ((index=0; index<5000; index++)); do
    echo 'camera characteristics padding for a large Android dumpsys output'
  done
  exit 0
fi
exit 99`);
  expect(stdout).toContain("Emulator already running");
  expect(stderr).toBe("");
});

it("allows explicit camera-free emulator reuse without consulting camera service", async () => {
  const { stdout } = await withFakeAdb("none", "exit 99");
  expect(stdout).toContain("Emulator already running");
});
