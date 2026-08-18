# AndroidWorld ARK 确定性回放结果（2026-08-18）

本文记录 2026-08-18 使用 ARK 模型运行的十一个完整 AndroidWorld case。十一个 case
均完成以下完整链路：

1. ARK 驱动 Midscene 执行 original，并生成录制；
2. 只基于官方 validator 已通过的录制编译 replay；
3. ActOnce Android runtime 执行确定性 replay；
4. AndroidWorld 官方 `task.is_successful` validator 再次验证 replay；
5. original 和 replay 的官方 reward 均为 `1` 后才计入下表。

## 运行环境

- 日期：2026-08-18（Asia/Shanghai）
- 仓库基线：`137a8423dd58580c85c8084a954e65cfe8855311`
- AndroidWorld commit：`3e50888527ef9f29b9157ecd537e408008bb1c85`
- 设备：Pixel 6 / Android API 33 emulator（`emulator-5554`）
- Model profile：`ark-doubao`
- Provider：`volcengine-ark`
- Model：`doubao-seed-2-1-pro-260628`
- Model family：`doubao-seed`
- 样本数：每个 case 1 个 sample，串行运行
- 正确性门禁：`official AndroidWorld task.is_successful reward == 1.0`
- Replay 策略：`deterministic`，AI fallback 禁用

API key 仅在运行时从本机环境读取，没有写入仓库或结果文档。

## 汇总结果

| Task | Task ID | Original reward | Replay reward | Original | Replay | 加速比 | 耗时下降 | Replay 文件 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `SystemBrightnessMin` | 81 | 1 | 1 | 68.724 秒 | 8.279 秒 | 8.30x | 87.95% | [`system-brightness-min-replay.ts`](./system-brightness-min-replay.ts) |
| `SystemBluetoothTurnOff` | 75 | 1 | 1 | 43.875 秒 | 7.982 秒 | 5.50x | 81.81% | [`system-bluetooth-turn-off-replay.ts`](./system-bluetooth-turn-off-replay.ts) |
| `SystemBluetoothTurnOn` | 77 | 1 | 1 | 85.337 秒 | 7.188 秒 | 11.87x | 91.58% | [`system-bluetooth-turn-on-replay.ts`](./system-bluetooth-turn-on-replay.ts) |
| `SystemBrightnessMax` | 79 | 1 | 1 | 98.969 秒 | 8.418 秒 | 11.76x | 91.49% | [`system-brightness-max-replay.ts`](./system-brightness-max-replay.ts) |
| `OpenAppTaskEval` | 38 | 1 | 1 | 22.795 秒 | 4.137 秒 | 5.51x | 81.85% | [`open-app-clock-replay.ts`](./open-app-clock-replay.ts) |
| `CameraTakePhoto` | 6 | 1 | 1 | 21.369 秒 | 12.969 秒 | 1.65x | 39.31% | [`camera-take-photo-replay.ts`](./camera-take-photo-replay.ts) |
| `CameraTakeVideo` | 7 | 1 | 1 | 270.349 秒 | 19.755 秒 | 13.69x | 92.69% | [`camera-take-video-replay.ts`](./camera-take-video-replay.ts) |
| `AudioRecorderRecordAudio` | 1 | 1 | 1 | 65.166 秒 | 10.890 秒 | 5.98x | 83.29% | [`audio-recorder-record-audio-replay.ts`](./audio-recorder-record-audio-replay.ts) |
| `ContactsAddContact` | 11 | 1 | 1 | 143.907 秒 | 13.726 秒 | 10.48x | 90.46% | [`contacts-add-contact-replay.ts`](./contacts-add-contact-replay.ts) |
| `MarkorCreateFolder` | 26 | 1 | 1 | 108.976 秒 | 13.073 秒 | 8.34x | 88.00% | [`markor-create-folder-replay.ts`](./markor-create-folder-replay.ts) |
| `MarkorDeleteNote` | 32 | 1 | 1 | 167.187 秒 | 6.532 秒 | 25.59x | 96.09% | [`markor-delete-note-replay.ts`](./markor-delete-note-replay.ts) |
| **可比合计** | — | **11/11** | **11/11** | **1,096.654 秒** | **112.948 秒** | **9.71x** | **89.70%** | — |

合计加速比按总耗时计算，即 `1096.654 / 112.948 = 9.71x`，不是十一个 case
加速比的算术平均值。计时范围为 harness 记录的 agent/replay 执行耗时；官方
initializer、validator 和 app setup 不计入执行边界。

## Replay 诊断数据

| Task | 策略 | Fallback 次数 | Fallback 耗时 | Checkpoint poll | Checkpoint 捕获 | Settle delay | Checkpoint wait | Timeout |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `SystemBrightnessMin` | deterministic | 0 | 0 ms | 1 | 2,376 ms | 102 ms | 2,478 ms | 0 |
| `SystemBluetoothTurnOff` | deterministic | 0 | 0 ms | 3 | 3,557 ms | 303 ms | 3,860 ms | 0 |
| `SystemBluetoothTurnOn` | deterministic | 0 | 0 ms | 3 | 3,875 ms | 305 ms | 4,180 ms | 0 |
| `SystemBrightnessMax` | deterministic | 0 | 0 ms | 1 | 2,161 ms | 105 ms | 2,266 ms | 0 |
| `OpenAppTaskEval` | deterministic | 0 | 0 ms | 0 | 1,793 ms | 0 ms | 1,793 ms | 0 |
| `CameraTakePhoto` | deterministic | 0 | 0 ms | 1 | 5,355 ms | 102 ms | 5,457 ms | 0 |
| `CameraTakeVideo` | deterministic | 0 | 0 ms | 1 | 6,177 ms | 103 ms | 6,280 ms | 0 |
| `AudioRecorderRecordAudio` | deterministic | 0 | 0 ms | 1 | 2,747 ms | 100 ms | 2,847 ms | 0 |
| `ContactsAddContact` | deterministic | 0 | 0 ms | 2 | 3,771 ms | 203 ms | 3,974 ms | 0 |
| `MarkorCreateFolder` | deterministic | 0 | 0 ms | 1 | 4,685 ms | 101 ms | 4,786 ms | 0 |
| `MarkorDeleteNote` | deterministic | 0 | 0 ms | 0 | 1,015 ms | 0 ms | 1,015 ms | 0 |

十一个 replay 的 `fallbackCount` 和 `checkpointTimeoutCount` 均为 `0`。这表示
运行过程中没有回退到 AI，也没有 checkpoint 超时；耗时中包含原生 Android
accessibility checkpoint 的捕获和等待。

## Replay 文件与确定性流程

### SystemBrightnessMin

Replay：[`system-brightness-min-replay.ts`](./system-brightness-min-replay.ts)

- 初始状态：AndroidWorld initializer 将亮度设置为最大值，Settings 已在前台。
- 固定路径：`Settings -> Display -> Brightness level`。
- 固定动作：将 SystemUI slider 向最左侧滑动并钳制到最小值。
- Replay postcondition：slider source 包含 `"text":"0.0"`。
- 官方 oracle：`settings get system screen_brightness == 1`。

### SystemBluetoothTurnOff

Replay：[`system-bluetooth-turn-off-replay.ts`](./system-bluetooth-turn-off-replay.ts)

- 初始状态：AndroidWorld initializer 打开 Bluetooth，Settings 已在前台。
- 固定路径：`Settings -> Connected devices -> Connection preferences -> Bluetooth`。
- 固定动作：定位 `android:id/switch_widget`，确认 `checked=true` 后点击。
- Replay postcondition：同一 switch 变为 `checked=false`。
- 官方 oracle：`settings get global bluetooth_on == 0`。

### SystemBluetoothTurnOn

Replay：[`system-bluetooth-turn-on-replay.ts`](./system-bluetooth-turn-on-replay.ts)

- 初始状态：AndroidWorld initializer 关闭 Bluetooth，Settings 已在前台。
- 固定路径：`Settings -> Connected devices -> Pair new device`。
- 固定动作：点击 `Pair new device`，利用系统配对页的固定副作用打开 Bluetooth。
- Replay postcondition：页面出现 `Available devices`。
- 官方 oracle：`settings get global bluetooth_on == 1`。

### SystemBrightnessMax

Replay：[`system-brightness-max-replay.ts`](./system-brightness-max-replay.ts)

- 初始状态：AndroidWorld initializer 将亮度设置为最小值，Settings 已在前台。
- 固定路径：`Settings -> Display -> Brightness level`。
- 固定动作：将 SystemUI slider 向最右侧滑动并钳制到最大值。
- Replay postcondition：slider source 包含 `"text":"65535.0"`。
- 官方 oracle：`settings get system screen_brightness == 255`。

### OpenAppTaskEval

Replay：[`open-app-clock-replay.ts`](./open-app-clock-replay.ts)

- 参数：本次 seed 生成 `app_name=clock`。
- 固定动作：通过 Android intent 启动 Clock app。
- Replay postcondition：前台 package 与 Clock activity 匹配。
- 官方 oracle：AndroidWorld `OpenAppTaskEval.is_successful` 返回 reward `1`。

### CameraTakePhoto

Replay：[`camera-take-photo-replay.ts`](./camera-take-photo-replay.ts)

- 固定动作：兼容可选的首次 location prompt，然后点击 `shutter_button`。
- Replay postcondition：相机缩略图进入已拍摄状态。
- 官方 oracle：相机目录新增一张 photo，reward `1`。

### CameraTakeVideo

Replay：[`camera-take-video-replay.ts`](./camera-take-video-replay.ts)

- 固定动作：打开 mode list，选择 `Video`，录制约 2 秒后停止。
- Replay postcondition：`rounded_thumbnail_view` 出现，表示视频已保存。
- 官方 oracle：相机目录新增一个 video，reward `1`。

### AudioRecorderRecordAudio

Replay：[`audio-recorder-record-audio-replay.ts`](./audio-recorder-record-audio-replay.ts)

- 固定动作：兼容可选 warning dialog，录制约 2 秒，停止并保存。
- Replay postcondition：录音列表出现保存后的录音。
- 官方 oracle：恰好新增或改变一个非空录音文件，reward `1`。

### ContactsAddContact

Replay：[`contacts-add-contact-replay.ts`](./contacts-add-contact-replay.ts)

- 参数：`name=Eva Hernandez`，`number=+16378203168`。
- 固定动作：处理可选权限页，打开联系人编辑器，填写姓名和号码并保存。
- Replay postcondition：详情页出现姓名和格式化后的完整号码。
- 官方 oracle：联系人数据库出现匹配姓名和号码的 contact，reward `1`。

### MarkorCreateFolder

Replay：[`markor-create-folder-replay.ts`](./markor-create-folder-replay.ts)

- 参数：`folder_name=folder_20260818_171218`。
- 固定动作：点击新增按钮，替换默认名称并选择 `FOLDER`。
- Replay postcondition：文件列表出现对应 `Folder` accessibility node。
- 官方 oracle：Markor 工作目录中出现指定文件夹，reward `1`。

### MarkorDeleteNote

Replay：[`markor-delete-note-replay.ts`](./markor-delete-note-replay.ts)

- 参数：`file_name=dHv9_good_unicorn`。
- 固定动作：长按精确匹配的目标文件，点击删除按钮并确认。
- Replay postcondition：目标文件和确认弹窗均从 accessibility state 消失。
- 官方 oracle：目标文件从 Markor 工作目录删除，reward `1`。

## 本地结果产物

本轮原始产物保存在以下本地目录（`.cache` 不进入 Git）：

```text
.cache/android-world/formal-ark-four-20260818/cases/
├── 001-system-brightness-min/sample-1/
├── 002-system-bluetooth-turn-off/sample-1/
├── 003-system-bluetooth-turn-on/sample-1/
└── 004-system-brightness-max/sample-1/

.cache/android-world/ark-next-20-20260818/cases/
├── 001-audio-recorder-record-audio/sample-1/
├── 006-camera-take-photo/sample-1/
├── 007-camera-take-video/sample-1/
├── 011-contacts-add-contact/sample-1/
├── 026-markor-create-folder/sample-1/
├── 032-markor-delete-note/sample-1/
└── 038-open-app-task-eval/sample-1/
```

每个 `sample-1` 目录包含：

- `original/result.json`：original 状态、模型 provenance、耗时和官方 reward；
- `original/events.ndjson`：用于编译 replay 的录制事件及 checkpoint 证据；
- `replay/result.json`：ActOnce replay runtime 原始结果；
- `replay/benchmark-result.json`：replay 耗时、诊断数据和官方 reward；
- `evaluation.json`：original/replay 正确性与性能对比。

## 未计入正式四个结果的尝试

### SystemWifiTurnOff

该 case 未计入。AndroidWorld env 在 validator 重连过程中会执行
`attempt_enable_networking()`，重新运行 `svc wifi enable`，使 `wifi_on` 在 validator
读取前回到 `1`。设备上直接关闭 Wi-Fi 后状态可以保持为 `0`，但 env 重连会将其
改回 `1`，因此当前 harness 中无法形成可判分的关闭结果。

### SystemCopyToClipboard

ARK original 已通过官方 validator（reward `1`），但没有计入上述四个完整结果。
该 app 的 accessibility tree 是静态说明页；录制中的剪贴板内容由 yadb IME 输入、
系统文本选区和复制浮层完成，source 中缺少可用于确定性 replay checkpoint 的稳定
输入控件与状态锚点。因此本轮没有从该录制发布 replay，第四个完整 case 改为
`SystemBrightnessMax`。

### ContactsNewContactDraft

ARK original 已通过官方 validator（reward `1`，81.297 秒），但 replay 未计入正式
结果。联系人标签使用 Android `Spinner` popup：弹层肉眼可见，却不进入 uiautomator
tree；当前 runtime 的点注入与录制规范化坐标在该弹层上无法稳定选择 `Work`，多次
fresh replay 最终仍为 `Mobile`，官方 reward `0`。因此该 case 记录为
`original PASS / replay blocked`，不进入性能汇总。对应实验文件为
[`contacts-new-contact-draft-replay.ts`](./contacts-new-contact-draft-replay.ts)。

### MarkorDeleteNewestNote

ARK original 未通过官方 validator（40.881 秒，reward `0`），因此没有编译 replay，
也不进入性能汇总。录制执行了长按 `edited_fierce_goat.txt`、点击删除并确认，但
AndroidWorld 的文件系统 oracle 未认可最终状态。

## 结论

当前十一个完整 case 均满足相同的正确性门禁：original 与 replay 都获得 AndroidWorld
官方 reward `1`。确定性 replay 在零 AI fallback 下将总执行时间从 1,096.654 秒降至
112.948 秒，总体加速 9.71 倍。结果支持当前 JIT 方向：把已经录制并可由稳定 state/
checkpoint 门控的死流程编译为固定 replay，而仍需开放判断的步骤继续交给 agent。
