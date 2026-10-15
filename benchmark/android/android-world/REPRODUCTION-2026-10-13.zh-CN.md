# AndroidWorld 视频审计 · 2026 年 10 月 13 日

[English](REPRODUCTION-2026-10-13.md)

CameraTakeVideo 已取得合格的独立正式回放。与 [10 月 10–12 日审计](REPRODUCTION-2026-10-12.zh-CN.md)
合计，较大验证集现为 19/19，严格切片仍为 5/5。其他已通过 case 未重跑。
这 24 个已审计 case 跨版本和环境策略，不是一次同质 suite 或完整 113 个任务。

## 正确性与计时

| Original | Replay | 原始比例 | 官方 reward | Runtime |
| ---: | ---: | ---: | --- | --- |
| 125.921 秒 | 12.351938125 秒 | 10.1944× | 1 / 1 | 9 个 segment 匹配；重试、fallback、超时均为 0 |

两阶段各执行一次，分别由无上下文 agent 运行；API 33 `emulator-5554`、seed 70001、
版本 `f836fe9`。Original 使用 `codex-6.1-sol`，确定性 replay 不调用模型。
原始录制有 210 个事件，完整性检查通过。Replay 同时通过官方 evaluator 和录制中的
保存缩略图 checkpoint；最终截图已检查，未额外执行播放或 codec 验证，不能据此声称
完成全部视频质量验证。

Original 为完整 recording-session，包含 recorder 开销；replay 使用公开
`--replay-module` 计时，包含原生连接、动作、checkpoint、最终证据及关闭。
比例是这两个已说明、不同范围的实际运行比较，不是纯动作成本对比。

| Replay checkpoint 阶段 | 毫秒 |
| --- | ---: |
| 原生树获取 | 3307.485 |
| 截图获取 | 1437.183 |
| 图片比较 | 120.012 |
| 显式 settle 等待 | 4666 |

Checkpoint capture 合计 4867 毫秒（事件计时经过取整），不包含 CLI 最终证据获取。
64 个检查样本都有分阶段计时。Setup 和官方验证不计入执行时间；正式 setup 一次成功、
无启动失败，各 setup 阶段 wall time 尚未单独埋点。

## 环境固化，不是回放恢复

公开 setup 已提交权限/启动基线（`3c92b89`）、窗口绘制就绪及测量前有限环境重建
（`bd0472b`）、Camera 媒体发布归一化（`f836fe9`）。视频默认预授予声明的运行时权限，
其他任务保持原策略。Original/replay 核对相同 schema-2
`task-state/start-environment.json`；不会把旧录制追认成新基线。

官方初始化清空 Camera 的 Pictures/Movies 输出后，setup 验证这些命名空间，
只删除其中路径已不存在的媒体索引。已识别的 Camera pending 输出移到可恢复隔离目录，
系统缩略图缓存和其他输出保留。正式 replay 清理一个 Movies 孤立索引，未隔离文件；
此前 setup 隔离了两个 pending 文件。不进行全局权限或 MediaProvider 数据库重置。

此前证据证明文件与 MediaStore 元数据不一致；旧索引是推断原因，不是全部失败的已证实原因。
此前还观察到 APK 启动崩溃，但零尺寸测量输入的来源仍未证实。新基线通过不等于普遍修复声明。

## 编译验证与历史保留

独立新 agent 从单一成功 attempt 编排九个 segment。六次开发失败保留，包括 staging
只读权限问题，以及有录制证据支持的就绪、图片比较和截止时间修正。
第 7、8 次使用相同最终脚本、分别初始化环境，连续通过 runtime 与官方 reward，
无重试/fallback。另一个新 agent 不修改脚本，执行唯一一次正式 replay。

旧录制（含 121.921 秒 schema-1 original、170.473 秒旧基线 original）、旧候选和失败
均保留，不跨策略平均或比较。正式 validator 尚未完成时，提前执行的一次只读 evaluation
报告缺失 replay，也独立保留；最终 evaluation 通过，未增加设备执行次数。

## 证据

本地根目录：`.cache/android-world/video-pregranted-20261013/`。
新录制 `published-sample-1/original`，编译 `published-sample-1/synthesized-v1`，
正式结果 `published-sample-1/formal-replay`。现已提交经过检查的
[发布投影](evidence/camera-take-video-20261013/README.zh-CN.md)：真实动作、全部 checkpoint
产物、原样的正式脚本及回放证据。模型日志和不透明 snapshot 仍仅留本地，投影明确列出
差异与原件哈希。可用公开 harness 和 synthesis Skill 生成新证据，但不是完整模拟器恢复包。

原录制、环境、脚本、计划、正式结果和 evaluation 的 SHA-256 见
[英文版证据表](REPRODUCTION-2026-10-13.md#evidence-identities)。正式执行前后均验证原录制未改变、
脚本哈希及 tracked tree clean。设备 writer 和 lease 已释放。
