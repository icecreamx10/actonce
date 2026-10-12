"""Host-only initializer RNG checkpoints, captured after official params generation."""
import json
import hashlib
import pickle
import random
import math


def numpy_module():
  try:
    import numpy
    return numpy
  except ImportError:
    return None


def capture():
  numpy = numpy_module()
  state = {"version": 1, "python": random.getstate(), "numpy": None}
  if numpy is not None:
    name, keys, position, gaussian, cached = numpy.random.get_state()
    state["numpy"] = [name, keys.tolist(), position, gaussian, cached]
  return state


def tuples(value):
  return tuple(tuples(item) for item in value) if isinstance(value, (tuple, list)) else value


def restore(state):
  """Validate both states without changing global RNGs, then restore atomically."""
  if not isinstance(state, dict) or set(state) != {"version", "python", "numpy"} or type(state["version"]) is not int or state["version"] != 1:
    raise ValueError("Malformed fixture RNG checkpoint")
  python_state = tuples(state["python"])
  if not isinstance(python_state, tuple) or len(python_state) != 3:
    raise ValueError("Malformed Python RNG checkpoint")
  if python_state[2] is not None and (type(python_state[2]) not in (int, float) or not math.isfinite(python_state[2])):
    raise ValueError("Malformed Python RNG Gaussian cache")
  random.Random().setstate(python_state)
  numpy = numpy_module()
  numpy_state = state["numpy"]
  if numpy_state is not None:
    if numpy is None:
      raise ValueError("Fixture RNG checkpoint requires numpy")
    if not isinstance(numpy_state, (list, tuple)) or len(numpy_state) != 5:
      raise ValueError("Malformed numpy RNG checkpoint")
    name, keys, position, gaussian, cached = numpy_state
    if (name != "MT19937" or not isinstance(keys, (list, tuple))
        or len(keys) != 624 or any(type(key) is not int or not 0 <= key < 2**32 for key in keys)
        or type(position) is not int or not 0 <= position <= 624
        or type(gaussian) is not int or gaussian not in (0, 1)
        or type(cached) not in (int, float) or not math.isfinite(cached)):
      raise ValueError("Malformed numpy RNG checkpoint")
    numpy_state = (name, numpy.asarray(keys, dtype=numpy.uint32), position, gaussian, cached)
    numpy.random.RandomState().set_state(numpy_state)
  elif numpy is not None:
    raise ValueError("Fixture RNG checkpoint was captured without numpy")
  random.setstate(python_state)
  if numpy_state is not None:
    numpy.random.set_state(numpy_state)


def seed_rng(seed):
  random.seed(seed)
  numpy = numpy_module()
  if numpy is not None:
    numpy.random.seed(seed % (2**32))


def prepare(task_class, task_name, state_dir, seed, jsonable, *, recover_legacy=False, record_current=False):
  """Return params and post-generation state; legacy recovery never writes originals."""
  params_file = state_dir / "params.pickle" if state_dir else None
  if params_file and params_file.exists():
    with params_file.open("rb") as source:
      params = pickle.load(source)
    metadata = json.loads((state_dir / "task.json").read_text())
    if metadata.get("task") != task_name:
      raise ValueError("Saved task identity mismatch")
    saved_seed = metadata.get("seed")
    if saved_seed is not None and (type(saved_seed) is not int):
      raise ValueError("Malformed saved seed")
    if seed is not None and saved_seed is not None and seed != saved_seed:
      raise ValueError("CLI seed conflicts with saved task seed")
    if "fixtureRng" in metadata:
      checkpoint = metadata["fixtureRng"]
      restore(checkpoint)
      return params, checkpoint
    if not recover_legacy:
      if record_current:
        checkpoint = capture()
        metadata.update(schemaVersion=2, fixtureRng=checkpoint,
                        fixtureRngProvenance={"kind": "new-original-existing-params-current-boundary"})
        (state_dir / "task.json").write_text(json.dumps(metadata, indent=2) + "\n")
        return params, checkpoint
      # Preserve historical initialization without inventing a recovered state.
      return params, None
    effective_seed = saved_seed if saved_seed is not None else seed
    if effective_seed is None:
      raise ValueError("Legacy fixture recovery requires a trustworthy seed")
    prior = capture()
    try:
      seed_rng(effective_seed)
      regenerated = task_class.generate_random_params()
      # Exact pickle representation includes official types and nested values;
      # do not substitute JSON projections or a params-internal seed.
      if pickle.dumps(regenerated) != pickle.dumps(params):
        raise ValueError("Legacy official parameter regeneration mismatch")
      checkpoint = capture()
    except Exception:
      restore(prior)
      raise
    return params, checkpoint
  if seed is not None:
    seed_rng(seed)
  params = task_class.generate_random_params()
  checkpoint = capture()
  if state_dir:
    state_dir.mkdir(parents=True, exist_ok=True)
    with params_file.open("wb") as output:
      pickle.dump(params, output)
    metadata = {"schemaVersion": 2, "task": task_name, "seed": seed,
                "params": jsonable(params), "fixtureRng": checkpoint}
    (state_dir / "task.json").write_text(json.dumps(metadata, indent=2) + "\n")
  return params, checkpoint


def prepare_legacy_copy(task_class, task_name, staged, original, seed, jsonable, attested):
  """Measurement-external recovery; preserve the evidence-bearing source."""
  if not attested or staged is None or original is None:
    raise ValueError("Legacy recovery requires origin attestation and staged/original state directories")
  if staged.resolve() == original.resolve():
    raise ValueError("Legacy RNG preparation must not write original task state")
  for name in ("params.pickle", "task.json"):
    target, source = staged / name, original / name
    if target.resolve() == source.resolve() or target.samefile(source):
      raise ValueError("Staged state aliases original state")
    if target.read_bytes() != source.read_bytes():
      raise ValueError("Staged task state must be an exact copy of original")
  params, checkpoint = prepare(task_class, task_name, staged, seed, jsonable, recover_legacy=True)
  metadata = json.loads((staged / "task.json").read_text())
  metadata.update(schemaVersion=2, fixtureRng=checkpoint,
                  fixtureRngProvenance={"kind": "legacy-seeded-regeneration",
                    "originalStateDir": str(original.resolve()),
                    "freshParameterGenerationAttested": True,
                    "seed": metadata.get("seed") if metadata.get("seed") is not None else seed,
                    "originalParamsSha256": hashlib.sha256((original / "params.pickle").read_bytes()).hexdigest(),
                    "originalMetadataSha256": hashlib.sha256((original / "task.json").read_bytes()).hexdigest(),
                    "exactParamsMatch": True})
  (staged / "task.json").write_text(json.dumps(metadata, indent=2) + "\n")
  return params
