# ActOnce

[English](README.md) · [简体中文](README.zh-CN.md)

**让 AI 探索一次界面，把成功路径回放成快速、确定性的程序。**

Computer-use Agent 擅长探索陌生界面，但每次都重新发现同一个稳定流程既慢又贵。ActOnce 录制一次成功的 AI 执行，保留真实动作与证据，再把可复用片段编译成由 checkpoint 驱动的回放代码。

当实时 UI 与录制一致时，replay 确定性执行；状态偏离时，运行时会 fail closed，或只针对受影响片段调用明确受限的 AI fallback。

> 录制是证据；编译后、能够感知状态的 replay 才是可执行产物。

**平台状态：** macOS、iOS、Android 均已有原生确定性 runtime 和经过 benchmark 验证的 original-to-replay 路径；Windows 仍在规划中。

## 结果

正确性是硬门槛：只有 replay 通过与 original 相同的任务 oracle，ActOnce 才报告性能优势。

| Benchmark | AI original | 确定性 replay | 加速 | 正确性 |
| --- | ---: | ---: | ---: | --- |
| macOS · 3-case Lynxtron suite | 185.49 秒 | 19.18 秒 | 9.67× | 3/3，fallback 0 |
| iOS · checkout | 220.246 秒 | 10.499 秒 | 20.98× | 2/2，fallback 0 |
| Android · checkout | 140.446 秒 | 17.412 秒 | 8.07× | 2/2，fallback 0 |
| AndroidWorld · 已验证 5-case 切片 | 972.837 秒 | 95.938 秒 | 10.14× | 5/5，fallback 0 |

AndroidWorld 的完整目标是 Midscene 三轮公开结果中至少通过一次的 113 个任务。最新切片包含 `ExpenseAddMultiple`：original 与 replay 的官方 reward 均为 `1.0`，耗时 `293.799 秒 → 56.803 秒`（`5.17×`）。全量 suite 仍在推进。

协议与证据：

- [macOS Lynxtron Fiddle](benchmark/macos/lynxtron-fiddle/README.zh-CN.md)
- [iOS Simulator benchmark](benchmark/ios/README.zh-CN.md)
- [Android checkout benchmark](benchmark/android/README.zh-CN.md)
- [AndroidWorld harness](benchmark/android/android-world/README.md)

## 工作原理

```text
AI 示教
  ↓
append-only 录制
  动作 · 时间 · 截图 · AX/WDA/UIA2 · 语义观察
  ↓
基于证据的编译
  选择稳定片段 · 保留观察模态 · 降低为固定 primitive
  ↓
checkpoint 驱动回放
  观察 → 动作 → 等待稳定 → 验证 → 下一步
                              ↘ 允许时使用受限 AI fallback
```

四层职责刻意分离：

- **Interceptor**：多个独立 source 写入同一条有序 session。
- **发布 Skills**：指导受支持的录制与基于证据的编译。
- **原生 Runtime**：向生成脚本提供固定、可测试的 action 和 checkpoint API。
- **Benchmark**：先验证正确性，再比较端到端执行时间。

Midscene 被隔离在 `@byted-lynx/actonce-midscene-adapter`：AI 示教可以使用它，确定性 runtime 不允许依赖它。iOS 直连 WDA；Android 使用 ADB 与常驻 UIAutomator2；macOS 使用原生输入、accessibility 与窗口区域截图。

## 仓库结构

| 路径 | 用途 |
| --- | --- |
| [`skills/record-device-use`](skills/record-device-use/SKILL.md) | 发布录制 Skill |
| [`skills/compile-device-recording`](skills/compile-device-recording/SKILL.md) | 发布的 evidence-to-replay Skill |
| [`interceptor/`](interceptor/README.zh-CN.md) | 有序 recorder 与平台/Midscene source |
| [`packages/midscene-adapter/`](packages/midscene-adapter/README.md) | Midscene 依赖的唯一 package 边界 |
| [`runtime/common/`](runtime/common/README.md) | 共享 checkpoint 回放流程 |
| [`runtime/macos/`](runtime/macos/README.md) | macOS 原生 runtime 与 CLI |
| [`runtime/ios/`](runtime/ios/README.md) | WDA 直连 runtime 与 checkpoint |
| [`runtime/android/`](runtime/android/README.zh-CN.md) | ADB/UIAutomator2 runtime 与 checkpoint |
| [`benchmark/`](benchmark/) | 可复现 fixture、runner 与 evaluator |

## 快速开始

基础要求是 Node.js 22 或更高版本，以及目标平台所需的权限和设备工具。

从 BNPM 安装版本同步的发行包与 Skills：

```bash
npm install @byted-lynx/actonce --registry=http://bnpm.byted.org
npx actonce skill install record-device-use
npx actonce skill install compile-device-recording
```

通过平台子路径使用 API：

```ts
import { ReplayFlow } from "@byted-lynx/actonce/replay";
import { replayMacPrimitive } from "@byted-lynx/actonce/macos";
import { replayIOSPrimitive } from "@byted-lynx/actonce/ios";
import { replayAndroidPrimitive } from "@byted-lynx/actonce/android";
```

在源码仓库中开发：

```bash
npm install
npm test
npm run typecheck
```

Midscene original 需要兼容的多模态模型。真实凭证只保存在本地：

```bash
cp .env.example .env
# 编辑 .env，然后验证当前 provider。
npm run model:verify
```

不要提交 API Key，也不要录制敏感 UI。`.env`、recording、生成的 fixture 和 benchmark artifact 均已被 Git 忽略。

## 录制与编译

受支持的 source 组合固化为 CLI profile，而不是由 Skill 临时拼装。所有启用的 interceptor 都写入同一个 session log。

```bash
npm run interceptor:profiles

npm run interceptor:start -- record midscene-macos \
  --entry /absolute/path/to/task.ts \
  --display-id 0

npm run interceptor:start -- record midscene-android \
  --entry /absolute/path/to/task.ts \
  --serial emulator-5554
```

每条 recording 包含 manifest、有序 `events.ndjson`，以及内容寻址的截图、原生 UI tree、WDA payload 和 source artifact。Midscene Assert、Boolean、Query 结果是带证据来源的一级 semantic observation。

编译 Skill 会选择可复用片段，保留录制动作与观察模态，通过原生 runtime 降低输入，只从已有证据生成 assertion，并实际执行结果，直到脚本稳定或确认具体 blocker。

## 评测契约

1. **正确性：** runtime checkpoint 通过，随后独立任务 oracle 通过。
2. **条件性能：** 只有正确的 replay 才与 AI original 比较耗时。

Checkpoint capture、settle、fallback、recovery 和 cleanup 全部计入 replay 时间；fallback 次数以及 capture/settle 耗时作为诊断项报告。速度再快的错误 replay 也不可比较。

ActOnce 仍是活跃原型。当前重点是扩大 AndroidWorld 覆盖、继续降低 checkpoint capture 成本、把编译推广到固定 benchmark 之外，并独立支持 Windows。
