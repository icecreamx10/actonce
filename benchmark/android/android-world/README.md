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

`SystemBrightnessMax` is the first completed case, not the whole suite.
Full-suite app installation and snapshots are measurement-external setup:

```bash
npm run android-world:prepare-suite
```

Generated cases persist exact AndroidWorld parameters in a sample-local
`params.pickle` and a readable `task.json` summary. Initialization and official
validation must reuse that same state directory.

Repository-owned patches under `patches/` are applied idempotently by bootstrap
and remain part of the pinned environment provenance. They may fix setup or
stability without changing task intent or the official success condition.

Create and resume the full matrix in explicit phases:

```bash
npm run benchmark:android:android-world-suite -- --phase plan --selection pass@3 --output <suite-root>
npm run benchmark:android:android-world-suite -- --phase original --selection pass@3 --output <suite-root>
npm run benchmark:android:android-world-suite -- --phase compile --selection pass@3 --output <suite-root>
npm run benchmark:android:android-world-suite -- --phase replay --selection pass@3 --output <suite-root>
npm run benchmark:android:android-world-suite -- --phase evaluate --selection pass@3 --output <suite-root>
```

The formal default is intentionally serial: one emulator, one sample per case,
and no cross-case averaging. The suite pins the `codex-luna` model profile,
which runs `gpt-5.6-luna` through the locally authenticated Codex app server.
The model profile is applied by the CLI, recorded as safe provenance in every
result, and contains no API key. Verify it independently with:

```bash
npm run android-world:model:verify
```

The compile phase is automatic and fail-closed. It lowers recorded actions to
native ActOnce primitives, derives visual and accessibility checkpoints from
the same immutable trace, and emits a standalone replay per sample. Live native
bounds replace recorded tap coordinates when node evidence is available.
Screenshot capture, accessibility capture, actual settle delay, skipped
already-satisfied primitives, and fallback count are reported separately.
Midscene and the recorder share one persistent UIAutomator2 session for native
tree reads. This preserves accessibility checkpoints while avoiding a new
`uiautomator dump` process for every observation.

Original and replay use the same measurement-external app setup: the CLI
force-stops declared target packages, launches the first official target app,
and verifies foreground focus before timing. AndroidWorld's AccessibilityForwarder
is enabled for official initialization and validation, then suspended while the
shared UIAutomator2 measurement session is active. A device lease rejects a
second benchmark process targeting the same emulator.

Development validation now covers both a system task (`SystemBrightnessMax`)
and a generated-data app form (`ContactsAddContact`). The latter passed the
official database validator in the current Luna canary with a `126.984 s`
Midscene original and a checkpoint-gated replay taking `28.631 s` (`4.44×`),
with zero AI fallback. This is a representative development result,
not the pending aggregate score for all 113 tasks.

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
