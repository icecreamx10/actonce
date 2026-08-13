# 录制工作流

1. 执行 `actonce-record profiles --json` 获取 CLI 支持的固定 profile；在源码仓库内可使用等价的 `npm run interceptor:start -- profiles --json`。
2. Midscene macOS 使用 `midscene-macos`；Midscene iOS 使用 `midscene-ios`；外部 WDA client 使用 `ios-wda`。
3. Midscene profile 的 task module 只接收 CLI 创建好的 `agent` 和 `device`，不得自行创建 recorder 或拼装 source。
4. 正常执行原任务，不要为了日志额外增加 AI 操作。
5. task-module profile 由 CLI 自动关闭；proxy profile 在 client 完成后发送 SIGINT。
6. 执行 `verify-recording.mjs`，报告完整性、source、事件数和缺失证据。

source 组合、启动顺序、checkpoint policy 和 file log 都属于 CLI 实现，不属于 Skill。需要新组合时，应先在 CLI 中新增并测试一个命名 profile。API Key、鉴权头、剪贴板秘密及 `.env` 内容不得进入录制。
