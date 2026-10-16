# AndroidWorld 选定补测集 · 2026 年 10 月 15–16 日

[English](REPRODUCTION-2026-10-16.md)

**选定的 22 个任务现为 22/22 独立正式回放通过。** 10 月 15 日已有 19 个通过
结果，本次保留、不重跑；10 月 16 日修复其余三个阻塞。这是有成功 original 的
选定集合，不是随机抽样、全量通过率，也不是同一版本新跑了 22 次。22 个均为
已完成的官方 reward 1，replay 动作 retry、AI fallback、checkpoint timeout 全为 0。

累计本地库存从 52 增加为 **55/113 个不同任务具备 replay 通过证据**。库存跨版本、
证据完整度不同，不代表本次重新严格复现了 55 个；历史覆盖集合不能未经去重直接相加。

## 新解决的三个任务

| Task | Original | 正式 replay | 匹配段数 | Capture / settle |
| --- | ---: | ---: | ---: | ---: |
| ContactsNewContactDraft | 89.387 秒 | 5.476 秒 | 9 | 1.610 / 0.202 秒 |
| RecipeDeleteMultipleRecipesWithNoise | 209.174 秒 | 13.759 秒 | 18 | 2.305 / 2.622 秒 |
| RetroSavePlaylist | 439.022 秒 | 23.393 秒 | 35 | 6.560 / 5.049 秒 |

每份最终候选均先通过两次独立初始化的开发验证，再由另一名无继承对话的 agent
正式执行一次。正式 agent 只接收仓库／Skill／产物／设备约束，不接收预期动作、
结果或失败诊断。核对 source／candidate 哈希，检查最终截图，并等待官方裁定完成。
准备了四台 API 33 模拟器，各设备独占 writer，服务／租约端口独立；共享主机上的
执行有重叠，不是串行计时。

Recipe 和 Retro 复用不可变的成功 original。联系人旧录制的孤立权限弹窗请求方
无法安全重建，因此使用固定 `grant-all` 权限／启动环境，以 `gpt-6-luna` 补录。

## 修复与被排除的候选

- 公共直接父节点／兄弟节点 selector 支持重复行控件唯一定位；歧义或过期 live
  lookup 均 fail closed。优化由 agent 据证据编排，保留原坐标 fallback，不使用
  task 级机械编译器生成 replay。
- Recipe 核对探索性 Collapse 点击自己的截图／原生证据，并检查 app 实现中的
  权限、持久化、生命周期效果后，仅排除这个未生效点击。没有录制当时的 APK 哈希；
  当前 APK 身份及早于录制的更新时间支持历史一致性，但不能当作加密证明。
- 联系人用有唯一性证据的标签 selector 替代偶然像素位置，保留“已填号码同一行
  为 Home、表单未保存”的强检查。此前官方 reward 曾接受标签尚未正确设置的状态。
  受控实验不支持修改公共输入 transport；历史 87 像素偏移的唯一根因仍未证实。
- Retro 保留全部 35 个动作及原始播放副作用。隐藏统一 10 秒 timeout 的候选虽结果
  正确，仍被排除在合格分数外；最终 `synthesized-v2` 将逐动作原始证据支持的预算
  放入 plan，模块原样消费，另存新的 `formal-02` 结果。
- Recipe／联系人超预算候选及其他失败均保留、不取平均。新 polling 预算从 dispatch
  完成算至同动作、同观测模态支持的采样；precondition 不凭空添加等待窗口。
  Skill 已补充实际执行模块与 plan 的一致性检查。

## 计时与证据边界

original 是包含 recorder 开销的录制 session。replay 包含原生连接、动作／checkpoint／
settle、最终证据采集与关闭；setup、官方初始化／裁定、module 加载、文件写入、一次性
合成／开发不计入 replay。checkpoint capture 与真正 settle delay 分开报告，表中
capture 不含 CLI 最终取证。不声明严格统一加速分；尤其 Retro 缺少历史 RNG／权限
基线取证，旧 fixture 和共享主机争用也不支持将全部任务视为同条件严格对比。

已提交的 [22-case 元数据投影](results/2026-10-16-selected-followup.json)包含任务、
时长、官方结果、诊断指标及本地 evaluation／qualification 产物哈希，不是自包含
复现包或原始证据包。原始产物保留于本地 `.cache/android-world/reuse22-20261015/`
和 `.cache/android-world/remaining3-20261016/`，引用的本地文件不随本次发布。
不发布模型日志、不透明 fixture 快照及新截图。公共修复为 `b638c20`、`4d1a7dc`、
`c2ab039`；保留的 19 个结果使用更早版本，记录在其本地 scorecard 中。
