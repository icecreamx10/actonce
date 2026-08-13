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

## 第二层：确定性 Checkout Benchmark

主 fixture 是 Sauce Labs My Demo App Android 2.2.0 build 25，官方 Release APK 与 SHA-256 固定在 [`my-demo-app/fixture.json`](my-demo-app/fixture.json)。case 会选择黑色背包、把数量设为 3、验证 `$ 89.97` 购物车、使用内置 demo 账号，并停在预填的配送地址页面。

```bash
npm run android:install:demo-app
npm run benchmark:android:record-demo-app
npm run benchmark:android:replay-demo-app
```

每次执行前都会清空 App 数据。original 走固定 `midscene-android` recorder profile；replay 使用机械录制的逻辑坐标、Android UI-tree checkpoint、最终截图，并默认禁用 fallback。第一次端到端 smoke 中，AI original 约 127 秒，确定性 replay 约 18 秒；这是开发测量，还不是正式的两次评分。

## 备选文档 Fixture

[Markor](https://github.com/gsantner/markor) 固定为 2.16.1，继续作为备选的文档编辑 fixture。它开源、可离线运行且无需账号。

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
- image：标准 Google APIs（`google_apis`），为视觉自动化提供真实 framebuffer
- GPU 模式：默认使用软件渲染（`swiftshader`）；如有需要可通过 `ACTONCE_EMULATOR_GPU` 覆盖
- AVD 设备配置：Pixel 6
- AVD 名称：`actonce_api35_google_apis`
- 默认 emulator serial：`emulator-5554`
- 存在时优先复用用户级 SDK：`~/Library/Android/sdk`；否则使用仓库 `.cache/android-sdk`
- 共享用户级 AVD 目录：`~/.android/avd`
- 动画：开机后关闭
- Markor：2.16.1，SHA-256 `e88cdcced7aa3dca25e6b9c7a9bdcfad3e3988ee545be951f42bf9441b5e46bf`
- My Demo App：2.2.0 build 25，SHA-256 `318ef64bdcaff18e576d962ab1f557e0a2683b9b5210a6bb6b25cb0caeef62b4`

APK cache、运行日志、录制和仓库本地 fallback 都不会提交。标准用户级 SDK/AVD 位置让 Lynx、ActOnce 与其他仓库共用同一套 emulator。
