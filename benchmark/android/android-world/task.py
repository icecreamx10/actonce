#!/usr/bin/env python3
"""Invoke the pinned AndroidWorld initializer and validator for one fixed case."""

import argparse
import json
from pathlib import Path

from android_world.env import env_launcher
from android_world.env.setup_device import apps, setup
from android_world.task_evals.single.system import SystemBrightnessMax

TASK = "SystemBrightnessMax"
PARAMS = {"max_or_min": "max"}


def connect():
  return env_launcher.load_and_setup_env(
      console_port=5554,
      adb_path=str(Path.home() / "Library/Android/sdk/platform-tools/adb"),
      grpc_port=8554,
      freeze_datetime=False,
  )


def main():
  parser = argparse.ArgumentParser()
  parser.add_argument("command", choices=("prepare", "initialize", "evaluate"))
  args = parser.parse_args()
  env = connect()
  try:
    if args.command == "prepare":
      setup.setup_apps(env, (apps.SettingsApp,))
      output = {"status": "ready", "task": TASK}
    elif args.command == "initialize":
      env.reset(go_home=True)
      task = SystemBrightnessMax(PARAMS)
      task.initialize_task(env)
      output = {
          "status": "initialized",
          "task": task.name,
          "goal": task.goal,
          "params": task.params,
      }
    else:
      task = SystemBrightnessMax(PARAMS)
      # AndroidWorld keeps this bit on the task object between initialize and
      # validation. The CLI phases are separate processes but target one device.
      task.initialized = True
      reward = task.is_successful(env)
      output = {
          "status": "passed" if reward == 1.0 else "failed",
          "task": task.name,
          "reward": reward,
          "validator": "android_world.task_evals.single.system.SystemBrightnessMax.is_successful",
      }
    print(json.dumps(output))
  finally:
    env.close()


if __name__ == "__main__":
  main()
