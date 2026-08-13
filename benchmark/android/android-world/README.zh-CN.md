# AndroidWorld Benchmark

[English](README.md) | [简体中文](README.zh-CN.md)

该 harness 运行官方 AndroidWorld `SystemBrightnessMax` 任务；Midscene 在
Round 1 中将该任务报告为 PASS。环境固定 AndroidWorld commit
`3e50888527ef9f29b9157ecd537e408008bb1c85`、Pixel 6/API 33 AVD、任务的
`max` 参数，并直接调用 AndroidWorld 自己的 initializer 与 reward validator。

```bash
npm run android-world:bootstrap
npm run android-world:check
npm run android-world:start:foreground
# 启动完成后，在另一个 shell 中执行：
npm run android-world:prepare
set -a; source .env; set +a
npm run benchmark:android:android-world
```

CLI 会在 original 与 replay 前分别初始化官方任务。Midscene original 通过
`midscene-android` recorder 捕获；replay 只使用 ActOnce 原生 Android runtime，
accessibility checkpoint 计入执行耗时。与上游 benchmark 一致，AndroidWorld
官方 validator 在每个 mode 结束后运行，不计入 agent 执行边界。

默认的一次 original、一次 replay 用于开发测量。完全无上下文的独立 agent
要求与正式重复次数见仓库内部 `benchmark-android-world` Skill。
