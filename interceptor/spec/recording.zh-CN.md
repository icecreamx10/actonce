# Recording format v1

[English](recording.md) | [简体中文](recording.zh-CN.md)

ActOnce recording 是一个目录，而不是单个序列化对象。主 JSON 是建立在不可变事件流
和 content-addressed artifacts 之上的可重建索引。

```text
recordings/<recording-id>/
  recording.json
  events.ndjson
  artifacts/<sha256-prefix>/<sha256>
```

- `events.ndjson` 是 append-only 的事实来源；
- `artifacts/` 保存忠实的原始 body、解码后的图片和 native UI dump，只使用
  SHA-256 寻址；
- `recording.json` 连接 raw request、派生协议标注、action、state checkpoint 和
  artifact，并且可以从前两者重建。

机器可读契约包括：

- [`raw-wda-event.schema.json`](../schema/raw-wda-event.schema.json)
- [`protocol-annotation.schema.json`](../schema/protocol-annotation.schema.json)
- [`derived-protocol-annotation.schema.json`](../schema/derived-protocol-annotation.schema.json)
- [`recording.schema.json`](../schema/recording.schema.json)

## 平台采集边界

各平台共用相同的落盘路径，但采集边界并不相同：

| 目标 | 采集边界 | 原始证据 |
| --- | --- | --- |
| iOS | WDA 前的透明 HTTP 代理 | 请求、响应、body 和时间信息 |
| macOS | Midscene `ComputerDevice` 的装饰器 | 截图及实际执行的鼠标、键盘和滚动 primitive |

公共持久化代码位于 `src/common/`，协议相关 adapter 位于 `src/ios/` 和
`src/macos/`。`@midscene/computer` 在进程内直接调用原生输入库，因此 macOS
adapter 无法观察一个未经修改的外部 Midscene 进程；调用方必须使用
`agentForRecordedComputer()` 创建 agent。

`ACTONCE_PLATFORM=auto` 在配置的 upstream 可以连接 WDA 时选择 iOS，否则选择
本机 macOS adapter。显式设置 `ACTONCE_PLATFORM=ios|macos` 的优先级最高。

### Midscene 关联层

macOS adapter 使用 Midscene 的公开 interface hook `beforeInvokeAction` 和
`afterInvokeAction` 建立逻辑 action 及其 checkpoint 对。被包装的 input primitive
记录实际设备调用，并引用该逻辑 action。绕过 Midscene hook 的直接 primitive 调用
会获得独立 checkpoint 对。公开的 agent progress 和 execution-dump listener 用于保留
planning/report 关联。

Midscene 没有 action-error hook，action 抛错时也不会调用 `afterInvokeAction`。因此，
下一个 action 开始或 recorder 关闭时，仍未结束的逻辑 action 会记录为
`logical.action.outcome-unknown`；底层 primitive failure 则独立保留。

## Raw 与 derived 数据

不得用后续解释更新 raw event。WDA 分类作为独立派生 annotation 保存，其中包含
catalog rule ID 和原始事件 sequence。无法识别的 endpoint 必须明确保留为 unknown。

协议 annotation 描述观察到的协议语义，而不是用户意图。例如 `input.tap` 只表示
WDA 收到了 tap，不能声称用户意图是“打开通用”。

使用以下命令生成 annotation，并保持 raw log 不变：

```bash
npm run interceptor:annotate -- recordings/<recording-id>
```

命令会原子写入 `derived/protocol-annotations.ndjson` 并报告已知规则覆盖率。未知
endpoint 仍会出现在输出中，并使用保守的 `unknown` 语义。

## Checkpoint 契约

ActOnce checkpoint 是一致的 state bundle，而不只是截图。完整 checkpoint 包含最终
screenshot、native UI source、设备 metadata、timing 和原始事件引用。

证据缺失必须被记录，不能被伪造。WDA 能提供原生 UI source；Midscene Computer
目前不暴露 macOS AX tree，因此 macOS 原型会记录
`nativeUi.status = "unavailable"`。在补充独立 AX capture provider 之前，这种
checkpoint 对可信回放而言仍是不完整的。

默认 capture 顺序为：

```text
等待视觉稳定
捕获 screenshot A
捕获 native UI source
捕获 screenshot B
比较 A 和 B
```

如果 A/B 差异超过阈值，recorder 重试一次或将 checkpoint 标记为 `incoherent`，
不得把 source tree 静默关联到另一个视觉状态。

每一类协议都有明确的 checkpoint policy：

- `trigger` 打开或推进一个逻辑 checkpoint；
- `contributor` 向 pending checkpoint 补充 evidence；
- `metadata` 丰富 checkpoint，但不创建 state；
- `boundary` 建立初始或最终状态边界；
- `none` 不影响 checkpoint。

policy 同时声明 `provides` 和 `requiredEvidence`。例如 `/screenshot` 是 observation
trigger，但它只提供 `screenshot`；只有同一逻辑状态关联了 native UI 和设备 metadata
后才算完整。window rect 只属于 metadata，绝不单独创建 state。

trigger 不会和 state 一一对应，而会进行合并。action 之后，recorder 只保留一个等待
完成的 post-action checkpoint；之后的 screenshot/source observation 会贡献或刷新该
checkpoint，直到它完整并稳定。UI 未变化时，重复 observation 引用同一个 state 和
content-addressed artifact；对应的 raw request 仍然各自作为不可变 event 保存。

## 状态链

主索引将一次示教表示为：

```text
S0 -- A1 --> S1 -- A2 --> S2
```

上一个 post-state 直接作为下一个 pre-state。只有状态缺失、过期、不完整，或发生了
无法归因于 WDA action 的变化时，才额外生成 pre-action checkpoint。

## 崩溃恢复

录制过程中持续 append event，并根据 hash 写入 artifact。主索引通过临时文件写入并
原子 rename。进程崩溃后，恢复工具根据已有 event 和 artifact 重建
`recording.json`，并将无法解释的缺口标记为 incomplete。
