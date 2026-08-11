# Android Benchmark 环境

[English](README.md) | [简体中文](README.zh-CN.md)

Android benchmark 分成两层，避免将基础设施故障与特定 APK 的行为混在一起。

## 第一层：Midscene 连接 Smoke Test

Smoke test 使用固定 emulator image 自带的 Android Settings App。它会打开 Display 设置、启用深色主题并验证最终 UI 状态。这样无需引入第三方 APK，就可以验证 emulator、ADB、截图、输入注入、Midscene 和模型组成的完整链路。

```bash
npm run android:bootstrap
npm run android:start
npm run benchmark:android:midscene
```

设置 Midscene 模型环境变量后，也可以将后两个命令一起运行：

```bash
npm run benchmark:android:smoke
```

需要观察模拟器界面时使用 `npm run android:start:headed`。`npm run android:start:foreground` 会让所属 shell 保持运行，适合具有进程隔离的 CI 环境。完成后运行 `npm run android:stop`。

## 第二层：真实 APK Benchmark

第一个外部 APK 选择 [Markor](https://github.com/gsantner/markor)，并固定为 2.16.1 版本。Markor 开源、支持完全离线运行、不需要账号、提供通用 APK，同时具备真实的文档创建和编辑流程。安装脚本只从官方 GitHub Release 下载 APK，并在安装前验证 SHA-256 摘要。

```bash
npm run android:install:markor
npm run android:prepare:markor
```

建议的第一个任务是：

> 创建名为 `actonce-benchmark.md` 的 Markdown 笔记，输入 `Replay this task without AI.`，保存后返回文件列表，重新打开文件并验证内容。

每次正式测量前，测试环境会清除 Markor App 数据、授予所需的 storage app-op、通过 accessibility target 完成 onboarding、删除 benchmark 笔记并打开 Documents 列表。这部分环境准备不计入测量时间。

配置 Midscene 模型变量后运行：

```bash
npm run benchmark:android:markor
```

## 可复现环境约定

- Android API：35
- image：AOSP Automated Test Device（`aosp_atd`），可以运行普通 APK，同时避免不必要的 Google service 体积
- AVD 设备配置：Pixel 6
- AVD 名称：`actonce_api35_atd`
- 默认 emulator serial：`emulator-5554`
- userdata 分区：512 MB，足够 benchmark APK 使用并适合 CI 磁盘
- 动画：开机后关闭
- Markor：2.16.1，SHA-256 `e88cdcced7aa3dca25e6b9c7a9bdcfad3e3988ee545be951f42bf9441b5e46bf`

SDK、AVD、APK、运行日志以及仓库本地 JDK 都保存在 `.cache/` 下，不会提交到 Git。
