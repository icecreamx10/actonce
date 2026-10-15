# AndroidWorld 复现审计 · 2026 年 10 月 10–12 日

[English：完整逐 case 表格、版本及证据哈希](REPRODUCTION-2026-10-12.md)

历史快照：后续 [10 月 13 日视频审计](REPRODUCTION-2026-10-13.zh-CN.md)
通过新基线补齐视频 case。下文仍保留 10 月 10–12 日的结果和当时阻塞。

当前覆盖：严格切片 **5/5**，历史较大验证集 **18/19 个合格正式回放**。
合计 23 个独立正式 replay；不是本轮 19/19，也不是完整 113-task 分数。
较大验证集的 19 个任务现均有最新成功 original，旧失败仍保留。

每个合格 replay 由 agent 从不可变录制合成，先通过连续两次独立初始化的
开发验证，再交给完全无上下文的另一 agent 做一次正式测量。
checkpoint 和 AndroidWorld 官方 reward `1` 都必须通过；不平均重复运行。

## 这批新增的十二个正式结果

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
| CameraTakePhoto | 43.968 | 2.505 | 17.55× |
| ExpenseDeleteDuplicates | 167.344 | 4.118 | 40.64× |

十二个结果的 original/replay 官方 reward 均为 `1`，重试、AI fallback 和
checkpoint 超时均为零。较早 ExpenseAddSingle 的一次恢复性超时和一次
确定性重试仍保留，并计入耗时；全部 23 个正式结果均无 AI fallback。

## 本轮修复与尚未取得资格的 case

- CameraTakePhoto：初始定位弹窗覆盖 Launcher 的分歧在重启后未重现，原因
  仍未证实。公共初始化将 app 偏好恢复为与原始来源完全相同的内容；不猜测
  缺失权限 flag。新模块检查真正的快门图标，不再比较动态预览的偶然像素，
  且能拒绝录制中的过渡状态。连续两次开发验证和独立正式回放均通过。
  旧 legacy action-only 计时漏掉连接/关闭，保留结果但不据此比较性能。
- ExpenseDeleteDuplicates：七个动作执行完，官方 reward 为 `1`；最终
  native/截图第一次匹配花了 717 ms，750-ms 预算内未完成第二次新鲜匹配。
  这两个参数是保守的合成选择，不是原始录制的精确字面要求。未通过
  checkpoint 资格验证；717 ms 没有分项数据，不能归因为确定的共享性能缺陷。
  新 agent 保留七次原始点击，检查剩余六条账目的名称、金额及最终截图。
  来源支持的 1000-ms 观察窗口内连续两次新鲜匹配，通过两次开发验证和
  独立正式回放。该窗口仍是合成决策，不是原始 sleep 字面值。首次正式
  启动因模拟器不可用，在初始化/计时前失败；记录保留，无 reward/耗时。
  后续由另一完全无上下文 agent 完成正式测量。
- CameraTakeVideo：数值权限 flag 导致的 parser 问题已通用修复，11 项测试
  通过。新 agent 的六次开发尝试保留；第 4 次新增文件名使官方 reward 为
  `1`，但缩略图 checkpoint 失败；官方文件名计数不证明媒体可用。
  完整十二动作尝试又不能在 edge swipe 后复现录制中的
  定位弹窗，不能安全执行下一次权限点击。权限差异尚未证明是缩略图延迟
  的原因；没有两次连续资格通过，也没有正式计时。
  后续三次原生输入一致性验证仍失败。已安装 app 的代码与 live 执行证明：
  探索性预览对焦让 Camera 吞掉 Back；排除该瞬态操作可恢复 Back → Home，
  但焦点圈消失本身不能证明内部空闲。第二次定位请求仍不存在：live 偏好
  已标记权限对话框出现过，定位为 `USER_FIXED` 拒绝，且没有残留请求 activity。
  source 有执行前权限基线，却没有第一次拒绝后的偏好、flag 和调用者栈；
  未发现可证实的通用 fixture 恢复缺陷。不能据此制造请求、改权限或删掉
  已知会改变授权状态的转换。

视频仍保留在分母内，因来源隐藏状态证据不足阻塞，尚无正式测量。旧失败
original 和修复 scaffold 后的成功 original 不覆盖、不平均。所有 device writer
已释放；已通过的 case 本轮不重跑。

## 计时与证据边界

新增十二个 replay 使用 CLI `--replay-module`：单调时钟覆盖原生连接、操作、
checkpoint、最终截图/原生树采集和关闭；模块加载及产物写入不计时。
original 复用完整 manifest 的 recording-session 时长，包含 recorder 开销。
两者是明确但不完全相同的范围，表中是实际运行的原始比值，不是纯动作成本。
原始执行使用 `codex-6.1-sol`，成功录制不因 SDK 修改而重跑；跨版本结果
不合并为同版本总分。

照片 original/replay 版本为 `e5524ec`/`00b163f`，重复账单为
`0df0c86`/`c976c94`。checkpoint 分项如下（不含 CLI 最终证据采集）：

| Task | 原生树 ms | 截图 ms | 图片比较 ms | 实际 settle delay ms |
| --- | ---: | ---: | ---: | ---: |
| CameraTakePhoto | 691.252 | 407.720 | 68.218 | 244 |
| ExpenseDeleteDuplicates | 2183.26 | 224.85 | 86.92 | 365 |

原生树分项可能命中相邻 checkpoint 缓存。这些值不等于完整 replay 耗时。
后续原生坐标输入时长/注入修复 `8604b87` 和后台模拟器进程归属修复
`528b3d3` 晚于上述正式运行；按要求，没有在新版本重跑已通过 case。

有录制来源证明的 fixture RNG 恢复已用于 Markor、菜谱、日历、短信及重复
账单；旧录制缺少此信息时仍标为 `legacy-uncontrolled`，不伪称隐藏状态相同。
ExpenseDeleteSingle 原始外层 wrapper exit 未捕获，但子进程成功、完整录制
和官方 reward 已核实；旧 `compile-result.json` 缺失，改为审计 ledger、
来源哈希及两次开发资格记录。

本地 raw artifacts 位于 `.cache/android-world/readme-fresh-20261010/` 和
`.cache/android-world/readme-remaining-20261012/`，不随仓库发布。
干净 clone 不包含这些原始录制和 fixture；公开 harness 可以生成新证据，
本文不是自包含复现包。英文审计保存逐项正式路径、SHA-256 和版本。
