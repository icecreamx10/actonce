# ActOnce

[English](README.md) · [简体中文](README.zh-CN.md)

**让 AI 探索一次界面，把成功路径回放成快速、确定性的程序。**

Computer-use Agent 很擅长探索陌生 UI，却不适合每次都重新发现同一个稳定流程。ActOnce 录制一次成功的 AI 操作，保留真实动作与证据，再把可复用片段编译成由 checkpoint 驱动的回放代码。

当实时 UI 仍与录制一致时，回放完全确定性执行；当状态偏离时，运行时会安全停止，或只针对出错片段调用受限的 AI fallback。

> 录制是证据；编译后、能够感知状态的 replay 才是可执行产物。

## 当前结果

默认 macOS benchmark suite 包含三个真实的 Lynxtron Fiddle 工作流。最新一轮开发快照使用原生窗口区域截图，所有 replay 均正确完成且没有调用 AI fallback：

| 工作流 | Midscene original 中位数 | 最新 replay | 加速比 |
| --- | ---: | ---: | ---: |
| 语法诊断与 hover tooltip | 52.90 秒 | 5.53 秒 | 9.56× |
| 编辑 → 撤销 → 重做 → 恢复 | 57.30 秒 | 5.03 秒 | 11.39× |
| Console → Gallery → 编辑器往返 | 75.30 秒 | 8.62 秒 | 8.73× |
| **Suite 合计** | **185.49 秒** | **19.18 秒** | **9.67×** |

所有实时截图 checkpoint 均通过，fixture 最终在未保存的情况下恢复，fallback 为 0。这里的 replay 数据是一轮优化快照；正式评分要求两次独立重置的 original 和两次独立重置的 replay，并以正确性作为硬门槛。固定协议见 [Lynxtron benchmark 指南](benchmark/macos/lynxtron-fiddle/README.zh-CN.md)。

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

## 仓库结构

| 路径 | 用途 |
| --- | --- |
| [`skills/record-device-use`](skills/record-device-use/SKILL.md) | 发布 Skill：录制受支持的 macOS 与 iOS computer-use session |
| [`skills/compile-device-recording`](skills/compile-device-recording/SKILL.md) | 发布 Skill：选择有证据支持的片段并生成 replay 脚本 |
| [`interceptor/`](interceptor/README.zh-CN.md) | 统一 append-only log 服务，以及 Midscene、macOS input/AX、WDA source |
| [`runtime/macos/`](runtime/macos/README.md) | `@actonce/macos` 确定性回放 SDK 与 CLI |
| [`runtime/common/`](runtime/common/README.md) | 共享的 checkpoint 回放流程 |
| [`runtime/midscene-fallback/`](runtime/midscene-fallback/README.md) | 可选的受限 Midscene 恢复适配器 |
| [`benchmark/macos/lynxtron-fiddle/`](benchmark/macos/lynxtron-fiddle/README.zh-CN.md) | 固定桌面 fixture、自然语言 case、runner、证据与 evaluator |
| [`benchmark/android/`](benchmark/android/README.zh-CN.md) | Android 模拟器与 Markor benchmark 环境 |
| [`benchmark/ios/`](benchmark/ios/README.zh-CN.md) | iOS Simulator、WDA 与 Midscene smoke 环境 |
| [`.agents/skills/benchmark-lynxtron-fiddle`](.agents/skills/benchmark-lynxtron-fiddle/SKILL.md) | 仓库内部 benchmark 流程，不作为 Skill 发布 |

## 快速开始

基础要求是 Node.js 22 或更高版本，以及对应平台工作流所需的 macOS 权限。

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
```

录制产物由主 manifest、`events.ndjson` 与旁路的内容寻址附件组成，包括截图、AX tree、WDA payload 和 source artifact。Midscene Assert、Boolean、Query 的结果会成为一级 semantic observation 事件，并保留证据来源。

编译 Skill 随后选择可复用片段，通过固定 runtime primitive 降低输入，根据片段中真实存在的证据规划 observation，并在 replay 前验证每项 assertion decision。

## macOS 回放 Runtime

[`@actonce/macos`](runtime/macos/README.md) 是第一个完整的平台 runtime。它使用 Appium Mac2/WebDriverIO 控制应用和执行固定输入 primitive，将目标窗口规范化到指定显示器，并通过原生窗口区域截图快速验证视觉 checkpoint。

```ts
import {
  captureMacRegionScreenshot,
  replayMacPrimitive,
  setupMacWindow,
} from "@actonce/macos";

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

ActOnce 是一个面向开发机器工作流的活跃原型。仓库目前已经包含 recorder 架构、可发布的录制与编译 Skills、checkpoint/fallback runtime、macOS SDK、Android/iOS capture 基础，以及可复现的 Midscene 对 replay benchmark。

接下来的工程重点是继续降低截图开销、把编译能力推广到当前 benchmark 之外，并为 iOS、Android、Windows 分别实现原生 runtime，而不是过早强行统一跨平台 action API。
