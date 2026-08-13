# ActOnce

[English](README.md) | [简体中文](README.zh-CN.md)

将 AI 驱动的 UI 任务录制一次，之后以确定性方式回放。

## 发布的 Skills

本仓库在 [`skills/`](skills/) 下发布两个可独立分发的 Codex Skill：

- [`record-device-use`](skills/record-device-use/SKILL.md)：通过稳定的 ActOnce CLI profile 录制 Midscene macOS、Midscene iOS 或通用 WDA 运行。
- [`compile-device-recording`](skills/compile-device-recording/SKILL.md)：阅读录制、选择有证据支持的片段，并生成确定性回放脚本。

每个目录都是独立的发布包，包含自己的 `SKILL.md`、`agents/openai.yaml`、脚本和 references。仓库其余代码是这两个 Skill 使用的 recorder 实现和 benchmark fixture。

## macOS 回放运行时

[`@actonce/macos`](runtime/macos/README.md) 是第一个按平台独立实现的回放包。它面向开发机器，是 WebdriverIO 与 Appium Mac2 上的一层轻量 TypeScript API。CLI 负责启动 Appium、创建一个共享 Mac2 session、按顺序执行多份生成脚本并清理资源；平台生命周期和 source 组合不会下放到 Skill 或生成脚本中。

```bash
npm run macos:install
npm run macos:doctor
npm run macos:run -- 01-setup.js 02-action.js 03-assert.js
```

窗口规范化由回放 SDK 实现，不属于生成 Skill 的逻辑。`run` 会在创建 App session 后
原子调用这个能力：

```bash
node runtime/macos/dist/cli.js run \
  --app-path /path/to/Lynxtron.app \
  --setup-window-process-name lynxtron \
  --setup-display-id 0 \
  --setup-window-width 1372 \
  --setup-window-height 880 \
  --setup-window-margin 40 \
  replay.js
```

生成的操作和截图 checkpoint 以命令返回的窗口 frame 为坐标原点。桌面位置、其他
显示器以及其他应用的像素不属于视觉 oracle。

## 动机

Midscene 一类视觉驱动 Agent 能够操作仅靠选择器难以自动化的界面，在首次探索任务时尤其有价值。但如果每次运行都让模型重新发现同一个稳定流程，就会带来额外的延迟、成本和不确定性。

ActOnce 将一次成功的 AI 运行视为可以编译的示教过程。示教期间，它记录真实执行的设备动作、动作目标以及每一步前后的 UI 状态。后续运行使用确定性回放引擎，仅在录制流程与当前 UI 不再匹配时向 AI 求助。

我们的核心假设是：

> 对于稳定的定性 UI 任务，可以保留 AI 操作者的界面适应能力，同时让重复运行接近传统自动化的速度、成本和可复现性。

## 基本方法

一个 ActOnce 流程包含三个阶段：

1. **示教（Demonstrate）**：AI Agent 通过经过插桩的设备适配器完成任务。
2. **编译（Compile）**：ActOnce 将动作、多种目标定位信息、前置条件、后置条件以及脱敏后的数据绑定保存为可读流程。
3. **回放（Replay）**：运行时以确定性方式解析目标、执行动作并验证结果状态。受限的 AI fallback 可以修复失败步骤，并提出带版本的 locator 补丁。

目标定位计划按照以下顺序进行：

1. resource ID、accessibility label 等稳定的结构化标识；
2. 文本和局部 UI 结构；
3. 相对于稳定容器的位置；
4. 局部视觉匹配；
5. 归一化坐标；
6. 最后使用受限的 AI 重新定位。

ActOnce 会保留视频和截图用于诊断，但它们只是证据，不是可执行表示。真正的执行产物是状态感知的流程：等待前置状态、解析目标、执行动作、等待 UI 稳定并验证后置状态。

## 初始目标

第一个里程碑会刻意控制范围：以 Midscene 作为 AI baseline，在一个确定性的浏览器任务上验证核心假设。

达到以下标准时，视为里程碑成功：

- Midscene 能完成本地 benchmark 任务并生成结果报告；
- 一次成功运行能够被表示成 ActOnce flow；
- 该 flow 能够在不调用模型的情况下连续完成 20 次干净回放；
- 回放中位耗时至少比 Midscene baseline 快 5 倍；
- 当后置条件被故意改变时，回放能够报告失败，而不是静默通过；
- 小范围 locator 变化能够通过一次受限的 AI fallback 恢复，并保存为可审查的补丁。

这个里程碑暂不处理跨 App 移动端导航、任意工作流发现、验证码以及破坏性动作的无人值守执行。

## Benchmark 001：创建测试工单

仓库内提供了一个确定性的本地测试页面。任务是：

> 创建一个标题为“Payment button fails on checkout”的高优先级工单，包含诊断信息，提交后验证工单 `T-1001` 已创建。

该任务覆盖文本输入、选项选择、复选框、提交、异步 UI 状态以及语义结果验证。使用本地页面可以在第一次比较中排除网络和第三方 UI 波动。

每个 runner 会将 JSON 结果写入 `artifacts/benchmarks/`。评测只有两个维度，
且正确性是性能比较的前置门槛：

| 指标 | 含义 |
| --- | --- |
| 正确性 | CLI assertion 与筛选后的截图证据先通过，再由 AI 完成最终视觉审核 |
| 条件性能 | 原始执行耗时与正确 replay 执行耗时中位数的比较 |

端到端耗时、模型调用、fallback 和失败详情仍作为诊断信息保留，但不构成额外评分。
正确性失败时，性能标记为不可比较。

## 开发环境

环境要求：

- Node.js 22 或更高版本；
- 通过 Playwright 安装的 Chromium 浏览器；
- 运行 AI baseline 所需的 Midscene 兼容多模态模型。

安装依赖和 Chromium：

```bash
npm install
npx playwright install chromium
```

第一个 baseline 使用 Gemini 免费层。先在
[Google AI Studio](https://aistudio.google.com/apikey) 创建 API Key，再根据仓库模板创建本地配置：

```bash
cp .env.example .env
# 编辑 .env，替换 MIDSCENE_MODEL_API_KEY。
npm run model:verify
```

模板使用 Midscene 推荐用于 Gemini UI 定位的 `gemini-3.5-flash`。免费层额度可能变化，
且 Google 可能使用免费层输入改进产品，因此 benchmark 截图中不能包含敏感数据。
真实 `.env` 文件已被 Git 忽略。

只启动确定性测试页面：

```bash
npm run benchmark:fixture
```

然后访问 <http://127.0.0.1:4173>。

运行 Midscene baseline：

```bash
npm run benchmark:midscene
```

Android 模拟器、Midscene 连接 smoke test 以及固定版本 Markor APK 的 benchmark 设置请参阅 [Android benchmark 指南](benchmark/android/README.zh-CN.md)。

专用 iOS Simulator、WebDriverAgent 和 Midscene iOS smoke task 的设置请参阅 [iOS benchmark 指南](benchmark/ios/README.zh-CN.md)。

可复现的 macOS Lynxtron Fiddle 诊断 hover 用例（包含固定版本的 app fixture、自然语言 testcase、runner 与产物契约）请参阅 [Lynxtron Fiddle benchmark 指南](benchmark/macos/lynxtron-fiddle/README.zh-CN.md)。

被动、append-only 的 WDA capture boundary 见 [Interceptor 设计](interceptor/README.zh-CN.md)。

运行仓库检查：

```bash
npm test
npm run typecheck
npm run test:macos-runtime
```

## 近期路线图

1. 稳定 benchmark 契约并采集 Midscene baseline 数据。
2. 定义带版本的 ActOnce flow schema。
3. 对 action adapter 插桩并编译第一条成功轨迹。
4. 实现确定性的 Web 回放和后置条件检查。
5. 加入受限的 AI 重新定位及可审查的修复补丁。
6. 在 Android ADB/UIAutomator adapter 后复用同一套协议。

## 项目状态

ActOnce 目前处于早期实验阶段。仓库当前建立了项目动机、benchmark 契约和 Midscene baseline；recorder 与 replay engine 是下一个实现里程碑。

当前 Midscene 依赖树包含上游传递依赖触发的 `npm audit` 风险。在这些依赖问题解决前，benchmark 仅用于本地测试，不应接收不可信输入。
