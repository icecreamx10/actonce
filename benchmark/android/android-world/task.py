#!/usr/bin/env python3
"""Invoke pinned AndroidWorld task setup, initialization, and validation."""

import argparse
import dataclasses
import json
import pickle
import random
from pathlib import Path
from typing import Any

from android_world import registry
from android_world.env import env_launcher
from android_world.env.setup_device import apps, setup

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
  parser.add_argument("command", choices=("list-apps", "prepare", "prepare-app", "initialize", "evaluate"))
  parser.add_argument("--task", default=TASK)
  parser.add_argument("--state-dir", type=Path)
  parser.add_argument("--seed", type=int)
  parser.add_argument("--suite", action="store_true")
  parser.add_argument("--app")
  args = parser.parse_args()
  if args.command == "list-apps":
    print(json.dumps({"apps": [app.app_name for app in setup._APPS]}), flush=True)
    return
  env = connect()
  try:
    if args.command == "prepare":
      setup.setup_apps(env, None if args.suite else (apps.SettingsApp,))
      output = {"status": "ready", "scope": "suite" if args.suite else "settings"}
    elif args.command == "prepare-app":
      app = setup.get_app_mapping(args.app)
      if app is None:
        raise ValueError(f"Unknown AndroidWorld app: {args.app}")
      setup.setup_apps(env, (app,))
      output = {"status": "ready", "scope": "app", "app": args.app}
    elif args.command == "initialize":
      env.reset(go_home=True)
      task_class = get_task_class(args.task)
      params = load_or_create_params(task_class, args.task, args.state_dir, args.seed)
      task = task_class(params)
      task.initialize_task(env)
      output = {
          "status": "initialized",
          "task": task.name,
          "goal": task.goal,
          "params": jsonable(task.params),
          "state_dir": str(args.state_dir.resolve()) if args.state_dir else None,
      }
    else:
      task_class = get_task_class(args.task)
      params = load_params(args.task, args.state_dir)
      task = task_class(params)
      # AndroidWorld keeps this bit on the task object between initialize and
      # validation. The CLI phases are separate processes but target one device.
      task.initialized = True
      reward = task.is_successful(env)
      output = {
          "status": "passed" if reward == 1.0 else "failed",
          "task": task.name,
          "reward": reward,
          "validator": f"{task_class.__module__}.{task_class.__name__}.is_successful",
      }
    print(json.dumps(output), flush=True)
  finally:
    env.close()


def get_task_class(task_name: str):
  task_registry = registry.TaskRegistry().get_registry(registry.TaskRegistry.ANDROID_WORLD_FAMILY)
  if task_name not in task_registry:
    raise ValueError(f"Unknown AndroidWorld task: {task_name}")
  return task_registry[task_name]


def load_or_create_params(task_class, task_name: str, state_dir: Path | None, seed: int | None):
  if state_dir and params_path(state_dir).exists():
    return load_params(task_name, state_dir)
  if task_name == TASK and state_dir is None and seed is None:
    return PARAMS
  if seed is not None:
    random.seed(seed)
    try:
      import numpy
      numpy.random.seed(seed % (2**32))
    except ImportError:
      pass
  params = task_class.generate_random_params()
  if state_dir:
    state_dir.mkdir(parents=True, exist_ok=True)
    with params_path(state_dir).open("wb") as output:
      pickle.dump(params, output)
    metadata = {
        "schemaVersion": 1,
        "task": task_name,
        "seed": seed,
        "params": jsonable(params),
    }
    (state_dir / "task.json").write_text(json.dumps(metadata, indent=2) + "\n")
  return params


def load_params(task_name: str, state_dir: Path | None):
  if state_dir is None:
    if task_name == TASK:
      return PARAMS
    raise ValueError("--state-dir is required to evaluate a generated task")
  with params_path(state_dir).open("rb") as source:
    return pickle.load(source)


def params_path(state_dir: Path):
  return state_dir / "params.pickle"


def jsonable(value: Any):
  if value is None or isinstance(value, (bool, int, float, str)):
    return value
  if dataclasses.is_dataclass(value):
    return jsonable(dataclasses.asdict(value))
  if isinstance(value, dict):
    return {str(key): jsonable(item) for key, item in value.items()}
  if isinstance(value, (list, tuple, set)):
    return [jsonable(item) for item in value]
  return {"type": f"{value.__class__.__module__}.{value.__class__.__name__}", "repr": repr(value)}


if __name__ == "__main__":
  main()
