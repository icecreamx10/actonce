"""Host-only tests: no Android imports or device operations."""
import json
from pathlib import Path
import pickle
import random
import shutil
import tempfile
import unittest
from unittest.mock import patch

import fixture_rng as rng


class OfficialFake:
  @staticmethod
  def generate_random_params():
    return {"value": random.randrange(100000), "seed": 999}


class FixtureRngTest(unittest.TestCase):
  def prepare(self, directory, seed=42, task=OfficialFake, recover=False):
    return rng.prepare(task, "Fake", directory, seed, lambda value: value, recover_legacy=recover)

  def test_checkpoint_replays_after_prior_consumption(self):
    with tempfile.TemporaryDirectory() as directory:
      directory = Path(directory)
      params, checkpoint = self.prepare(directory)
      expected = [random.random() for _ in range(5)]
      for _ in range(100):
        random.random()
      loaded, _ = self.prepare(directory)
      self.assertEqual(params, loaded)
      self.assertEqual(expected, [random.random() for _ in range(5)])
      self.assertEqual(params["seed"], 999)

  def test_legacy_recovery_preserves_files(self):
    with tempfile.TemporaryDirectory() as directory:
      directory = Path(directory)
      params, state = self.prepare(directory)
      metadata = {"task": "Fake", "seed": 42, "params": params}
      (directory / "task.json").write_text(json.dumps(metadata))
      before = {p.name: p.read_bytes() for p in directory.iterdir()}
      random.random()
      _, uncontrolled = self.prepare(directory)
      self.assertIsNone(uncontrolled)
      self.prepare(directory, recover=True)
      self.assertEqual(rng.capture(), state)
      self.assertEqual(before, {p.name: p.read_bytes() for p in directory.iterdir()})
      with self.assertRaises(ValueError):
        self.prepare(directory, seed=43)
      metadata["seed"] = None
      (directory / "task.json").write_text(json.dumps(metadata))
      with self.assertRaises(ValueError):
        self.prepare(directory, seed=None, recover=True)
      with (directory / "params.pickle").open("wb") as output:
        pickle.dump({"value": -1}, output)
      with self.assertRaises(ValueError):
        self.prepare(directory, recover=True)

  def test_malformed_state_does_not_change_rng(self):
    prior = rng.capture()
    with self.assertRaises((ValueError, TypeError)):
      rng.restore({"version": 1, "python": [], "numpy": None})
    self.assertEqual(prior, rng.capture())
    for value in (float("nan"), float("inf")):
      malformed = {**prior, "python": [prior["python"][0], prior["python"][1], value]}
      with self.assertRaises(ValueError):
        rng.restore(malformed)
      self.assertEqual(prior, rng.capture())
      if prior["numpy"] is not None:
        numpy_state = list(prior["numpy"])
        numpy_state[4] = value
        with self.assertRaises(ValueError):
          rng.restore({**prior, "numpy": numpy_state})
        self.assertEqual(prior, rng.capture())

  def test_without_numpy(self):
    with patch.object(rng, "numpy_module", return_value=None):
      rng.seed_rng(12)
      state = rng.capture()
      value = random.random()
      rng.restore(state)
      self.assertEqual(value, random.random())

  def test_numpy_replay(self):
    numpy = rng.numpy_module()
    if numpy is None:
      self.skipTest("numpy is not installed")
    rng.seed_rng(123)
    state = rng.capture()
    expected = numpy.random.random(5).tolist()
    rng.restore(state)
    self.assertEqual(expected, numpy.random.random(5).tolist())

  def test_staged_attestation_preserves_original_and_replays(self):
    with tempfile.TemporaryDirectory() as directory:
      original = Path(directory) / "original"
      staged = Path(directory) / "staged"
      params, checkpoint = self.prepare(original)
      metadata = {"task": "Fake", "seed": 42, "params": params}
      (original / "task.json").write_text(json.dumps(metadata))
      before = {p.name: p.read_bytes() for p in original.iterdir()}
      shutil.copytree(original, staged)
      with self.assertRaises(ValueError):
        rng.prepare_legacy_copy(OfficialFake, "Fake", staged, original, None, lambda x: x, False)
      with self.assertRaises(ValueError):
        rng.prepare_legacy_copy(OfficialFake, "Fake", original, original, None, lambda x: x, True)
      rng.prepare_legacy_copy(OfficialFake, "Fake", staged, original, None, lambda x: x, True)
      self.assertEqual(before, {p.name: p.read_bytes() for p in original.iterdir()})
      self.prepare(staged)
      self.assertEqual(checkpoint, rng.capture())
      self.assertTrue(json.loads((staged / "task.json").read_text())["fixtureRngProvenance"]["exactParamsMatch"])

  def test_new_original_reusing_params_captures_current_not_seeded_rng(self):
    with tempfile.TemporaryDirectory() as directory:
      directory = Path(directory)
      params, _ = self.prepare(directory)
      (directory / "task.json").write_text(json.dumps({"task": "Fake", "seed": 42}))
      params_bytes = (directory / "params.pickle").read_bytes()
      random.seed(717)
      random.random()
      expected = rng.capture()
      actual_params, captured = rng.prepare(OfficialFake, "Fake", directory, 42, lambda x: x, record_current=True)
      self.assertEqual(captured, expected)
      self.assertEqual(params, actual_params)
      self.assertEqual(params_bytes, (directory / "params.pickle").read_bytes())
      random.random()
      _, replay = rng.prepare(OfficialFake, "Fake", directory, 42, lambda x: x, record_current=True)
      self.assertEqual(rng.capture(), expected)


if __name__ == "__main__":
  unittest.main()
