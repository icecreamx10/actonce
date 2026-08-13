# `@byted-lynx/actonce-android`

面向 ActOnce 生成脚本的确定性 Android replay runtime。

它连接一个明确的 ADB device，把已完成的 Midscene Android 动作机械降低为固定 primitive，并用 Android UI tree 与截图 checkpoint 驱动 replay。相邻 segment 之间如果没有动作发生，上一段成功的 postcondition 会直接作为下一段 precondition 的同一份观察；任何 primitive 执行前都会使缓存失效，因此不会削弱状态边界。

```bash
actonce-android doctor --serial emulator-5554
actonce-android compile-primitives recordings/<id> --output replay.ts
actonce-android run replay.ts --serial emulator-5554
```

生成代码必须调用 `replayAndroidPrimitive`，不能内联 ADB 命令。坐标使用 Midscene 录制的逻辑坐标，并由 `AndroidDevice` 转换到物理显示坐标。
