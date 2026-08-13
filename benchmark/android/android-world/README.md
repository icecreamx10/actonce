# AndroidWorld benchmark

[English](README.md) | [简体中文](README.zh-CN.md)

This harness runs the official AndroidWorld `SystemBrightnessMax` task, which
Midscene reported as PASS in round 1. It pins AndroidWorld commit
`3e50888527ef9f29b9157ecd537e408008bb1c85`, a Pixel 6/API 33 AVD, the task's
fixed `max` parameters, and AndroidWorld's own initializer and reward validator.

```bash
npm run android-world:bootstrap
npm run android-world:check
npm run android-world:start:foreground
# In another shell after boot:
npm run android-world:prepare
set -a; source .env; set +a
npm run benchmark:android:android-world
```

The CLI resets the official task independently before original and replay. The
Midscene original is captured through the `midscene-android` recorder. Replay
uses only the native ActOnce Android runtime and keeps accessibility checkpoints
inside its measured duration. AndroidWorld validation runs after each mode and
is excluded from the agent execution boundary, as in the upstream benchmark.

This one-original/one-replay command is a development measurement. Use the
repository-internal `benchmark-android-world` Skill for context isolation and
formal repetition requirements.

Upstream evidence:

- [AndroidWorld repository](https://github.com/google-research/android_world)
- [Midscene AndroidWorld report](https://midscenejs.com/android-world-benchmark-report)
- [Published SystemBrightnessMax PASS report](https://midscenejs.com/android-world-benchmark-report?file=Task-79-SystemBrightnessMax__group-8-47bb9356-d880-425c-87cc-e0a575c206fe-Pass.html)
