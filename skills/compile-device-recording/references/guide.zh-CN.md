# 录制编译工作流

1. 验证录制已经关闭且完整。
2. 用 `summarize-recording.mjs` 查看 source、动作、checkpoint 和 observation。
3. 选择包含前置状态、目标动作、完成信号和独立结果证据的最小连续 sequence 区间。
4. 用 `extract-segment.mjs` 生成不可变的派生片段。
5. 写代码前生成 evidence ledger，逐项记录 action/observation 的 source、artifact 和原始 evaluator 模态。优先把 AI Locate 编译成有录制证据支持的 AX/WDA selector；没有 selector 时才使用带设备与 viewport 保护的归一化坐标。
6. 先确定 checkpoint 和基本运行结构，再填充动作。每个 segment 都是 `precondition → deterministic action → postcondition`；checkpoint、segment 数量和顺序不可变，action 是可调整的 *how*。
7. 输出 deterministic、fail-closed 的 `plan.json`。不能把事件成功发出当成应用已消费动作；checkpoint 不通过就停止并返回 `failedCheckpoint`，不得在 plan 中嵌入 AI fallback。
8. 为 segment 标注 `safe`、`observe-before-retry` 或 `never-retry`。`never-retry` 动作失败后只能观察结果，不能再次执行。
9. Assert/Boolean/Query/最终 oracle 都必须保留录制中的证据模态。precondition 超时是 checkpoint failure；evaluator 调用成功但 postcondition 不匹配也不能接受。
10. 执行前输出 execution-environment assessment，检查 runtime、app/build、fixture/reset、device/display、凭证/服务和 benchmark harness。只有环境为 `available` 才运行 live validation；否则停在离线编译并报告最小解阻动作。
11. 若 deterministic replay 失败，保留完整 `failedCheckpoint` 和 artifact。编译阶段可以修正错误的 deterministic action，但不能弱化 checkpoint。需要 AI 操作设备恢复时，转交独立的 `hybrid-replay` skill。
12. 在 fresh fixture 上至少连续两次完整通过，才能声称 replay 稳定。不能删除 assertion、弱化期望、无依据扩大 timeout 或隐藏失败尝试。

保持 observation 模态一致。在写 assertion 前运行 `actonce-macos plan-observations`，写完 decision record 后运行 `actonce-macos validate-observations`。不要把模型推理当作设备事实，不要把 AX notification 或 action dispatch 当作 checkpoint 已到达。未知、失败或不完整的 primitive 必须 fail closed。
