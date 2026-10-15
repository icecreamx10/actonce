"""Measurement-external host dependencies and verified native app fixtures."""

import os
from pathlib import Path
import re
import shutil
import subprocess
import time
import xml.etree.ElementTree as ET

SNAPSHOT_ROOT = "/data/local/tmp/actonce-android-world/snapshots"


def configure_fixture_storage():
  from android_world.env import device_constants
  # Do not put non-package-owned fixture data under Android's app-data root.
  # Use a dedicated durable device directory, retaining official snapshot APIs.
  device_constants.SNAPSHOT_DATA = SNAPSHOT_ROOT


def migrate_legacy_snapshots(packages):
  packages = sorted(set(packages))
  for package in packages:
    if not re.fullmatch(r"[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*", package):
      raise ValueError(f"Invalid fixture package name: {package}")
  adb("root")
  adb("wait-for-device")
  legacy = "/data/data/android_world/snapshots"
  for package in packages:
    source, target = f"{legacy}/{package}", f"{SNAPSHOT_ROOT}/{package}"
    # Never replace a new snapshot or delete the legacy copy.
    adb("shell", f"if [ -d '{source}' ] && [ ! -e '{target}' ]; then "
        f"mkdir -p '{target}' && cp -a '{source}/.' '{target}/'; fi")


def configure_host():
  # gRPC fork diagnostics can otherwise enter ADB's merged output pipe and
  # corrupt official parsers expecting a number/JSON. Match the benchmark CLI
  # even when task.py is invoked directly during environment diagnostics.
  os.environ.setdefault("GRPC_VERBOSITY", "ERROR")
  # Resolve the installed npm binary before pydub/moviepy are imported.
  if not shutil.which("ffmpeg"):
    root = Path(__file__).resolve().parents[3]
    result = subprocess.run(
        ["node", "-p", "require('@ffmpeg-installer/ffmpeg').path"],
        cwd=root, capture_output=True, text=True, check=True)
    binary = Path(result.stdout.strip())
    if not binary.is_file() or not os.access(binary, os.X_OK):
      raise RuntimeError("Install @ffmpeg-installer/ffmpeg before AndroidWorld setup")
    os.environ["PATH"] = str(binary.parent) + os.pathsep + os.environ.get("PATH", "")
  os.environ.setdefault("IMAGEIO_FFMPEG_EXE", shutil.which("ffmpeg"))


def recover_shared_adb(controller, timeout=None):
  # Upstream retries failed device commands by killing the host-wide daemon.
  # Even an expected APK ABI mismatch then disconnects every other worker.
  # Retain upstream retries/error propagation, but only ensure the server exists.
  controller.init_server(timeout=timeout)


def configure_shared_adb():
  from android_env.components.adb_controller import AdbController
  AdbController._restart_server = recover_shared_adb


def adb(*args):
  binary = os.environ.get("ADB_PATH", str(Path.home() / "Library/Android/sdk/platform-tools/adb"))
  serial = os.environ.get("ACTONCE_ANDROID_SERIAL", "emulator-5554")
  for attempt in range(3):
    try:
      result = subprocess.run([binary, "-s", serial, *args], capture_output=True,
                              text=True, timeout=30, check=True)
      break
    except subprocess.CalledProcessError as error:
      # Host adb occasionally traps during emulator boot. Retry fixture-only,
      # idempotent reads/launches; never retry a potentially delivered tap.
      if error.returncode != -5 or "input" in args or attempt == 2:
        raise
      time.sleep(0.5)
  if "Error:" in result.stdout or "Error type" in result.stdout:
    raise RuntimeError(f"ADB fixture operation failed: {result.stdout.strip()}")
  return result.stdout


def click_setup_control(ids=(), texts=(), packages=()):
  path = "/data/local/tmp/actonce-fixture.xml"
  adb("shell", "uiautomator", "dump", path)
  tree = ET.fromstring(adb("shell", "cat", path))
  for node in tree.iter("node"):
    if packages and node.get("package") not in packages:
      continue
    if node.get("enabled") != "true":
      continue
    if node.get("resource-id") in ids or node.get("text", "").casefold() in texts:
      bounds = [int(value) for value in re.findall(r"\d+", node.get("bounds", ""))]
      if len(bounds) == 4:
        adb("shell", "input", "tap", str((bounds[0] + bounds[2]) // 2),
            str((bounds[1] + bounds[3]) // 2))
        return True
  return False


def verify_fixture(app_name, env):
  """Repair onboarding, prove capabilities, then replace the official snapshot.

  Never synthesize task state or database contents. These operations run only
  during prepare-app, outside all original/replay timing boundaries.
  """
  from android_world.env import adb_utils
  from android_world.utils import app_snapshot

  if app_name == "clipper":
    adb("shell", "am", "start", "-W", "-n", "ca.zgrs.clipper/.Main")
    for _ in range(4):
      if not click_setup_control(
          ids=("com.android.permissioncontroller:id/continue_button", "android:id/button1"),
          texts=("continue", "ok"),
          packages=("com.google.android.permissioncontroller", "ca.zgrs.clipper")):
        break
    probe = "actonce-fixture-clipboard-probe"
    adb_utils.set_clipboard_contents(probe, env.controller)
    if adb_utils.get_clipboard_contents(env.controller) != probe:
      raise RuntimeError("Clipper clipboard round-trip failed")
    # ADB's argument transport drops empty strings; use an inert fixture value.
    adb_utils.set_clipboard_contents("actonce-fixture-ready", env.controller)
  elif app_name == "vlc":
    package = "org.videolan.vlc"
    adb("shell", "appops", "set", package, "MANAGE_EXTERNAL_STORAGE", "allow")
    adb("shell", "pm", "grant", package, "android.permission.POST_NOTIFICATIONS")
    adb("shell", "am", "start", "-W", "-a", "android.intent.action.MAIN",
        "-c", "android.intent.category.LAUNCHER", "-n", package + "/.StartActivity")
    deadline = time.monotonic() + 45
    while time.monotonic() < deadline:
      exists = adb("shell",
                   "test -s /data/data/org.videolan.vlc/app_db/vlc_media.db && echo ready || true")
      if exists.strip() == "ready":
        break
      click_setup_control(ids=("org.videolan.vlc:id/skip_button",),
                          texts=("grant permission", "ok", "allow"),
                          packages=(package, "com.google.android.permissioncontroller"))
      time.sleep(0.5)
    else:
      raise RuntimeError("VLC did not create its media database during onboarding")
  else:
    return
  adb_utils.close_app(app_name, env.controller)
  app_snapshot.save_snapshot(app_name, env.controller)


def verify_saved_snapshot(app, env):
  from android_world.env import device_constants
  from android_world.utils import file_utils
  snapshot = f"{device_constants.SNAPSHOT_DATA}/{app.package_name()}"
  if not file_utils.check_directory_exists(snapshot, env.controller):
    raise RuntimeError(f"App setup completed without a usable snapshot: {app.app_name}")
