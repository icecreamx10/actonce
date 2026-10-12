# `@byted-lynx/actonce-android`

面向 ActOnce 生成脚本的确定性 Android replay runtime。

### 显式逻辑应用名

Primitive/plan 必须保留录制的原始 `Launch` URI。若 URI 是逻辑名称而非包名，
调用者必须根据原始运行证据提供映射：

```ts
await executeAndroidPlan(plan, {
  session: { appNameMapping: { dialer: "com.google.android.dialer" } },
});
```

`AndroidSession.connect` 与 `runAndroidScripts` 的 `session` 配置也支持该选项。
先精确匹配，再去除首尾空白、合并连续空白并转为小写匹配。连接设备前验证并复制
整个映射：空名称、非法包名、访问器和规范化后重名均拒绝（即使目标包名相同）。
直接包名保持原样，映射不能重定向包名；未知别名不会模糊匹配、枚举应用或调用 AI。
示例不是内置别名，实际包名必须由原始运行证据确定。

它连接一个明确的 ADB device，把已完成的 Midscene Android 动作机械降低为固定 primitive，并用 Android UI tree 与截图 checkpoint 驱动 replay。相邻 segment 之间如果没有动作发生，上一段成功的 postcondition 会直接作为下一段 precondition 的同一份观察；任何 primitive 执行前都会使缓存失效，因此不会削弱状态边界。

读取 source 时关闭 UIAutomator2 内部的隐式 idle 等待，但每次仍刷新 accessibility/window
缓存。新鲜快照可能处于切换中，所以必须保留有界 checkpoint 轮询和稳定性检查，不能
假设首次读取已稳定。不会为了掩盖读取慢而扩大期限；`captureDurationMs` 与
`settleDelayMs` 继续分开记录。

每次检查还在 `actual.captureTiming` 中报告单调时钟分项：
`sourceDurationMs`、`screenshotDurationMs`、`visualComparisonDurationMs`。
未尝试的阶段省略；source 读取可能使用相邻观察缓存。比较耗时包含参考图片加载和
像素处理，不等于设备截图耗时。这些诊断不改变期限、新鲜度或 checkpoint 语义。

坐标 tap/swipe 使用 Android 原生 `input swipe` 注入；UIAutomator2 仍负责常驻观察
与唯一节点 click。`device.tap(point, durationMs?)` 默认明确按住 150 ms，swipe
保留录制时长（缺省 300 ms）。中性录制中的显式 tap 时长会原样降低并执行。
缺省按住时间保留已固定原始设备的隐式语义，不再用零时长 W3C down/up；
注入一致本身不证明 fixture 相同或 UI 确实消费了动作。

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

生成代码必须调用 `replayAndroidPrimitive`，不能内联 ADB 命令。坐标使用录制的逻辑坐标；原生后端根据有效 `wm size` 和密度（优先显式 override）计算取整后的逻辑视口，再按各轴的物理尺寸 / 逻辑尺寸分别投影。几何信息在连接时缓存，由 `size()` 刷新，不在每次动作时读取；无效几何信息会直接报错。显示配置变化后需调用 `size()`，此机制不提供自动旋转跟踪。原生 selector 匹配和点击保持不变；导出的原生树 bounds 仍按密度转换，不能作为替代的坐标投影契约。

`sleep(timeMs)` 保留 Agent 明确选择的录制停留，例如媒体采集期间的等待。Primitive
lowering 不再静默删除 `Sleep`；必要等待还是可替换的有界状态等待由 Agent 判断，
不是脚本决定。保留的停留时长必须与录制一致，为 0–2147483647 毫秒整数（拒绝定时器
溢出或隐式裁短），会失效观察缓存并计入 replay 执行时间；前后 checkpoint 仍必须保留。
