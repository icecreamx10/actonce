#!/usr/bin/env python3
"""Invoke pinned AndroidWorld task setup, initialization, and validation."""

import argparse
import dataclasses
import json
import os
import pickle
import sys
from fixture_rng import prepare as prepare_params, prepare_legacy_copy, restore
from pathlib import Path
from typing import Any

from environment import (adb, configure_host, configure_shared_adb,
                         configure_fixture_storage, migrate_legacy_snapshots,
                         verify_fixture, verify_saved_snapshot)

configure_host()

from android_world import registry
from android_world.env import env_launcher
from android_world.env.setup_device import apps, setup

configure_fixture_storage()

TASK = "SystemBrightnessMax"
PARAMS = {"max_or_min": "max"}


def connect():
  configure_shared_adb()
  serial = os.environ.get("ACTONCE_ANDROID_SERIAL", "emulator-5554")
  console_port = int(os.environ.get(
      "ACTONCE_EMULATOR_PORT", serial.removeprefix("emulator-")))
  return env_launcher.load_and_setup_env(
      console_port=console_port,
      adb_path=str(Path.home() / "Library/Android/sdk/platform-tools/adb"),
      grpc_port=int(os.environ.get("ACTONCE_EMULATOR_GRPC_PORT", "8554")),
      freeze_datetime=False,
  )


def main():
  parser = argparse.ArgumentParser()
  parser.add_argument("command", choices=("list-apps", "inspect-fixtures", "migrate-fixtures", "prepare", "prepare-app", "prepare-fixture-rng", "initialize", "evaluate"))
  parser.add_argument("--task", default=TASK)
  parser.add_argument("--state-dir", type=Path)
  parser.add_argument("--seed", type=int)
  parser.add_argument("--original-state-dir", type=Path)
  parser.add_argument("--legacy-generated-params", action="store_true")
  parser.add_argument("--record-fixture-rng", action="store_true")
  parser.add_argument("--suite", action="store_true")
  parser.add_argument("--app")
  args = parser.parse_args()
  if args.command == "prepare-fixture-rng":
    prepare_legacy_copy(get_task_class(args.task), args.task, args.state_dir,
                        args.original_state_dir, args.seed, jsonable,
                        args.legacy_generated_params)
    print(json.dumps({"status": "fixture-rng-prepared", "task": args.task,
                      "state_dir": str(args.state_dir.resolve())}), flush=True)
    return
  if args.command == "list-apps":
    print(json.dumps({"apps": [app.app_name for app in setup._APPS],
                      "packages": {app.app_name: app.package_name() for app in setup._APPS}}), flush=True)
    return
  if args.command == "inspect-fixtures":
    from android_world.env import device_constants
    directories = adb("shell", f"ls {device_constants.SNAPSHOT_DATA} 2>/dev/null || true")
    print(json.dumps({"snapshots": directories.split()}), flush=True)
    return
  if args.command == "migrate-fixtures":
    migrate_legacy_snapshots({app.package_name() for app in setup._APPS})
    print(json.dumps({"status": "migrated"}), flush=True)
    return
  # Resolve and validate host state before connection/reset can mutate a device.
  if args.command in ("initialize", "evaluate"):
    task_class = get_task_class(args.task)
    if args.command == "initialize":
      if args.task == TASK and args.state_dir is None and args.seed is None:
        params, fixture_rng = PARAMS, None
      else:
        params, fixture_rng = prepare_params(task_class, args.task, args.state_dir, args.seed, jsonable,
                                             record_current=args.record_fixture_rng)
      if fixture_rng is None:
        print("Warning: fixtureRng=legacy-uncontrolled; fixture equivalence is unproven", file=sys.stderr, flush=True)
    else:
      params = load_params(args.task, args.state_dir)
    if args.command == "evaluate":
      task = task_class(params)
      restore_validator_state(task, args.state_dir)
  env = connect()
  try:
    if args.command == "prepare":
      setup.setup_apps(env, None if args.suite else (apps.SettingsApp,))
      if args.suite:
        for name in ("clipper", "vlc"):
          verify_fixture(name, env)
      for app in (setup._APPS if args.suite else (apps.SettingsApp,)):
        verify_saved_snapshot(app, env)
      output = {"status": "ready", "scope": "suite" if args.suite else "settings"}
    elif args.command == "prepare-app":
      app = setup.get_app_mapping(args.app)
      if app is None:
        raise ValueError(f"Unknown AndroidWorld app: {args.app}")
      setup.setup_apps(env, (app,))
      verify_fixture(args.app, env)
      verify_saved_snapshot(app, env)
      output = {"status": "ready", "scope": "app", "app": args.app}
    elif args.command == "initialize":
      env.reset(go_home=True)
      # Connection may consume randomness: restore the pre-construction boundary.
      if fixture_rng is not None:
        restore(fixture_rng)
      task = task_class(params)
      clear_validator_state(args.state_dir)
      # Upstream warns and skips missing snapshots. A formal benchmark must
      # instead reject an unprepared device, even if its host manifest is old.
      for app_name in task_class.app_names:
        app = setup.get_app_mapping(app_name)
        if app is not None:
          verify_saved_snapshot(app, env)
      task.initialize_task(env)
      save_validator_state(task, args.state_dir)
      output = {
          "status": "initialized",
          "task": task.name,
          "goal": task.goal,
          "params": jsonable(task.params),
          "apps": task_apps(task_class),
          "state_dir": str(args.state_dir.resolve()) if args.state_dir else None,
          "fixtureRng": "checkpoint-restored" if fixture_rng is not None else "legacy-uncontrolled",
      }
    else:
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


def task_apps(task_class):
  result = []
  for app_name in task_class.app_names:
    app = setup.get_app_mapping(app_name)
    result.append({
        "name": app_name,
        "package": app.package_name() if app is not None else None,
    })
  return result


def load_or_create_params(task_class, task_name: str, state_dir: Path | None, seed: int | None):
  if task_name == TASK and state_dir is None and seed is None:
    return PARAMS
  params, _ = prepare_params(task_class, task_name, state_dir, seed, jsonable)
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


def validator_state_path(state_dir: Path):
  return state_dir / "validator-state.pickle"


def clear_validator_state(state_dir: Path | None) -> None:
  if state_dir is None:
    return
  validator_state_path(state_dir).unlink(missing_ok=True)


def save_validator_state(task, state_dir: Path | None) -> None:
  """Persist state AndroidWorld validators expect from initialize_task()."""
  if state_dir is None:
    return
  state_dir.mkdir(parents=True, exist_ok=True)
  destination = validator_state_path(state_dir)
  temporary = destination.with_suffix(".tmp")
  with temporary.open("wb") as output:
    pickle.dump(task.__dict__, output)
  temporary.replace(destination)


def restore_validator_state(task, state_dir: Path | None) -> None:
  """Restore the initialized task lifecycle across CLI process boundaries."""
  if state_dir is None:
    # The fixed SystemBrightnessMax canary has no generated state directory.
    task.initialized = True
    return
  source = validator_state_path(state_dir)
  if not source.exists():
    raise RuntimeError(
        f"Missing validator state at {source}. Run initialize before evaluate."
    )
  with source.open("rb") as input_file:
    state = pickle.load(input_file)
  if not isinstance(state, dict):
    raise TypeError(f"Invalid validator state in {source}: expected a dict.")
  task.__dict__.update(state)


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
