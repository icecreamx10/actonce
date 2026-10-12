# AndroidWorld Benchmark

生成的任务状态在官方参数生成后、任务构造前保存 Python 与可选 NumPy RNG
检查点。初始化在连接设备前验证主机状态，并在连接后恢复该边界。旧状态重建
要求已记录或明确提供且一致的 seed，并严格验证官方参数重新生成结果，绝不
改写原始状态。seed 与参数相等本身不能证明旧 original 使用了该 RNG 边界；
只有另有原始参数生成来源证据，才能宣称 fixture 一致。
无检查点的旧状态保持历史初始化行为，明确输出 `fixtureRng: legacy-uncontrolled`，
该状态不能证明 fixture 一致。确认 original 的参数确实刚生成后，先复制
状态目录，再在测量外运行主机命令 `task.py prepare-fixture-rng --task <task>
--state-dir <staged-copy> --original-state-dir <immutable-original>
--legacy-generated-params`，仅在副本写入声明及源文件哈希。复用过旧参数的
original 不得使用该声明。无状态的固定 canary 保持原行为，不保存 RNG 检查点。
新 original 录制会传入 `--record-fixture-rng`：复用无检查点的参数时捕获当下
真实 RNG 边界，不重新设 seed、不声称恢复旧 original。已有检查点只恢复不覆盖。

## 新回放的计时协议

新评测使用 `--replay-module <module.ts>`：agent 生成 SDK module，默认导出
接收 `{ android, flow }` 的执行函数；可选导出 `config` 提供原生 session 配置。
module 不自行连接、关闭、计时或写 benchmark 结果。调用：

```bash
npm run benchmark:android:android-world -- --mode replay --task <task> --output <sample> --replay-module <module.ts>
```

`checkpointCaptureBreakdown` 将逐次检查的 source、截图、视觉比较耗时分别聚合，
不与真正的 settle delay 混合。阶段样本数与计时覆盖度明确记录；旧产物缺失计时
时保留 `null`。source 分项包含缓存命中；此细分不包含最终取证采集。

CLI 使用单调时钟，从连接前计时至关闭后，包含动作、checkpoint、重试和最终
截图/原生树采集；module 加载与文件写入不计时。未解决的 checkpoint 失败不能
因 module 捕获异常而变成成功。最终证据保存为文件引用及 hash。

成功 original 可携带完整 manifest 原样复用；旧结果仅在时长与完整 manifest
精确对应时推导 recording 边界，不改写原文件。original 包含 recorder 开销，
replay 包含原生设备 session 生命周期，两个范围明确但并非完全相同。
旧 `--replay-entry` 仍兼容，然而自定义计时边界未经验证，不用于新的正式加速比。
此前 CameraTakePhoto 仅动作阶段的时长也不能与 original 完整录制时长直接比较。

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

## 正式快照

App-data snapshot 不恢复 Android 运行时权限授予状态。新的 original 会自动保存
`task-state/runtime-permissions.json`（user 0）；replay 在启动 App、开始计时前恢复并
验证，正式评测复制参数时也需保留此文件。只允许任务声明 App 已请求的运行时权限，
不清空全机权限，也不任意恢复 AppOps 或系统/用户权限 flags。

旧录制没有该基线。仅当原始证据证明所需初始授权状态时，才能编写有证据路径和哈希
审计的 fixture，并用公共 CLI 的 `--fixture-permissions <file>`；不能编造未知权限、
删除权限弹窗动作，或把权限修复放进计时内回放。格式为
`{ "schemaVersion": 1, "userId": 0, "packages": [{ "package": "com.example.app", "permissions": { "android.permission.RECORD_AUDIO": false } }] }`。
新基线还记录可变的 `user-set`、`user-fixed` flags，并逐项恢复验证；不重置 AppOps
或 system flags。仅恢复 granted=false 不够：user-fixed 仍会让权限弹窗消失。
旧 grant-only 基线保持原语义，不自动清除 flags。若原始证据证明某个 flag，可在明确的
fixture package 内补充 `permissionFlags: { "android.permission.ACCESS_FINE_LOCATION": { "user-fixed": false } }`；
未指定的 flags 保留，不猜测，不修改原始基线。
缺失的旧基线在结果中明确标为 unavailable；命令或验证失败则停止 setup，不弱化 checkpoint。

原始录制可明确选择 `--model-profile codex-6.1-sol`，通过本地已登录的 Codex
app server 使用 `gpt-6.1-sol`。计时前运行
`npm run android-world:model:verify -- --model-profile codex-6.1-sol` 验证。
既有 Luna profile 和默认值不变；逐 case 保留实际模型与版本来源。Replay 仍不调用
模型，成功的 original 不因切换模型而重新录制。

[10 月 10–12 日审计](REPRODUCTION-2026-10-12.md) 已新验证严格切片的全部 5 个任务和
broader 的 6 个任务，明确逐 case 版本及 original 复用，不声称全量通过，也不汇总不同版本。

以下为较早的零上下文、单 sample 正式切片，覆盖 113 个目标任务中的 4 个。每个 replay
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

启动脚本默认使用软件模拟的前后摄像头，不调用本机 webcam。可通过
`ACTONCE_EMULATOR_CAMERA_BACK`、`ACTONCE_EMULATOR_CAMERA_FRONT` 覆盖配置
（包括 `none`）。要求启用的摄像头必须枚举成功才报告 ready；旧模拟器若关闭了
摄像头，须重启而不能静默复用来测试 Camera。重启不清空 app 数据。

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
目标 package，启动第一个目标 app，并确认其处于前台。权限弹窗只有在精确的
前台 Activity 与请求目标 package 对应时才算 ready，留给计时内的 agent 处理，
不会提前授权。`OpenAppTaskEval` 保留官方 home 起点，不提前打开候选 app 完成任务。
原始任务提示允许误离开单 app 后，通过精确逻辑名称执行一次 Launch 恢复，不强制在 Home 停止。
AndroidWorld
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
