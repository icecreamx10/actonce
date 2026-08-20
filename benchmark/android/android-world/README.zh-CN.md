# AndroidWorld Benchmark

[English](README.md) | [简体中文](README.zh-CN.md)

该 harness 运行官方 AndroidWorld `SystemBrightnessMax` 任务；Midscene 在
Round 1 中将该任务报告为 PASS。环境固定 AndroidWorld commit
`3e50888527ef9f29b9157ecd537e408008bb1c85`、Pixel 6/API 33 AVD、任务的
`max` 参数，并直接调用 AndroidWorld 自己的 initializer 与 reward validator。

## 覆盖目标

固定的 Midscene 报告包含 116 个 AndroidWorld 任务：Round 1 通过 108 个，
截至 Round 3 至少一次通过的并集为 113 个。仓库 catalog 保存每轮状态，并
把最终 113 个任务作为完整覆盖目标。可离线列出两种口径：

```bash
npm run android-world:catalog -- --selection pass@1 --format lines
npm run android-world:catalog -- --selection pass@3 --format lines
```

## 当前正式快照

当前零上下文、单 sample 的正式切片覆盖 113 个目标任务中的 4 个。每个 replay
都通过 AndroidWorld 官方 reward 门禁，AI fallback 与 replay retry 均为 0：

| 任务 | Original | Replay | 加速比 |
| --- | ---: | ---: | ---: |
| `BrowserMaze` | 478.567 秒 | 18.282 秒 | 26.18× |
| `ClockStopWatchPausedVerify` | 26.081 秒 | 6.919 秒 | 3.77× |
| `ClockStopWatchRunning` | 48.110 秒 | 5.889 秒 | 8.17× |
| `ClockTimerEntry` | 126.280 秒 | 8.045 秒 | 15.70× |
| **可比合计** | **679.038 秒** | **39.135 秒** | **17.35×** |

这是以正确性为门禁的部分结果，不代表完整 suite 已覆盖。其余 catalog case 会一直
保留在覆盖分母中，直到获得完整且官方成功的 original，并由 Skill 编译出通过同一
官方 validator 的 replay。

完整 suite 的 App 安装及 snapshot 属于测量外 setup：

```bash
npm run android-world:prepare-suite
```

动态 case 会在 sample 目录保存精确的 AndroidWorld `params.pickle` 及可读的
`task.json` 摘要；initializer 与官方 validator 必须复用同一个 state 目录。

bootstrap 会幂等应用 `patches/` 下由仓库管理的补丁，并把它们纳入环境来源记录；
补丁只允许修复 setup 或稳定性，不能改变任务意图与官方成功条件。

完整矩阵分阶段创建并支持断点续跑：

```bash
npm run benchmark:android:android-world-suite -- --phase plan --selection pass@3 --output <suite-root>
npm run benchmark:android:android-world-suite -- --phase original --selection pass@3 --output <suite-root>
npm run benchmark:android:android-world-suite -- --phase replay --selection pass@3 --output <suite-root>
npm run benchmark:android:android-world-suite -- --phase evaluate --selection pass@3 --output <suite-root>
```

在 `original` 与 `replay` 之间，对每条完整且官方通过的录制使用发布的
`skills/synthesize-device-replay` Skill。benchmark 刻意不提供自动合成命令。

正式默认口径刻意保持串行：单 emulator、每个 case 一个 sample，不做跨重复
平均。suite 固定使用 `codex-luna` profile，通过本机已登录的 Codex app server
调用 `gpt-5.6-luna`。该 profile 由 CLI 自动注入，并以不含凭据的 provenance
写入结果；仓库不会保存 API key。可独立验证：

```bash
npm run android-world:model:verify
```

编译属于 Agent Skill，而不是 benchmark 脚本。它默认保留录制动作，只生成与
证据模态一致的 checkpoint；只有证明 selector 唯一、语义一致并通过 fresh-fixture
执行后，才允许把坐标优化为原生 selector，且原始坐标必须保留为 fallback。
结果会分别记录截图捕获、原生 source 捕获、真正 settle delay、已满足而
跳过的 primitive 以及 fallback 次数。
Midscene 和 recorder 共用一个常驻 UIAutomator2 session 读取原生树；因此仍然
保留 accessibility checkpoint，同时避免每次 observation 都新建
`uiautomator dump` 进程。

original 与 replay 使用相同且不计时的 app setup：CLI 会 force-stop 官方声明的
目标 package，启动第一个目标 app，并确认其处于前台。AndroidWorld
AccessibilityForwarder 仅在官方初始化和 validator 阶段启用；测量期间暂停，
Midscene 与 recorder 共用 UIAutomator2 session。设备独占 lease 会拒绝第二个
benchmark 进程，避免两个执行流操作同一 emulator。

早期自动 compiler 的开发 artifact 会保留用于诊断，但不再作为当前 benchmark
证据。新的 replay 只有在发布的编译 Skill 基于不可变录制完成生成、执行、修复和
验证后，才能计入结果。

各阶段默认跳过已有完整 artifact，只有 `--force` 才重跑。可用
`--task <TaskName>` 处理单个 catalog case，但不会改变总分母或目录身份。

```bash
npm run android-world:bootstrap
npm run android-world:check
npm run android-world:start:foreground
# 启动完成后，在另一个 shell 中执行：
npm run android-world:prepare
npm run benchmark:android:android-world
```

CLI 会在 original 与 replay 前分别初始化官方任务。Midscene original 通过
`midscene-android` recorder 捕获；replay 只使用 ActOnce 原生 Android runtime，
accessibility checkpoint 计入执行耗时。与上游 benchmark 一致，AndroidWorld
官方 validator 在每个 mode 结束后运行，不计入 agent 执行边界。

完整正式 suite 同样为每个 case 一次 original、一次 replay。完全无上下文的
独立 agent、正确性 gate、artifact 保留及断点续跑要求见仓库内部
`benchmark-android-world` Skill。
