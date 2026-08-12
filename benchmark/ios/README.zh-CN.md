# iOS Simulator benchmark

[English](README.md) | [简体中文](README.zh-CN.md)

这是 ActOnce 第一条接近真实设备的运行链路：使用专用 iOS Simulator、Appium
WebDriverAgent（WDA）和 Midscene iOS adapter，不需要下载测试 APK 或第三方 App。

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

下一条定性 benchmark 将使用系统内置 Reminders App：创建一个固定 reminder、
设置优先级、返回列表、重新打开并验证结果。固定的 Simulator runtime 已包含
`com.apple.reminders`，不需要外部 App 源。Settings 会保留为更便宜的连接门禁。

结束后停止 WDA：

```bash
npm run ios:wda:stop
```

## 安全说明

WDA 客户端可以完全控制所选 Simulator。应仅在本地开放 8100 端口、使用专用
Simulator，并避免在 benchmark fixture 中放入凭据或个人数据。当前 Midscene/WDA
依赖树也包含上游 `npm audit` 风险，因此该环境只用于本地开发。
