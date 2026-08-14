# 录制编译工作流

1. 验证录制已经关闭且完整。
2. 用 `summarize-recording.mjs` 查看 source、动作、checkpoint 和 Midscene observation。
3. 选择包含前置状态、目标动作、完成信号和独立结果证据的最小连续 sequence 区间。
4. 用 `extract-segment.mjs` 生成不可变的派生片段。
5. 写代码前先生成 evidence ledger，逐项记录 action/observation 的 source、artifact、是否包含 DOM/native UI，以及原始 evaluator 模态。优先把 AI Locate 编译成有录制证据支持的 AX/WDA selector；无法获得 selector 时才使用带显示器和 viewport 保护的归一化坐标。
6. 把每个改变状态的动作编译成 `pre-checkpoint → deterministic action → post-checkpoint` 的 `flow.segment`；不能把“事件成功发出”当成应用已经消费动作。若 `plan-observations` 为录制中的固定等待给出 `recommendedSettle`，把该等待改为 checkpoint 轮询：立即检查、短间隔截图/验证、连续匹配后立刻执行下一步，只有用完原等待时长这一 timeout 预算后才进入既有 fallback。
7. 默认输出在没有恢复需求时使用 deterministic 模式。benchmark 可以评测 deterministic 或 hybrid replay；fallback 不是正确性失败，其模型耗时、动作和恢复验证必须全部计入 replay 时间。
8. hybrid fallback 只能修复当前 segment，必须限制应用范围、禁止动作、action 数量、超时和重试次数；AI 完成后由 runtime 重新捕获并验证同一个 checkpoint，通过后才能继续确定性脚本。
9. 为 segment 标注 `safe`、`observe-before-retry` 或 `never-retry`；`never-retry` 的 postcondition 不允许 AI 再次执行动作。
10. macOS 先用 `actonce-macos compile-primitives <segment.json> --output <script.js>` 把完成的原始操作机械映射为 `replayMacPrimitive` 调用，再组合一个或多个 `@byted-lynx/actonce-macos` 脚本片段；Appium、Mac2、fallback plugin 和 session 生命周期由 CLI 统一管理，不写进片段。
11. 生成包含 setup、guarded segment、同步、assertion、cleanup 和来源注释的脚本，并在旁边输出 assertion decision record，记录每条 assertion 的原始证据模态、artifact、选中的 evaluator，以及被拒绝的 evaluator 与原因；有独立复用价值的固定流程可以拆成多份。Assert/Boolean/Query/最终 oracle 都必须写成 observation-only `flow.segment`：`precondition` 使用带 `settle` 的证据 checkpoint，稳定后 `deterministic` 只能调用原模态只读 evaluator（checkpoint driver 已是 evaluator 时为空操作），`postcondition` 再验证同一独立结果证据。precondition 超时是 checkpoint failure，不能直接记成 observed false；evaluator 返回成功但 postcondition 不匹配也不能接受 assertion。
12. 先从选中的原始事件区间建立 replay oracle：列出动作顺序、每个有独立证据的 observation 值、等价 checkpoint 边界，以及 cleanup/最终状态。对比的是这些边界上的语义结果，不要求事件数量、时间戳或截图文件逐字节一致。
13. 执行前单独输出 execution-environment assessment。录制与编译可能发生在不同机器；除非已证明可以访问录制机，否则默认它不可用。检查当前 host/platform、runtime 与 doctor、app/build 身份、fixture/reset、目标 device/display、凭证/服务和 benchmark harness，并分类为 `available`、`equivalent-but-unproven` 或 `unavailable`。
14. 只有 `available` 才能用 `actonce-macos run <片段...>` 执行完整 case。每次都先重置 fixture，并采集新的 checkpoint/assertion 证据；进程退出成功不等于 replay 正确，所有 oracle observation 和最终状态都必须按原始证据模态对得上。若不是 `available`，停在离线编译与静态验证，记录零次 live attempt、`offline-only` 和最小解阻动作，不能宣称 replay 已正确或稳定。
15. 若 live 验证失败，保留本次 artifact，判断问题属于 compiler、runtime、selector/coordinate、evaluator、fixture/environment 还是 fallback，修复最窄的责任层，然后从干净 fixture 重新运行整个 case，不能从污染后的失败步骤继续。
16. 仅在 fresh-fixture 验证环境可用时，重复“执行 → 对比 → 诊断 → 修复 → 重置重测”，直到至少两次连续、完整运行都匹配全部 oracle observation 和最终状态，才视为稳定。不能在缺少可验证环境时反复尝试启动/连接，或通过删除 assertion、弱化期望或证据模态、无依据延长 timeout、隐藏失败尝试来获得稳定。
17. 缺少等价执行环境、权限/凭证、平台能力、外部服务状态或不可安全重建的原始 artifact 时报告阻塞。阻塞报告必须包含 assessment 分类、失败边界、expected/actual 证据、已经尝试的检查或重测结果、artifact 路径，以及最小解阻动作。只要调用过 AI，就把结果标为 hybrid 并报告 fallback 次数与耗时；最终输出正确时仍然参与 benchmark 时间对比。

保持 observation 模态一致。在写 assertion 前运行 `actonce-macos plan-observations` 生成机械 evidence plan；写完 decision record 后必须运行 `actonce-macos validate-observations`。`domIncluded: false` 且由 screenshot `uiContext` 支撑的 Midscene Assert/Boolean/Query 必须编译为视觉/OCR assertion，确定性视觉无法完整判断时使用只读截图 AI evaluator；录制没有相关 macOS AX/native UI 证据时 CLI 会拒绝 AX assertion。在线视觉 evaluator 的耗时计入 replay，且不能把 expectation 硬编码成 observed。支持的 macOS 操作映射由 runtime 固化，不让 AI 展开 WebDriver 实现。尤其不能把 `typeText({ replace: true })` 改写成 `element.setValue`、逐字符输入或循环 Backspace；未知、失败或不完整的 primitive 必须 fail closed。不要把模型推理当作设备事实，不要把 AX notification 直接当作 tap 被消费的证明，也不要把密钥或鉴权信息复制进脚本。
