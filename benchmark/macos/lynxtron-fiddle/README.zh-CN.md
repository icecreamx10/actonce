# Lynxtron Fiddle macOS Benchmark

这个 benchmark 将应用 fixture、五条自然语言测试用例，以及 Midscene + ActOnce
运行器放在同一个目录，覆盖逐渐加深的桌面交互链路。机器可读的 suite 顺序在
[`suite.json`](suite.json)，每条用例的 prompt、步骤、checkpoint、期望值和清理
策略位于 [`cases/`](cases/)；运行器不会再内嵌另一份 prompt。

| Case | 复杂度 | 交互链路 |
| --- | --- | --- |
| `diagnostic-hover` | basic | 编辑 → 语言服务诊断 → hover 提示 → 撤销 |
| `palette-find-navigation` | intermediate | 命令面板 → 切换编辑器 → 查找 → 选中 → 返回 |
| `dual-editor-diagnostic-recovery` | advanced | 破坏两个编辑器 → 独立验证 → 分别恢复 |
| `console-gallery-roundtrip` | advanced | 切换 Console → Gallery 导航 → 检查卡片 → 恢复视图 |
| `edit-run-preview-stop-restore` | deep | 编辑主进程/包配置 → 运行原生预览 → 检查 Console → 停止 → 恢复 |

## 复现

要求：

- Apple Silicon Mac（`darwin/arm64`），Node.js 22 或更高版本；
- 为终端或宿主应用授予辅助功能与屏幕录制权限；
- 为 `/usr/bin/osascript` 授予辅助功能权限；运行器会通过 System Events 激活
  准确的 Lynxtron PID；
- 仓库 `.env` 中已有可工作的 Midscene 模型配置；
- 所选显示器必须能容纳 `1372x880` 窗口，并在四边各保留 40 point 余量；
- 运行期间不要同时操作鼠标、键盘、窗口或剪贴板。
- 从普通桌面运行，不要停留在其他应用的全屏 Space 中。

安装 benchmark 自己锁定版本的 Lynxtron runtime 并执行默认用例：

```bash
npm run benchmark:macos:lynxtron:reproduce
```

依赖准备不会控制电脑，可以单独执行：

```bash
npm run benchmark:macos:lynxtron:prepare
```

真正会操作桌面的命令是：

```bash
npm run benchmark:macos:lynxtron
```

执行指定 case：

```bash
npm run benchmark:macos:lynxtron -- --case dual-editor-diagnostic-recovery
```

执行完整 suite，或按给定顺序执行一个子集：

```bash
npm run benchmark:macos:lynxtron:reproduce-suite
npm run benchmark:macos:lynxtron:suite -- \
  --case palette-find-navigation \
  --case edit-run-preview-stop-restore
```

完整 suite 可能连续控制桌面数分钟。`suite-runner.ts` 串行执行各 case，避免窗口、
键盘焦点、录制和清理过程重叠；某条 case 失败不会阻止后续 case 生成证据。

可通过 `ACTONCE_DISPLAY_ID` 指定 Midscene display（默认 `0`），或通过
`ACTONCE_BENCHMARK_OUTPUT_DIR` 指定明确的产物目录。

每条 case 都会启动自己的 Lynxtron 进程组：按准确 PID 将 fixture 规范到所选显示器，执行声明的
步骤与 case 专属恢复策略，关闭 recorder，并只结束自己启动的进程组。所有 case
都禁止保存。正式录制和计时前，CLI 会从固定归档重建完整 desktop fixture，并为每次
运行创建全新的隔离 Fiddle 配置与临时目录、
固定跳过首次启动引导、等待 IDE listener readiness 日志，并调用共享的 macOS replay
setup 将窗口居中、保证完整可见、与四边各保留 40 point 余量、raise 窗口并验证最终
frame；这段 setup 不依赖 AI 视觉断言。进入计时任务后，case precondition 仍会确认
默认编辑器无遮挡且没有 modal，关键输入和
导航都会通过可见状态验证是否真正生效，不再把“输入事件成功发出”等同于“应用
已经消费动作”。激活和 readiness 检查发生在正式录制前；precondition、操作、
观察、等待和清理共享一条有序 recording 时间线。

## Replay 评测

仓库内部 Skill `.agents/skills/benchmark-lynxtron-fiddle/SKILL.md` 固定
`diagnostic-hover` 的评测流程。正确性是性能评测的硬门槛：CLI 先检查结构化
assertion 并筛选截图证据，随后 AI 只审核这份精简证据；两轮都通过后才能计算加速比。
replay 可以使用有界 fallback；fallback 本身不会让正确结果失去性能对比资格。

replay 的视觉 assertion 只从所选 display 截图中裁剪窗口相对区域。App 在桌面上的
位置和无关窗口不会进入正确性 oracle；setup 返回的 frame 只负责把录制时的窗口相对
区域与操作点转换到当前 display。

```bash
npm run benchmark:macos:lynxtron:cli -- evidence \
  --original <original-result.json> \
  --replay <replay-result.json> \
  --output <review-directory>
```

计分区间统一使用 `executionDurationMs`，截图筛选和最终 AI 审核耗时不计入其中；
fallback 的模型耗时、恢复动作、checkpoint 复验和 cleanup 都必须计入。fallback 统计
只作为诊断信息，不单独评分。一次正确的原始执行与五次独立重置且正确的 replay
比较，replay 使用耗时中位数。

## 产物

每次运行会在 `artifacts/benchmarks/lynxtron-fiddle/<run-id>/` 写入完整目录：

```text
result.json                 统一的成功/失败结果与来源信息
lynxtron.log                捕获的 fixture host 输出
fixture-config.json         每次运行全新生成的 Fiddle 偏好与 session store
fixture-tmp/                隔离的 materialized 源码与诊断文件
midscene-report.html        Midscene 生成的报告
recording/actonce/
  manifest.json             录制元数据与所选 display
  events.ndjson             按序排列的 case step、Midscene、输入、AX 与 checkpoint 事件
  artifacts/                截图、AX 快照与各 source 的辅助产物
```

suite 会在 `artifacts/benchmarks/lynxtron-fiddle-suites/<suite-run-id>/` 写入
`suite-result.json`，并在 `cases/<case-id>/` 下保存每条 case 的完整产物。case
结果还包含逐步状态、耗时、期望值、观察值、失败证据，以及总耗时和模型执行耗时。
recorder 还会写入 `benchmark.case.*` 和 `benchmark.step.*` 事件，让 case 边界、
显式等待、原始设备操作、观察与证据处于同一条准确的跨 source 顺序中，无需事后
只依靠 timestamp 重建。

生成的依赖、解压后的 fixture 和运行产物都不会提交到 Git。

## 固定版本的 fixture

[`fixture/lynxtron-fiddle-desktop-arm64.tgz`](fixture/lynxtron-fiddle-desktop-arm64.tgz)
是从 [`fixture/provenance.json`](fixture/provenance.json) 中指定的上游 commit
构建并验证过的桌面 bundle。每次运行都会校验其 SHA-256。官方 Lynxtron host
下载也固定了版本、URL 与 SHA-256。由于其上游 npm postinstall 在解压 macOS
framework 时可能挂起，`prepare.ts` 会禁用 lifecycle script 安装精确的 npm 依赖图，
再自行下载、校验并解压官方 host。archive、来源记录、lockfile、case 文件与 runner
共同定义了可复现输入。

构建后的 fixture archive 有意不包含体积较大的 TypeScript 包。解压后，runner 会把
lockfile 中的精确版本链接到 fixture 自己的 `desktop/node_modules`。这是必要的：Node
会先查找祖先目录的 `node_modules`，再使用 `NODE_PATH`，而仓库级 compiler 可能与
bundle 内的 extension host 不兼容。每次运行在打开 UI 前，都会通过真实 ExtHost IPC
发送固定语法探针，并强制要求返回 `Expression expected.`；因此语言服务环境损坏会在
preflight 阶段明确失败，不会伪装成 Midscene 视觉识别失败。

若要有意升级 fixture，应重新构建上游 `lynxtron-go/dist/desktop`，生成新 archive，
并同步更新 `fixture/provenance.json` 中的 commit 与 checksum。接受变更前需运行仓库
测试；fixture contract test 会拒绝 checksum 或结构发生意外漂移的 archive。

[English](README.md)
