# ActOnce Interceptors

[English](README.md) | [简体中文](README.zh-CN.md)

Interceptor 层是 ActOnce 可组合、面向平台的“飞行记录仪”。所有 source 都通过同一个
`RecorderSession` 写入，任何 source 都不直接拥有文件。

```text
src/
  core/     session、source interface、顺序、artifact、生命周期
  sources/  Midscene、macOS input、macOS AX 和 WDA interceptor
  ios/      WDA CLI 组合入口
  macos/    Midscene Computer recording 组合入口
```

source 契约、顺序、关联方式和支持的组合见
[可组合 Interceptor 架构](spec/interceptors.zh-CN.md)。

## CLI 录制 Profile

```bash
npm run interceptor:start -- profiles --json
npm run interceptor:start -- record midscene-macos --entry /absolute/task.ts --display-id 0
npm run interceptor:start -- record midscene-ios --entry /absolute/task.ts --upstream-port 8100
npm run interceptor:start -- record ios-wda --upstream-port 8100
```

source 组合由命名 CLI profile 负责，Skill 和 task module 不直接 attach source。
`midscene-macos` 固定组合 `midscene + macos-input + checkpoint`；
`midscene-ios` 固定组合 `midscene + wda + checkpoint`，并捕获截图和原生 UI tree；
`ios-wda` 是只录协议的 proxy profile。需要其他组合时，应先在 CLI 中新增并测试
一个命名 profile。

## iOS / WDA

iOS Interceptor 是 ActOnce 面向 WebDriverAgent 流量的被动“飞行记录仪”。它位于 iOS
自动化客户端与 WDA 之间，在不改变协议含义的前提下转发请求，并以 append-only
形式记录所有穿过该边界的事实。

```text
Midscene / 其他 WDA 客户端
              |
              v
    ActOnce WDA Interceptor
      监听 127.0.0.1:8200
              |
              v
       WebDriverAgent :8100
              |
              v
        iOS Simulator
```

原始 recording 是证据，不是可执行脚本。后续独立层可以做协议归一化、区分 action
与 observation、构建 timeline，并编译 replay flow。这些解释都必须可以替换，且
不要求重新执行昂贵的 AI 示教。

## 目标

构建一个能够感知数据丢失、append-only、忠实保留 WDA HTTP 原始字节，同时不解释
也不主动改变设备行为的 recorder。

Interceptor 记录：

- 原始 HTTP method、target、headers、request body 和 response body；
- 用于跨系统关联的 wall-clock 时间，以及用于计算耗时的 monotonic 时间；
- connection、request、全局 sequence 和 WDA session 标识；
- response status、传输错误、取消和超时结果；
- screenshot、page source 等大 payload 的 hash 和 content-addressed 引用；
- recorder 自身的完整性问题，包括队列溢出、body 不完整和 blob 写入失败。

## 不变量

### 透明

对于客户端，通过 proxy 与直接连接 WDA 应当在行为上等价。Interceptor 必须保留
method、path、body、status code 和顺序。HTTP 代理所必需的 header 转换也必须记录
在事件中。

### 默认被动

Interceptor 不得向原始 session 注入 `/screenshot`、`/source`、元素查询或其他
WDA 请求。主动采样会改变时序和设备负载。未来的 sampler 必须是单独的 opt-in
sidecar，并明确把事件标记为由 ActOnce 产生。

### Append-only

原始事件捕获后永不修改。归一化、分类、报告脱敏和 flow 编译都写入独立的派生产物。
每个派生步骤都应该保留对应的原始事件 sequence number。

### 能感知丢失

Recorder 不得静默遗漏数据。buffer 或持久化失败时，应尽可能写入 integrity event，
并将 recording 标记为不完整。不完整 recording 可以用于诊断，但不能被静默编译为
可信 replay flow。

### 忠实保留字节

Body 在解析前以原始字节捕获。后续可以保存解析后的 JSON 索引，但不能用它替代原始
payload。content encoding 和 media type 也需要保留。

## 明确不做什么

Interceptor 不负责：

- 判断请求属于 action 还是 observation；
- 推断 label、target、intent、前置条件或后置条件；
- 将低层请求合并为用户步骤；
- 生成或执行 replay script；
- 使用 AI 修复失败流程；
- 在没有测量的情况下宣称零性能开销。

这些能力属于后续 package。将它们排除在 capture boundary 之外，才能让 ActOnce 在
不重新支付 AI 示教成本的情况下持续改进 compiler。

## Recording 布局

建议的磁盘结构：

```text
recordings/<recording-id>/
  manifest.json
  events.ndjson
  artifacts/
    07/07ab...png
    31/31cd...json
    a8/a8ef...bin
```

`events.ndjson` 只包含较小的 metadata。request 和 response body 根据 SHA-256
存放在 `artifacts/`，相同内容只写入一次。manifest 保存 schema version、recorder
version、upstream 地址、起止时间和最终完整性状态。

公共 event envelope 见
[`schema/event-envelope.schema.json`](schema/event-envelope.schema.json)，第一版 raw
event 契约见
[`schema/raw-wda-event.schema.json`](schema/raw-wda-event.schema.json)。
完整目录契约和 checkpoint 语义见
[`spec/recording.zh-CN.md`](spec/recording.zh-CN.md)。

## 运行 capture prototype

保持 WDA 运行在 8100，然后在另一个终端启动 interceptor：

```bash
npm run interceptor:start
```

不修改 WDA，只将 Midscene iOS device 指向 interceptor：

```bash
ACTONCE_WDA_PORT=8200 npm run benchmark:ios:smoke
```

使用 Ctrl-C 停止 interceptor，使它刷新 event queue 并完成 manifest。Recording
写入 Git 已忽略的 `recordings/` 目录。

## 安全边界

WDA 流量可能包含输入文本、截图、accessibility 内容和应用数据，因此忠实 recording
必须被视为敏感数据。

- 开发期只录制专用 benchmark Simulator；
- Interceptor 和 WDA 都只绑定本地接口；
- recording 默认不得进入 Git；
- 不得在 WDA metadata 中放入 authorization header 或模型凭据；
- 在录制真实用户数据前加入加密 raw storage；
- 报告和分享使用独立的 sanitized derivative，不得原地修改 raw recording。

## 第一个里程碑

使用已经验证过的 Settings 任务作为第一条 trace：

> 启动 Settings，进入“通用”，打开“关于本机”，并验证设备信息可见。

满足以下条件时认为里程碑完成：

1. Midscene 通过 `127.0.0.1:8200` 完成任务，WDA 运行在 `:8100`；
2. 任务结果与直接连接 WDA 的 baseline 相同；
3. 每次 HTTP 交互都有有序的 request、response 和 timing 事件；
4. 大 body 根据 content hash 保存并完成去重；
5. 强制写入失败会产生明确的不完整 recording；
6. 独立程序无需导入 interceptor 实现即可消费 raw trace。

完成 capture 里程碑后，再开始实现 action classification 和 flow compilation。
