# iOS Simulator benchmark

[English](README.md) | [简体中文](README.zh-CN.md)

这是 ActOnce 第一条接近真实设备的运行链路：使用专用 iOS Simulator、Appium
WebDriverAgent（WDA）和 Midscene iOS adapter。廉价的 Settings 门禁无需外部 App；
定性的 checkout case 使用固定版本的公开 Simulator fixture。

## 为什么先做 iOS

本机 Xcode 已经包含完整的 Simulator 镜像和真实 framebuffer，可以绕开 Android
ATD 的 framebuffer 限制，以及此前阻塞 Android 视觉测试的 Google APIs 大镜像下载。

ActOnce 会创建或复用名为 `ActOnce iPhone 17 Pro` 的 Simulator，不会抹除或修改
无关的 Simulator。需要指定其他设备时，可以设置 `ACTONCE_IOS_UDID`。

## 启动环境

环境要求：

- Xcode，并已安装 iOS 26.5 Simulator runtime；
- Node.js 22 或更高版本；
- 用于解析 `simctl` 输出并定位专用 Simulator 的 `jq`；
- 已通过 `npm install` 安装仓库依赖。

启动专用 Simulator 和 WDA：

```bash
npm run ios:start
npm run ios:wda
```

`ios:wda` 是一个前台长驻服务，并将日志写入 `.cache/ios-runtime/wda.log`。
保持该终端运行，再在第二个终端执行一个完全不调用模型的 WDA 连接和截图检查：

```bash
npm run ios:wda:smoke
```

该命令会生成 `.cache/ios-runtime/wda-smoke.png`；图片必须是真实 iOS 画面，不能是黑屏。

## Midscene smoke task

第一条确定性任务使用系统内置的 Settings App，并且不会修改系统状态：

> 打开“通用”，进入“关于本机”，并验证设备信息可见。

使用 Git 忽略的本地 `.env` 模型配置运行：

```bash
npm run benchmark:ios:smoke
```

runner 会在第一步失败后立即停止，避免视觉或连接问题引起一长串无意义的模型调用。
JSON 指标保存在 `artifacts/benchmarks/`，Midscene 报告保存在
`midscene_run/report/`。

已在专用 iPhone 17 Pro / iOS 26.5 Simulator 上完成本地验证：任务成功，总耗时
25.9 秒，包含 2 次 Agent 调用和 4 次模型调用。这是后续录制回放要对比的第一条
移动端 baseline。

## 录制到确定性 replay smoke

Settings 路径现在也验证 ActOnce 自身的闭环。保持 WDA 运行，录制一次 Midscene
示教，将完成的逻辑动作机械降低，再运行固定 replay：

```bash
npm run benchmark:ios:record-settings
npm run ios:compile-primitives -- <recording-dir> --output /tmp/settings-actions.js
npm run benchmark:ios:replay-settings
```

已验证的 recording 在同一条有序 session 中包含 Midscene 语义、4 个截图/native
source checkpoint，以及全部被拦截的 WDA exchange。compiler 从 normalized 逻辑设备
坐标降低两个 tap；replay 使用实时 WDA source 检查 Settings、通用、关于本机、设备
信息和 cleanup 状态。两次开发 smoke 均通过，没有 checkpoint timeout 或 AI fallback。
这还不是 macOS suite 所采用的两次 original 对两次 replay 正式性能评分。

## 复杂 checkout fixture

第一条定性 iOS case 使用 Sauce Labs My Demo App `2.2.2`，这是一个面向 UI
自动化的公开 App。ActOnce 不分发第三方二进制；fixture CLI 只会把官方 Simulator
release 下载到 `.cache/`，校验固定 SHA-256、bundle id 和版本，然后安装到 ActOnce
专用 Simulator。上游公开仓库没有声明 OSI license，因此这里将其视为外部测试
fixture，而不是 vendored 的开源依赖。

准备或重置 fixture，再执行完全不调用模型的环境门禁：

```bash
npm run ios:prepare:demo-app
npm run benchmark:ios:demo-app:smoke
```

smoke 会依次完成 Catalog → 商品详情 → 数量 3 → Cart → Checkout → 内置 demo
用户登录 → 预填 shipping address。7 个 WDA source checkpoint 会在预期状态出现后
立即继续，流程停在 payment 之前。已验证的本地运行耗时 11.7 秒，最终截图和结构化
oracle 写入 `.cache/ios-runtime/my-demo-app-smoke/`。

使用 Midscene 录制相同的定性目标：

```bash
npm run benchmark:ios:record-demo-app
```

该命令始终先重置 fixture。这条 recording 将作为下一步 compile/replay 正确性与
性能 benchmark 的输入，目前还不是正式发布的评分结果。

结束后停止 WDA：

```bash
npm run ios:wda:stop
```

## 安全说明

WDA 客户端可以完全控制所选 Simulator。应仅在本地开放 8100 端口、使用专用
Simulator，并避免在 benchmark fixture 中放入凭据或个人数据。当前 Midscene/WDA
依赖树也包含上游 `npm audit` 风险，因此该环境只用于本地开发。
