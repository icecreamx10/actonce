# CameraTakeVideo · 已发布证据

[English](README.md) · [审计](../../REPRODUCTION-2026-10-13.zh-CN.md)

Original **125.921 秒** → 正式 replay **12.352 秒**，原始比例 **10.19×**。
官方 reward **1/1**，九个 segment 全匹配，重试/fallback/超时均为 **0**。
Original 包含 recorder 开销；replay 包含原生连接、checkpoint、最终证据及关闭。
Setup 与官方验证不计入执行时间。

已保存九个真实动作、27 个 checkpoint 及全部 37 个关联截图/原生树产物，
序号、时间戳、动作参数和关联 ID 保持不变。发布的 `events.ndjson` 是
47 事件的动作/证据投影（含两个去除数据的 attempt 边界），不是原始 210 事件日志；完整原始 manifest 保存在
`source-manifest.json`，本地原件未改动。

同时包含原样的正式回放脚本、计划/ledger、oracle、图片判断、qualification 历史、
正式运行完整 checkpoint 证据、结果、最终截图和独立 agent provenance，以及任务/
权限/启动基线。`publication.json` 列出范围与原件哈希，`SHA256SUMS` 校验整个发布包。

不发布模型请求、progress/execution dump、内部推理、HTML 报告及命令日志，
也不发布不透明的 pickle/snapshot 和完整失败目录；失败历史仍见 qualification。
截图来自模拟器的合成摄像头，不是本机 webcam。这个包不是完整模拟器恢复镜像。

在本目录运行 `shasum -a 256 -c SHA256SUMS` 可校验所有文件。
正式计划为了保持原始哈希，仍含当时的绝对路径；单独的 `portable-replay.ts`
只把三处图片引用定位到当前 checkout，不修改动作或 checkpoint，未额外做正式设备测量。
新环境须先执行公开 setup，并用新输出目录运行；命令见 [英文说明](README.md#inspect-or-regenerate)。
不要覆盖已发布结果，或把历史耗时当作新运行成绩。
