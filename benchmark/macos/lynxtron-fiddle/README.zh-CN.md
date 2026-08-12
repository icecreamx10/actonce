# Lynxtron Fiddle macOS Benchmark

这个 benchmark 将应用 fixture、自然语言测试用例，以及 Midscene + ActOnce
运行器放在同一个目录，用于复现一个真实桌面任务：

> 在 Lynxtron Fiddle 左上角编辑器中引入 JavaScript 语法错误，确认出现红色
> 波浪线，将鼠标悬停在波浪线上，并确认诊断提示为 `Expression expected.`；
> 最后撤销修改且不保存。

机器可读的唯一用例来源是 [`testcase.json`](testcase.json)。运行器不会再内嵌
另一份 prompt；准备、操作、观察、期望结果和清理步骤全部从该文件读取。

## 复现

要求：

- Apple Silicon Mac（`darwin/arm64`），Node.js 22 或更高版本；
- 为终端或宿主应用授予辅助功能与屏幕录制权限；
- 为 `/usr/bin/osascript` 授予辅助功能权限；运行器会通过 System Events 激活
  准确的 Lynxtron PID；
- 仓库 `.env` 中已有可工作的 Midscene 模型配置；
- 只启用一个显示器。Midscene 1.10.10 在多显示器环境下不能稳定定位该 fixture；
- 运行期间不要同时操作鼠标、键盘、窗口或剪贴板。
- 从普通桌面运行，不要停留在其他应用的全屏 Space 中。

安装 benchmark 自己锁定版本的 Lynxtron runtime 并执行用例：

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

可通过 `ACTONCE_DISPLAY_ID` 指定 Midscene display（默认 `0`），或通过
`ACTONCE_BENCHMARK_OUTPUT_DIR` 指定明确的产物目录。

运行器只会启动并终止自己的 Lynxtron 进程组：先按准确 PID 激活 fixture，再执行自然
语言用例，最后执行两次 Undo、关闭 recorder 并结束进程。整个过程不会保存
编辑内容。激活和 readiness 检查发生在正式录制前；测试操作、观察与清理会被录制。

## 产物

每次运行会在 `artifacts/benchmarks/lynxtron-fiddle/<run-id>/` 写入完整目录：

```text
result.json                 统一的成功/失败结果与来源信息
lynxtron.log                捕获的 fixture host 输出
midscene-report.html        Midscene 生成的报告
recording/actonce/
  manifest.json             录制元数据与所选 display
  events.ndjson             按序排列的 Midscene、输入、AX 与 checkpoint 事件
  artifacts/                截图、AX 快照与各 source 的辅助产物
```

生成的依赖、解压后的 fixture 和运行产物都不会提交到 Git。

## 固定版本的 fixture

[`fixture/lynxtron-fiddle-desktop-arm64.tgz`](fixture/lynxtron-fiddle-desktop-arm64.tgz)
是从 [`fixture/provenance.json`](fixture/provenance.json) 中指定的上游 commit
构建并验证过的桌面 bundle。每次运行都会校验其 SHA-256。官方 Lynxtron host
下载也固定了版本、URL 与 SHA-256。由于其上游 npm postinstall 在解压 macOS
framework 时可能挂起，`prepare.ts` 会禁用 lifecycle script 安装精确的 npm 依赖图，
再自行下载、校验并解压官方 host。archive、来源记录、lockfile、testcase 与 runner
共同定义了可复现输入。

若要有意升级 fixture，应重新构建上游 `lynxtron-go/dist/desktop`，生成新 archive，
并同步更新 `fixture/provenance.json` 中的 commit 与 checksum。接受变更前需运行仓库
测试；fixture contract test 会拒绝 checksum 或结构发生意外漂移的 archive。

[English](README.md)
