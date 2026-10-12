# AndroidWorld 复现审计 · 2026 年 10 月 10–12 日

[English：完整逐 case 表格、版本及证据哈希](REPRODUCTION-2026-10-12.md)

当前覆盖：严格切片 **5/5**，历史较大验证集 **16/19 个合格正式回放**。
合计 21 个独立正式 replay；不是本轮 19/19，也不是完整 113-task 分数。
较大验证集的 19 个任务现均有最新成功 original，旧失败仍保留。

每个合格 replay 由 agent 从不可变录制合成，先通过连续两次独立初始化的
开发验证，再交给完全无上下文的另一 agent 做一次正式测量。
checkpoint 和 AndroidWorld 官方 reward `1` 都必须通过；不平均重复运行。

## 这批新增的十个正式结果

| Task | Original 秒 | Replay 秒 | 原始比值 |
| --- | ---: | ---: | ---: |
| OpenAppTaskEval | 22.464 | 1.643 | 13.67× |
| ContactsAddContact | 78.220 | 5.287 | 14.79× |
| MarkorDeleteNote | 63.622 | 3.645 | 17.46× |
| ExpenseDeleteSingle | 43.896 | 1.995 | 22.00× |
| SystemBrightnessMax | 82.046 | 7.684 | 10.68× |
| RecipeDeleteSingleRecipe | 56.732 | 4.025 | 14.09× |
| RecipeDeleteDuplicateRecipes | 115.335 | 3.762 | 30.66× |
| SimpleCalendarDeleteOneEvent | 61.573 | 1.794 | 34.32× |
| SimpleCalendarDeleteEventsOnRelativeDay | 74.166 | 3.689 | 20.10× |
| SimpleSmsSend | 69.671 | 5.290 | 13.17× |

十个结果的 original/replay 官方 reward 均为 `1`，重试、AI fallback 和
checkpoint 超时均为零。较早 ExpenseAddSingle 的一次恢复性超时和一次
确定性重试仍保留，并计入耗时；全部 21 个正式结果均无 AI fallback。

## 三个未取得资格的 case

- CameraTakePhoto：新 SDK 模块初始化遇到相机定位权限弹窗覆盖 Launcher，
  而录制从 onboarding 开始；该分歧没有派发操作。原因尚未证实，不能猜测
  缺失权限 flag 或 app 偏好。此前 legacy replay 的官方结果正确，但只计
  action 的时钟漏掉连接/关闭，因此不据此声称性能优势。
- ExpenseDeleteDuplicates：七个动作执行完，官方 reward 为 `1`；最终
  native/截图第一次匹配花了 717 ms，750-ms 预算内未完成第二次新鲜匹配。
  这两个参数是保守的合成选择，不是原始录制的精确字面要求。未通过
  checkpoint 资格验证，不计正式 PASS；717 ms 没有分项数据，不能归因
  为某个确定的共享性能缺陷。
- CameraTakeVideo：数值权限 flag 导致的 parser 问题已通用修复，11 项测试
  通过。新 agent 的六次开发尝试保留；第 4 次官方 reward 为 `1`，但缩略图
  checkpoint 失败。完整十二动作尝试又不能在 edge swipe 后复现录制中的
  定位弹窗，不能安全执行下一次权限点击。权限差异尚未证明是缩略图延迟
  的原因；没有两次连续资格通过，也没有正式计时。

这些 case 保留在分母内。视频还保留旧失败 original 和修复 scaffold 后的
成功 original，不覆盖、不平均。所有 device writer 已释放。

## 计时与证据边界

新增十个 replay 使用 CLI `--replay-module`：单调时钟覆盖原生连接、操作、
checkpoint、最终截图/原生树采集和关闭；模块加载及产物写入不计时。
original 复用完整 manifest 的 recording-session 时长，包含 recorder 开销。
两者是明确但不完全相同的范围，表中是实际运行的原始比值，不是纯动作成本。
原始执行使用 `codex-6.1-sol`，成功录制不因 SDK 修改而重跑；跨版本结果
不合并为同版本总分。

有录制来源证明的 fixture RNG 恢复已用于 Markor、菜谱、日历、短信及重复
账单；旧录制缺少此信息时仍标为 `legacy-uncontrolled`，不伪称隐藏状态相同。
ExpenseDeleteSingle 原始外层 wrapper exit 未捕获，但子进程成功、完整录制
和官方 reward 已核实；旧 `compile-result.json` 缺失，改为审计 ledger、
来源哈希及两次开发资格记录。

本地 raw artifacts 位于 `.cache/android-world/readme-fresh-20261010/` 和
`.cache/android-world/readme-remaining-20261012/`，不随仓库发布。
干净 clone 不包含这些原始录制和 fixture；公开 harness 可以生成新证据，
本文不是自包含复现包。英文审计保存逐项正式路径、SHA-256 和版本。
