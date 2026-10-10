"""Offline regression tests for measurement-external fixture preparation."""
import os
import unittest
from unittest.mock import patch, Mock

import environment


class EnvironmentTest(unittest.TestCase):
  def test_snapshot_migration_preserves_existing_destinations(self):
    with patch.object(environment, "adb") as adb:
      environment.migrate_legacy_snapshots(["example.app"])
      command = adb.call_args.args[1]
      self.assertIn("[ ! -e '/data/local/tmp/actonce-android-world/snapshots/example.app' ]", command)
      self.assertNotIn("rm ", command)

  def test_snapshot_migration_rejects_unsafe_packages(self):
    with patch.object(environment, "adb"):
      with self.assertRaises(ValueError):
        environment.migrate_legacy_snapshots(["../other"])

  def test_recovery_does_not_kill_shared_server(self):
    controller = Mock()
    environment.recover_shared_adb(controller, timeout=5)
    controller.init_server.assert_called_once_with(timeout=5)
    controller.execute_command.assert_not_called()

  def test_existing_ffmpeg_is_used(self):
    with patch.object(environment.shutil, "which", return_value="/usr/bin/ffmpeg"), \
         patch.dict(os.environ, {}, clear=True), \
         patch.object(environment.subprocess, "run") as run:
      environment.configure_host()
      self.assertEqual(os.environ["IMAGEIO_FFMPEG_EXE"], "/usr/bin/ffmpeg")
      run.assert_not_called()

  def test_control_coordinates_come_from_tree(self):
    xml = '<hierarchy><node text="Continue" enabled="true" package="permissions" bounds="[10,20][30,40]"/></hierarchy>'
    with patch.object(environment, "adb", side_effect=["dumped", xml, ""]) as adb:
      self.assertTrue(environment.click_setup_control(texts=("continue",), packages=("permissions",)))
      self.assertEqual(adb.call_args.args, ("shell", "input", "tap", "20", "30"))

  def test_unrelated_controls_are_not_clicked(self):
    xml = '<hierarchy><node text="OK" enabled="true" package="other" bounds="[10,20][30,40]"/></hierarchy>'
    with patch.object(environment, "adb", side_effect=["dumped", xml]) as adb:
      self.assertFalse(environment.click_setup_control(texts=("ok",), packages=("permissions",)))
      self.assertEqual(adb.call_count, 2)

  def test_android_error_with_zero_exit_is_failure(self):
    with patch.object(environment.subprocess, "run", return_value=Mock(stdout="Error: Activity not started")):
      with self.assertRaises(RuntimeError):
        environment.adb("shell", "am", "start")

  def test_host_trap_retries_read_but_not_tap(self):
    import subprocess
    trap = subprocess.CalledProcessError(-5, ["adb"])
    with patch.object(environment.subprocess, "run", side_effect=[trap, Mock(stdout="ready")]), \
         patch.object(environment.time, "sleep"):
      self.assertEqual(environment.adb("shell", "test"), "ready")
    with patch.object(environment.subprocess, "run", side_effect=trap) as run:
      with self.assertRaises(subprocess.CalledProcessError):
        environment.adb("shell", "input", "tap", "1", "1")
      self.assertEqual(run.call_count, 1)


if __name__ == "__main__":
  unittest.main()
