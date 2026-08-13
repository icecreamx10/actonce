# 可组合 Interceptor 架构

[English](interceptors.md) | [简体中文](interceptors.zh-CN.md)

一个 `RecorderSession` 统一拥有 recording 时钟、全局 sequence、append-only event
文件、artifact store、manifest、完整性状态和 interceptor 生命周期。Interceptor 是
彼此独立的 source，不直接写 recording 文件。

```text
Midscene ─┐
macOS AX ─┼─> RecorderSession ─> events.ndjson + artifacts + manifest
Mac input ┤
WDA ──────┘
```

## Source interface

每个 `RecorderInterceptor` 声明稳定的 `SourceDescriptor`，并实现
`start(context)` / `stop()`。注入的 context 只提供 event emission、session 单调
时钟、content-addressed artifact 存储和完整性报告。一个 session 可以按场景挂载任意
兼容 source 组合。

当前实现的 source：

- `MidsceneInterceptor`：逻辑 action hook、progress、原始 execution dump，以及标准化
  的 Assert/Boolean/Query observation；
- `MacOSInputInterceptor`：穿过 Midscene Computer device 边界的实际鼠标、键盘、滚动
  和截图调用；
- `MacOSAXInterceptor`：与具体实现无关的 AX notification 和 snapshot；
- `WdaInterceptor`：忠实保留字节的 WDA HTTP 请求、响应和 failure。

AX interceptor 有意依赖 `MacOSAXProvider`。后续可由原生 Swift helper 或 Node addon
实现该边界，而无需让原生 AX 代码耦合文件持久化。把 provider 作为
`recorderOptions.axProvider` 传给 `agentForRecordedComputer()` 后，AX source 会被挂载，
每个 action checkpoint 也会引用对应 AX snapshot；未提供时 checkpoint 会明确记录
native UI evidence 不可用。

## 顺序模型

每个 event 有三种顺序信号：

- `sequence`：session 同步分配的全局总序；
- `sourceSequence`：单个 source instance 内的顺序；
- `timing.observedMonotonicNs`：source 观察到事实的时间，与 session 收到事件时的
  `timing.ingestedMonotonicNs` 分开。

全局总序描述日志顺序，但不能独自证明异步 source 之间的因果关系。
`traceId`、`spanId`、`parentSpanId` 用来表达因果链。例如 device primitive 是
Midscene logical action 的子 span；由 primitive 引起的 AX notification 可以再引用
primitive span。

## 原始证据与标准化事件

Midscene execution dump 继续作为不可变 artifact 保存。同时 Midscene source 会把完成
的 Assert、Boolean、Query task 去重后提升成一级 `observation.completed` event。每个
标准化 event 都引用原始 dump artifact。新录制还会直接写入 `evidenceSource`、task 的
`domIncluded` 声明、Midscene screenshot context，以及该 observation 等待期间捕获的
具体截图 artifact/sequence。消费方不再需要依靠时间邻接判断 observation 是由截图、
DOM 还是 native UI 支撑；旧录制仍由 compiler 的邻接回退兼容。

append-only `events.ndjson` 仍然是事实来源。紧凑的 `recording.json` 是可以重建的派生
索引，而不是多个 source 共同修改的大 JSON。
