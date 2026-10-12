# AndroidWorld reproduction audit · October 10–12, 2026

This audit re-recorded the five strict-slice tasks and began the separate
historical 19-case set. Each qualified replay was authored from immutable
recording evidence by an agent, passed two consecutive fresh-fixture development
validations, then received one independent zero-context replay-only measurement.
Official AndroidWorld reward must be exactly `1` for original and replay.

## Verified replays

| Set | Task | Original seconds | Replay seconds | Raw ratio |
| --- | --- | ---: | ---: | ---: |
| Strict | ClockStopWatchPausedVerify | 24.071 | 7.896 | 3.05× |
| Strict | ClockStopWatchRunning | 43.707 | 6.302 | 6.94× |
| Strict | ClockTimerEntry | 141.606 | 5.711 | 24.80× |
| Strict | BrowserMaze | 99.837 | 8.255 | 12.09× |
| Strict | ExpenseAddMultiple | 323.724 | 23.719 | 13.65× |
| Broader | SystemBrightnessMin | 290.048 | 6.892 | 42.09× |
| Broader | SystemBluetoothTurnOff | 48.492 | 4.846 | 10.01× |
| Broader | SystemBluetoothTurnOn | 61.122 | 2.513 | 24.32× |
| Broader | MarkorCreateFolder | 44.767 | 3.674 | 12.18× |
| Broader | AudioRecorderRecordAudio | 80.649 | 6.686 | 12.06× |
| Broader | ExpenseAddSingle | 84.725 | 7.509 | 11.28× |

All eleven have official reward `1/1` and zero AI fallback. **Strict slice: 5/5;
broader set: 6/19.** ExpenseAddSingle has one recovered checkpoint timeout and
one deterministic retry, both included in execution time. No broader 19/19 or
full 113-task claim is made.
macOS, iOS and Android checkout were not rerun in this audit.

The first eight originals used `gpt-6-luna`; MarkorCreateFolder,
AudioRecorderRecordAudio and ExpenseAddSingle used `gpt-6.1-sol`. Pending originals use the
explicit `codex-6.1-sol` profile. Successful
originals are reused, not rerun after every SDK repair. The measurements span
runtime revisions (including persistent-source idle handling and anchored visual
evaluation), so the table reports per-case raw ratios, **not a same-revision
paired experiment or homogeneous aggregate speedup**. BrowserMaze original is
`6d64012`, replay is `1734c55`; its new 99.837-second recording replaces neither
the older failed recording nor historical timing artifacts.

## Exclusions and remaining coverage

- SystemBrightnessMax: complete original, official reward `0`; no synthesis or replay.
- OpenAppTaskEval: fixture preparation failed before recording/timing; no reward or replay.
- CameraTakePhoto and ContactsAddContact (`gpt-6.1-sol`): fixture preparation
  failed before recording/timing; no reward or duration, no retry.
- Nine broader originals remain pending. CameraTakeVideo is among them,
  temporarily deferred while the shared camera preparation is unavailable; it is
  not labeled an executed failure. Continuing runs remain in the campaign manifest;
  failures are retained and skipped, not removed from the 19-case denominator.

## Evidence locations and persistence

Local raw artifacts are under `.cache/android-world/readme-fresh-20261010/`.
They are ignored local outputs, **not bundled with this report**. A clean clone
does not contain the exact recorded inputs or fixtures; this report preserves
the results and audit hashes, not a self-contained reproduction package.
Use the public harness and synthesis Skill to generate new evidence after setup.

Each path below contains `evaluation.json`, original identity/parameters, runtime
results, and independent provenance. SHA-256 values refer to `evaluation.json`.

| Task | Local formal directory | Evaluation SHA-256 |
| --- | --- | --- |
| Paused stopwatch | `formal-v2/cases/008-clock-stop-watch-paused-verify/sample-1` | `8b2b815bd330f4884a469553ea2d39e0d2b71887da33ee5381bbe74d7c7b0937` |
| Running stopwatch | `formal-v2/cases/009-clock-stop-watch-running/sample-1` | `af375a4021dce0b2b1ff2aa3477b6114240285e8eb411dda36b36bc761383eac` |
| Timer | `formal-timer-20261012` | `e28edb2c83a930bc9d4e2a169e78010a57c67851b78ceee988dfdda5e77b3bda` |
| BrowserMaze | `formal-browser-anchored-20261012` | `cf9a1b7fe9f2c0aa0916cf19ea297ae410686d152c8975ae74e30b0c4c233286` |
| Expense | `formal-expense-20261012` | `793a46c8e22941b57b699e428847b8b017bdea182958f0aa7fd7ea7a5c53add5` |
| Brightness minimum | `formal-broader3-20261012/cases/081-system-brightness-min/sample-1` | `d42a345466c3dea3e8cbf7edc746eb6bc64be46db9736fc94173eb52df3730fd` |
| Bluetooth off | `formal-broader3-20261012/cases/075-system-bluetooth-turn-off/sample-1` | `6f2a8e4908b09c60d9aad611f55faf05524b5f992fbc762c89bc410d5806c9ea` |
| Bluetooth on | `formal-bluetooth-on-20261012` | `530e4f540d7af988c6527ac19fcc97b625db0c1330a6baff518908d2c5773af0` |
| Markor folder | `formal-markor-folder-20261012` | `b532e40d0c082298086a454d0b7f71fd6695e6d101520c4131b2547f37d8ebc5` |
| Audio recording | `formal-audio-20261012` | `b6d359733a975be44683d33803d982b74ca27ae933d7d68d9e8c30a4c1bcf050` |
| Single expense | `formal-expense-single-20261012` | `0c82aa5bd87401d2f2ab77770b0773e13ec48a5f980c93d282646805dd80228d` |

BrowserMaze's visual checkpoints retain the recorded X-cell facts and pixel
thresholds while a uniquely evidenced native container anchors translation of
the screenshot crop. This localizes pixels; it does not replace the visual
oracle with the native `X` label. Its formal run captured checkpoints in 3.503
seconds and spent 3.416 seconds settling. Separate screenshot/source durations
were unavailable and are not invented.

Audio retains the exact recorded 3000-ms media dwell. Its generated default
filename and model-latency-inflated duration label are incidental, not requested
values. All seven actions and fourteen native boundaries must complete; the saved
playable state excludes the pending-name dialog, and official metadata validation
proves a new/changed nonempty clip. Existing media was not deleted to force a
literal filename. The legacy microphone-denied fixture is restored from audited
recorded evidence by the public CLI, outside measured execution. Formal checkpoint
capture took 1.313 seconds and actual settling 1.132 seconds; no separate native/
screenshot capture durations are claimed. Original revision `df485aa`, formal
replay revision `10ec13c`.

ExpenseAddSingle preserves the requested name, amount, category and note. The
Clothes category is validated visually because the recorded native `selected`
field does not identify selection. Its unique native selector retains a bounded
original-coordinate retry gated only by that action's immediate postcondition.
The formal run needed one such retry after a checkpoint timeout; it still passed
all seven segments and the official database oracle, with zero AI fallback.
Capture took 2.271 seconds, actual settling 0.680 seconds, and the retry action
0.026 seconds. No screenshot/native capture split is available. Original revision
`10ec13c`, replay revision `223f69d`. The raw entry's development-purpose label is
preserved; independent formal isolation and one-run provenance are recorded in
`formal-audit.json`, not inferred from that stale label.
