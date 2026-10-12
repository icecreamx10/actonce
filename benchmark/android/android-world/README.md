# AndroidWorld benchmark

[English](README.md) | [简体中文](README.zh-CN.md)

This harness runs the official AndroidWorld `SystemBrightnessMax` task, which
Midscene reported as PASS in round 1. It pins AndroidWorld commit
`3e50888527ef9f29b9157ecd537e408008bb1c85`, a Pixel 6/API 33 AVD, the task's
fixed `max` parameters, and AndroidWorld's own initializer and reward validator.

## Coverage target

The pinned Midscene report contains 116 AndroidWorld tasks. Round 1 passed 108;
the union of tasks passing by round 3 contains 113. The repository catalog
preserves every round status and treats the final 113-task set as the complete
coverage target. List either set offline:

```bash
npm run android-world:catalog -- --selection pass@1 --format lines
npm run android-world:catalog -- --selection pass@3 --format lines
```

## Formal snapshots

Original recording can explicitly select `--model-profile codex-6.1-sol` for
`gpt-6.1-sol` through the authenticated local Codex app server. Verify that profile
with `npm run android-world:model:verify -- --model-profile codex-6.1-sol` before
measurement. Existing Luna profiles and defaults are unchanged. Preserve each
case's actual model/revision provenance; replay stays model-free and successful
originals are reused rather than re-recorded on a model change.

The [October 10–12 audit](REPRODUCTION-2026-10-12.md) freshly verifies all five
strict-slice tasks and six broader tasks. Its per-case revisions and original
reuse are explicit; it does not claim full-suite coverage or aggregate unlike revisions.

The earlier zero-context, one-sample formal slice below covers four of the 113 target
tasks. Every replay passed the official AndroidWorld reward gate with no AI
fallback or replay retry:

| Task | Original | Replay | Speedup |
| --- | ---: | ---: | ---: |
| `BrowserMaze` | 478.567 s | 18.282 s | 26.18× |
| `ClockStopWatchPausedVerify` | 26.081 s | 6.919 s | 3.77× |
| `ClockStopWatchRunning` | 48.110 s | 5.889 s | 8.17× |
| `ClockTimerEntry` | 126.280 s | 8.045 s | 15.70× |
| **Comparable total** | **679.038 s** | **39.135 s** | **17.35×** |

This is a correctness-gated partial result, not a claim of full-suite coverage.
The remaining catalog cases stay visible until they have a complete,
officially successful original and a Skill-compiled replay that passes the same
official validator.

Full-suite app installation and snapshots are measurement-external setup:

The emulator launcher defaults to software-emulated front/back cameras, never
the host webcam. `ACTONCE_EMULATOR_CAMERA_BACK` and
`ACTONCE_EMULATOR_CAMERA_FRONT` can override them (including `none`). Requested
cameras must enumerate before the launcher declares readiness; an older running
emulator with disabled cameras must be restarted, not silently reused for camera
tasks. No app data is wiped by that restart.

```bash
npm run android-world:prepare-suite
```

Generated cases persist exact AndroidWorld parameters in a sample-local
`params.pickle` and a readable `task.json` summary. Initialization and official
validation must reuse that same state directory.

App-data snapshots do not restore Android runtime permission grants. New original
runs also capture user-0 grant states in `task-state/runtime-permissions.json`;
replay restores and verifies that baseline before launching the app, outside
measurement. Preserve this file with parameters when staging a formal replay.
Only task-declared packages and their installed runtime permissions are accepted;
the CLI never resets whole-device permissions. Grant state is restored, not
arbitrary AppOps or system/user permission flags.

Legacy originals have no automatic baseline. When their raw evidence proves a
required initial grant state, author an audited fixture file and pass
`--fixture-permissions <file>` to the public benchmark CLI. Record evidence paths
and hashes in `execution-environment.json`; do not invent unknown grant states,
remove permission-dialog actions, or add permission repair to measured replay.
The JSON format is:

```json
{"schemaVersion":1,"userId":0,"packages":[{"package":"com.example.app","permissions":{"android.permission.RECORD_AUDIO":false}}]}
```

Missing legacy baselines remain explicitly `unavailable` in result metadata rather
than silently claiming permission parity. A permission command or verification
failure stops setup; neither weakens checkpoints nor manufactures a pass.

Repository-owned patches under `patches/` are applied idempotently by bootstrap
and remain part of the pinned environment provenance. They may fix setup or
stability without changing task intent or the official success condition.

Native fixture preparation also verifies Clipper with a clipboard round-trip
and VLC with its app-created media database before saving their snapshots.
These checks repair onboarding outside measurement; older ready entries for
these apps are invalidated automatically.
Ready entries are also invalidated if their snapshot directory is missing on
the current emulator; a host-side setup manifest alone is not readiness proof.
Fixture snapshots use `/data/local/tmp/actonce-android-world/snapshots`, outside
Android's package-owned data directories. Preparation migrates existing legacy
snapshots without overwriting new snapshots or deleting the originals.
`task.py` resolves the repository's installed FFmpeg binary before loading
official media generators. None of these
repairs changes task goals or the official evaluator.
The benchmark bridge preserves AndroidEnv command retries without killing the
host-wide ADB daemon, so one worker's failed device command cannot disconnect
other emulators.

To retry only environment failures, preserve the previous campaign and build a
new plan (same task seeds and device assignments):

```bash
npx tsx benchmark/android/android-world/parallel-original.ts --phase plan --retry-setup-failures-from <previous-root> --output <new-root>
```

Run each planned worker from a fresh benchmark agent after preparing its device.

Create and resume the full matrix in explicit phases:

```bash
npm run benchmark:android:android-world-suite -- --phase plan --selection pass@3 --output <suite-root>
npm run benchmark:android:android-world-suite -- --phase original --selection pass@3 --output <suite-root>
npm run benchmark:android:android-world-suite -- --phase replay --selection pass@3 --output <suite-root>
npm run benchmark:android:android-world-suite -- --phase evaluate --selection pass@3 --output <suite-root>
```

Between `original` and `replay`, use the published
`skills/synthesize-device-replay` Skill on each complete official-pass
recording. There is intentionally no automatic benchmark synthesis command.

The formal default is intentionally serial: one emulator, one sample per case,
and no cross-case averaging. The suite pins the `codex-luna` model profile,
which runs `gpt-5.6-luna` through the locally authenticated Codex app server.
The model profile is applied by the CLI, recorded as safe provenance in every
result, and contains no API key. Verify it independently with:

```bash
npm run android-world:model:verify
```

Compilation is an agent Skill, not a benchmark script. It preserves recorded
actions by default, derives evidence-compatible checkpoints, and may optimize a
coordinate to a native selector only after proving uniqueness, semantic
alignment, and fresh-fixture correctness. The original coordinate remains the
fallback.
Screenshot capture, accessibility capture, actual settle delay, skipped
already-satisfied primitives, and fallback count are reported separately.
Midscene and the recorder share one persistent UIAutomator2 session for native
tree reads. This preserves accessibility checkpoints while avoiding a new
`uiautomator dump` process for every observation.

Original and replay use the same measurement-external app setup: the CLI
force-stops declared target packages, launches the first official target app,
and verifies foreground focus before timing. A permission modal counts as ready
only when its exact foreground activity is proven to have been requested by the
target package; it is left for the measured agent to handle, not pre-granted.
`OpenAppTaskEval` instead retains the official home start without prelaunching any
candidate app or satisfying the task during preparation.
AndroidWorld's AccessibilityForwarder
is enabled for official initialization and validation, then suspended while the
shared UIAutomator2 measurement session is active. A device lease rejects a
second benchmark process targeting the same emulator.

Earlier automatic-compiler development artifacts are preserved for diagnosis
but are not current benchmark evidence. New replay results count only after the
published compilation Skill has generated, executed, repaired, and validated
the sample from its immutable recording.

Each phase skips completed artifacts unless `--force` is provided. Use
`--task <TaskName>` to work on one catalog case without changing its denominator
or directory identity.

```bash
npm run android-world:bootstrap
npm run android-world:check
npm run android-world:start:foreground
# In another shell after boot:
npm run android-world:prepare
npm run benchmark:android:android-world
```

The CLI resets the official task independently before original and replay. The
Midscene original is captured through the `midscene-android` recorder. Replay
uses only the native ActOnce Android runtime and keeps accessibility checkpoints
inside its measured duration. AndroidWorld validation runs after each mode and
is excluded from the agent execution boundary, as in the upstream benchmark.

The full formal suite also uses one original and one replay per case. Use the
repository-internal `benchmark-android-world` Skill for context isolation,
correctness gating, artifact preservation, and resumable execution requirements.

Upstream evidence:

- [AndroidWorld repository](https://github.com/google-research/android_world)
- [Midscene AndroidWorld report](https://midscenejs.com/android-world-benchmark-report)
- [Published SystemBrightnessMax PASS report](https://midscenejs.com/android-world-benchmark-report?file=Task-79-SystemBrightnessMax__group-8-47bb9356-d880-425c-87cc-e0a575c206fe-Pass.html)
