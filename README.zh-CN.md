# ActOnce

[English](README.md) · [简体中文](README.zh-CN.md)

**让 AI 探索一次界面，把成功路径回放成快速、确定性的程序。**

Computer-use Agent 很擅长探索陌生 UI，却不适合每次都重新发现同一个稳定流程。ActOnce 录制一次成功的 AI 操作，保留真实动作与证据，再把可复用片段编译成由 checkpoint 驱动的回放代码。

当实时 UI 仍与录制一致时，回放完全确定性执行；当状态偏离时，运行时会安全停止，或只针对出错片段调用受限的 AI fallback。

> 录制是证据；编译后、能够感知状态的 replay 才是可执行产物。

> **平台状态：** macOS 已有三个 case 的桌面 suite；iOS 和 Android 都有可复现的 checkout benchmark 与原生确定性 replay。Windows 仍在规划中。

## 当前结果

默认 macOS benchmark suite 包含三个真实的 Lynxtron Fiddle 工作流。最新一轮开发快照使用原生窗口区域截图，所有 replay 均正确完成且没有调用 AI fallback：

| 工作流 | Midscene original 中位数 | 最新 replay | 加速比 |
| --- | ---: | ---: | ---: |
| 语法诊断与 hover tooltip | 52.90 秒 | 5.53 秒 | 9.56× |
| 编辑 → 撤销 → 重做 → 恢复 | 57.30 秒 | 5.03 秒 | 11.39× |
| Console → Gallery → 编辑器往返 | 75.30 秒 | 8.62 秒 | 8.73× |
| **Suite 合计** | **185.49 秒** | **19.18 秒** | **9.67×** |

所有实时截图 checkpoint 均通过，fixture 最终在未保存的情况下恢复，fallback 为 0。这里的 replay 数据是一轮优化快照；正式评分要求两次独立重置的 original 和两次独立重置的 replay，并以正确性作为硬门槛。固定协议见 [Lynxtron benchmark 指南](benchmark/macos/lynxtron-fiddle/README.zh-CN.md)。

第一条正式 iOS checkout benchmark 也已通过：Midscene original 中位数
`220.246 秒`，确定性 replay 中位数 `10.499 秒`，加速 `20.98×`；两次 replay
均正确且没有 fallback。确定性 replay 切换到直连 WDA backend 后，一次开发验证
用时 `8.969 秒`，其中 accessibility capture 为 `3.008 秒`，settle delay 与
fallback 均为 0。详情见 [iOS benchmark 指南](benchmark/ios/README.zh-CN.md)。

Android 通过固定 `midscene-android` profile 录制同构的 My Demo App checkout，
并通过 Android 原生 runtime 回放 9 个归一化 tap primitive。正式基线中，original 中位数为
`140.446 秒`，replay 中位数为 `17.412 秒`，加速 `8.07×`；两次 replay 均正确且
没有 fallback。仓库现在提供一个 CLI，负责 reset fixture、执行两侧流程，并使用
同一个实时 accessibility 与截图精确匹配 oracle。最新一次开发运行正确完成于
`151.285 秒` 对 `6.738 秒`（`22.45×`），fallback 为零，最终截图逐字节一致。
replay 其中 `4.274 秒` 用于 accessibility checkpoint capture，真正 settle delay
仅为 `0.201 秒`。详情见 [Android benchmark 指南](benchmark/android/README.zh-CN.md)。

AndroidWorld harness 现已固定 Midscene 发布的 116 个任务目录，并以截至第三轮
通过的全部 113 个任务为完整目标。可恢复 CLI 会对每个样本执行官方初始化、
Midscene 录制、原生 replay 和官方校验；录制与 replay 之间基于证据的编译由发布的
`compile-device-recording` Skill 负责。正式执行采用单设备、
每 case 单 sample，并通过本机 Codex app server 使用仓库固定的 `codex-luna`
profile；Midscene 与 recorder 共用一个常驻 UIAutomator2 source 获取 accessibility
checkpoint。全量正式评分等待 Skill 编译 replay 的验证；由已删除的 AndroidWorld
自动 compiler 生成的结果不再作为当前 benchmark 证据。
详情见 [AndroidWorld benchmark 指南](benchmark/android/android-world/README.md)。

## 工作原理

```text
AI 示教
  ↓
append-only 录制
  动作 · 时间 · 截图 · AX/WDA · 语义观察
  ↓
基于证据的编译
  选择稳定片段 · 保留观察模态 · 降低为固定 primitive
  ↓
checkpoint 驱动回放
  观察 → 动作 → 等待稳定 → 验证 → 下一步
                              ↘ 允许时使用受限 AI fallback
```

ActOnce 刻意拆分四类职责：

- **Interceptor**：多个独立 source 把原始事件写入同一条有序 session log。
- **发布 Skills**：指导 Agent 使用受支持的组合完成录制，并编译有价值的片段。
- **平台 Runtime**：向生成脚本提供固定、可测试的动作与 checkpoint API。
- **Benchmark**：先验证正确性，再将 replay 执行时间与原始 AI 运行比较。

Midscene 被集中隔离在 `@byted-lynx/actonce-midscene-adapter`：原始 AI 示教和 recorder hook 可以使用它，确定性平台 runtime 不允许依赖它。iOS replay 直接调用 WDA；Android replay 使用 ADB 与常驻 UIAutomator2 accessibility 服务。两个平台都继续把 accessibility checkpoint 作为一级证据。

## 仓库结构

| 路径 | 用途 |
| --- | --- |
| [`skills/record-device-use`](skills/record-device-use/SKILL.md) | 发布录制 Skill；macOS 路径已经验证，iOS 仍处于基础建设阶段 |
| [`skills/compile-device-recording`](skills/compile-device-recording/SKILL.md) | 发布 Skill：选择有证据支持的片段并生成 replay 脚本 |
| [`interceptor/`](interceptor/README.zh-CN.md) | 统一 append-only log 服务，以及 Midscene、macOS input/AX、WDA source |
| [`packages/midscene-adapter/`](packages/midscene-adapter/README.md) | AI 录制所需 Midscene 依赖的唯一 package 边界 |
| [`runtime/macos/`](runtime/macos/README.md) | `@byted-lynx/actonce-macos` 确定性回放 SDK 与 CLI |
| [`runtime/ios/`](runtime/ios/README.md) | `@byted-lynx/actonce-ios` 固定 WDA primitive、source/visual checkpoint 与 replay runner |
| [`runtime/android/`](runtime/android/README.zh-CN.md) | `@byted-lynx/actonce-android` 固定 Android primitive、UI-tree/截图 checkpoint 与 replay runner |
| [`runtime/common/`](runtime/common/README.md) | 共享的 checkpoint 回放流程 |
| [`runtime/midscene-fallback/`](runtime/midscene-fallback/README.md) | 可选的受限 Midscene 恢复适配器 |
| [`benchmark/macos/lynxtron-fiddle/`](benchmark/macos/lynxtron-fiddle/README.zh-CN.md) | 固定桌面 fixture、自然语言 case、runner、证据与 evaluator |
| [`benchmark/android/`](benchmark/android/README.zh-CN.md) | Android 模拟器与可复现的 Midscene 对 ActOnce checkout benchmark |
| [`benchmark/android/android-world/`](benchmark/android/android-world/README.md) | 固定的 113-case Midscene PASS 目录、官方 AndroidWorld bridge、Skill 交接、可恢复 suite 与 evaluator |
| [`benchmark/ios/`](benchmark/ios/README.zh-CN.md) | iOS Simulator、WDA 与 Midscene smoke 环境 |
| [`.agents/skills/benchmark-lynxtron-fiddle`](.agents/skills/benchmark-lynxtron-fiddle/SKILL.md) | 仓库内部 benchmark 流程，不作为 Skill 发布 |

## 快速开始

基础要求是 Node.js 22 或更高版本，以及对应平台工作流所需的 macOS 权限。

从 BNPM 安装完整且版本同步的发行包：

```bash
npm install @byted-lynx/actonce --registry=http://bnpm.byted.org
npx actonce skill install record-device-use
npx actonce skill install compile-device-recording
```

Skill 安装命令在设置了 `CODEX_HOME` 时复制到 `${CODEX_HOME}/skills`，否则复制到 `~/.codex/skills`；其他 Agent 可通过 `--target <目录>` 指定安装位置。API 使用平台子路径导入：

```ts
import { ReplayFlow } from "@byted-lynx/actonce/replay";
import { replayMacPrimitive } from "@byted-lynx/actonce/macos";
import { replayIOSPrimitive } from "@byted-lynx/actonce/ios";
import { replayAndroidPrimitive } from "@byted-lynx/actonce/android";
```

所有 `@byted-lynx/actonce-*` 组件都属于同一个 Changesets fixed group，因此总包、录制 CLI、平台 runtime 和 Skills 始终使用同一发布版本；有精简环境需求时仍可单独安装组件包。

在源码仓库中开发：

```bash
npm install
npm test
npm run typecheck
```

准备固定版本的 Lynxtron fixture，并运行默认 original suite：

```bash
npm run benchmark:macos:lynxtron:prepare
npm run benchmark:macos:lynxtron:suite
```

桌面 benchmark 会控制鼠标、键盘、剪贴板、应用、窗口和显示器；运行期间请勿同时操作机器。

Midscene original 需要兼容的多模态模型。复制仓库模板，并确保真实密钥只保存在本地：

```bash
cp .env.example .env
# 编辑 .env，然后验证当前 provider。
npm run model:verify
```

不要提交 API Key，也不要录制包含敏感信息的 UI。`.env`、recording、生成的 fixture 和 benchmark artifact 均已被 Git 忽略。

## 录制与编译

稳定的平台组合固化在 CLI 中，而不是由 Skill 临时拼装。录制 Skill 只需选择支持的 profile；启用的 interceptor 会把各自事件写入同一条有序 session。

```bash
npm run interceptor:profiles
npm run interceptor:start -- record midscene-macos \
  --entry /absolute/path/to/task.ts \
  --display-id 0

npm run interceptor:start -- record midscene-android \
  --entry /absolute/path/to/task.ts \
  --serial emulator-5554
```

Android 遵循 Lynx CI 相同的全局环境契约：`$ANDROID_HOME` 提供 `adb` 与 `emulator`，`emulator -list-avds` 从用户级目录发现共享 AVD。macOS 的标准位置是 `~/Library/Android/sdk` 与 `~/.android/avd`；ActOnce 会自动优先复用它们，仅在全局 SDK 不存在时回退到仓库本地 bootstrap。

录制产物由主 manifest、`events.ndjson` 与旁路的内容寻址附件组成，包括截图、AX tree、WDA payload 和 source artifact。Midscene Assert、Boolean、Query 的结果会成为一级 semantic observation 事件，并保留证据来源。

编译 Skill 随后选择可复用片段，通过固定 runtime primitive 降低输入，根据片段中真实存在的证据规划 observation，并在 replay 前验证每项 assertion decision。

## macOS 回放 Runtime

[`@byted-lynx/actonce-macos`](runtime/macos/README.md) 是第一个完整的平台 runtime。它使用 Appium Mac2/WebDriverIO 控制应用和执行固定输入 primitive，将目标窗口规范化到指定显示器，并通过原生窗口区域截图快速验证视觉 checkpoint。

```ts
import {
  captureMacRegionScreenshot,
  replayMacPrimitive,
  setupMacWindow,
} from "@byted-lynx/actonce-macos";

const setup = await setupMacWindow({
  processName: "Example",
  displayId: 0,
  width: 1200,
  height: 800,
  margin: 40,
});

await captureMacRegionScreenshot("checkpoint.png", setup.frame, {
  timeoutMs: 2_000,
});
```

窗口区域截图不再通过 WDA 传输完整 Retina 屏幕 PNG。生成动作和视觉区域共享经过验证的 window frame，因此其他显示器、其他应用和桌面位置都不会进入 oracle。

## 评测契约

ActOnce 只报告两个 benchmark 维度：

1. **正确性**：结构化 assertion 和筛选后的截图证据先通过，再由 AI 审查 evidence bundle。
2. **条件性能**：只有正确性通过后，才比较 original 中位耗时与 replay 中位耗时。

Fallback 延迟、checkpoint 轮询、恢复和 cleanup 都计入 replay 时间。Fallback 次数和控制器启动总耗时只是诊断信息，不是额外分数。速度再快的错误 replay 也不可比较。

## 当前状态

ActOnce 是一个面向开发机器工作流的活跃原型。macOS 已有正式多 case suite；iOS
和 Android 都已有经过正式 benchmark 验证的 original 到 replay 对比，其确定性
runtime 现在使用直接的原生设备 backend，不再经过 Midscene adapter。

接下来的工程重点是继续降低 checkpoint 开销、把编译能力推广到当前 benchmark 之外，并独立加入 Windows，而不是过早强行统一跨平台 action API。
