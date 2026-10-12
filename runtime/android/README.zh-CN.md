# `@byted-lynx/actonce-android`

面向 ActOnce 生成脚本的确定性 Android replay runtime。

它连接一个明确的 ADB device，把已完成的 Midscene Android 动作机械降低为固定 primitive，并用 Android UI tree 与截图 checkpoint 驱动 replay。相邻 segment 之间如果没有动作发生，上一段成功的 postcondition 会直接作为下一段 precondition 的同一份观察；任何 primitive 执行前都会使缓存失效，因此不会削弱状态边界。

读取 source 时关闭 UIAutomator2 内部的隐式 idle 等待，但每次仍刷新 accessibility/window
缓存。新鲜快照可能处于切换中，所以必须保留有界 checkpoint 轮询和稳定性检查，不能
假设首次读取已稳定。不会为了掩盖读取慢而扩大期限；`captureDurationMs` 与
`settleDelayMs` 继续分开记录。

截图 checkpoint 可在明确的 `visual.region` 上添加
`visual.anchor: { selector, referenceSourcePath }`。运行时要求录制与当前原生树中的
锚点均唯一，只按物理像素位移平移当前裁剪区域；缺失、多匹配、隐藏、禁用、尺寸变化
或无效区域均拒绝对齐。不搜索像素、不缩放内容、不做 OCR、不放宽阈值，并在
`actual.visual` 记录前后裁剪区域。Agent 必须从该动作自己的证据证明锚点与视觉事实
属于同一刚性内容容器，且对比能拒绝最近的负例。锚点只负责定位截图，不以原生标签
代替截图正确性。原生树与截图仍是有界观察而非原子快照，需要正常的有界稳定性检查。

```bash
actonce-android doctor --serial emulator-5554
actonce-android compile-primitives recordings/<id> --output replay.ts
actonce-android run replay.ts --serial emulator-5554
```

生成代码必须调用 `replayAndroidPrimitive`，不能内联 ADB 命令。坐标使用 Midscene 录制的逻辑坐标，并由 `AndroidDevice` 转换到物理显示坐标。
