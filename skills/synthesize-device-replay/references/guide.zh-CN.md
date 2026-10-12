# Replay 语义合成工作流

1. 先运行 `inspect-attempts.mjs`。一个 recording 可能拼接多次 attempt；有多次时，Agent 必须根据独立 oracle 证据选中唯一成功 attempt，禁止直接按 sequence 跨 attempt 截取。
2. 验证 recording 完整且任务结果有独立证据。
3. Agent 阅读截图、原生树、semantic observation 和动作关联链，在选定 attempt 内选择最小成功区间。
4. Agent 逐个顶层状态变化动作编写 `synthesis-ledger.json`：一个动作一个 segment，每个 segment 引用该动作自己的 before/after checkpoint，并写明实际核验过的事实与证据模态。
5. 先运行 `validate-synthesis.mjs --ledger ...`。未通过前禁止生成动作代码。
6. 每次只把一个已确定动作及其证据切片交给平台 `compile-primitives`；它只是机械 lowering，不能决定 segment、checkpoint、assertion、exclusion 或顺序，也不能接收整个 recording/任务区间。
7. Agent 把单动作 lowering 结果填入已固定的 `replay-plan.json`，再运行带 `--plan` 的完整验证。整条任务一个 segment、多个顶层动作共用首尾 checkpoint、或缺少逐动作证据都必须失败。
8. 输出 oracle、assertion decision 和 execution-environment assessment。只有环境为 `available` 才能执行。
9. 每次从 fresh fixture 完整运行；保留失败并定位第一个 divergence，只修最窄层。连续两次通过后才能称为稳定。

最终 replay 是固定脚本，这是目标；但它的语义结构必须由 Agent 根据不可变证据合成，脚本只能执行或校验已经作出的决定。

排除探索或恢复动作前，不能仅凭 UI 相同就认定没有副作用；需考虑权限、持久资源
与生命周期状态。读取外部 oracle 的实际判定条件，并等待结果完整返回后再分类。
文件数量增加不等于媒体可用；应保留录制中的可区分完成证据，或证明录制与当前运行
支持同一等价事实。可以泛化 incidental 计数器，不能丢掉资源已保存/可用的必要语义。
