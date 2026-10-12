# AndroidWorld reproduction audit · October 10–12, 2026

[简体中文](REPRODUCTION-2026-10-12.zh-CN.md)

This audit re-recorded the five strict-slice tasks and continued the separate
historical 19-case set. The remaining thirteen now have successful originals;
twelve received qualified independent replay measurements; video qualification
remains blocked. Already-passed cases were not rerun during the latest repairs.
Each qualified replay was authored from immutable
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
| Broader | OpenAppTaskEval | 22.464 | 1.643 | 13.67× |
| Broader | ContactsAddContact | 78.220 | 5.287 | 14.79× |
| Broader | MarkorDeleteNote | 63.622 | 3.645 | 17.46× |
| Broader | ExpenseDeleteSingle | 43.896 | 1.995 | 22.00× |
| Broader | SystemBrightnessMax | 82.046 | 7.684 | 10.68× |
| Broader | RecipeDeleteSingleRecipe | 56.732 | 4.025 | 14.09× |
| Broader | RecipeDeleteDuplicateRecipes | 115.335 | 3.762 | 30.66× |
| Broader | SimpleCalendarDeleteOneEvent | 61.573 | 1.794 | 34.32× |
| Broader | SimpleCalendarDeleteEventsOnRelativeDay | 74.166 | 3.689 | 20.10× |
| Broader | SimpleSmsSend | 69.671 | 5.290 | 13.17× |
| Broader | CameraTakePhoto | 43.968 | 2.505 | 17.55× |
| Broader | ExpenseDeleteDuplicates | 167.344 | 4.118 | 40.64× |

All twenty-three have official reward `1/1` and zero AI fallback. **Strict slice: 5/5;
broader set: 18/19 qualified formal replays.** The latest twelve also have zero
deterministic retries and checkpoint timeouts. ExpenseAddSingle has one recovered checkpoint timeout and
one deterministic retry, both included in execution time. No broader 19/19 or
full 113-task claim is made.
macOS, iOS and Android checkout were not rerun in this audit.

The first eight originals used `gpt-6-luna`; MarkorCreateFolder,
AudioRecorderRecordAudio and ExpenseAddSingle used `gpt-6.1-sol`. The remaining
thirteen originals used the explicit `codex-6.1-sol` profile. Successful
originals are reused, not rerun after every SDK repair. The measurements span
runtime revisions (including persistent-source idle handling and anchored visual
evaluation), so the table reports per-case raw ratios, **not a same-revision
paired experiment or homogeneous aggregate speedup**. BrowserMaze original is
`6d64012`, replay is `1734c55`; its new 99.837-second recording replaces neither
the older failed recording nor historical timing artifacts.

## Exclusions and remaining coverage

- Earlier setup/original failures remain preserved. After committed environment
  repairs, all nineteen broader cases have a latest successful original; this is
  not a nineteen-case replay PASS claim. CameraTakeVideo retains its failed
  original plus one forward-scaffold original, never averaged.
- CameraTakePhoto: a previous legacy replay passed the official oracle, but its
  action-only clock excluded connection/close; no speedup is claimed from it.
  An initial modal-over-Launcher divergence did not recur after emulator restart;
  its cause remains unproven. Public initialization restored the source app
  preferences exactly, without inventing unavailable legacy permission flags.
  The fresh module guards the actual shutter glyph, not incidental preview pixels,
  and rejects the recorded transition state. Two development passes and an
  independent formal run passed all three segments and the official oracle.
- ExpenseDeleteDuplicates: all seven actions executed and official reward was
  `1`, but final checkpoint qualification failed. The first native/visual match
  took 717 ms; a second fresh match did not fit the authored 750-ms budget.
  That deadline and match count are conservative synthesis choices, not exact
  recorded literals. Aggregate capture time has no source/screenshot split;
  no shared performance cause is claimed. A fresh evidence-backed module retains
  seven raw taps and validates all six remaining names and amounts plus the visual
  final state. Its 1000-ms window and two fresh matches passed two independent
  development resets and a fresh formal run. The earlier 750-ms failure remains
  preserved; the revised window is an authored bound, not a literal source wait.
  One formal setup failure (emulator unavailable before initialization/timing)
  also remains preserved without a reward or duration; a different fresh agent
  performed the subsequent formal run.
- CameraTakeVideo: numeric system permission flags initially blocked setup;
  the reusable parser repair passed eleven tests. A fresh synthesis then
  preserved six development failures. Attempt 4 produced a new filename (official
  reward `1`) but lacked the recorded saved-thumbnail checkpoint; the official
  filename-count oracle does not prove usable media. Full twelve-action source-order
  attempts reached Home without the recorded location modal, so the subsequent
  permission action could not safely execute. No two-pass qualification or
  formal measurement; no invented recovery input. The permission difference is
  not proven to cause the thumbnail delay.
  Three further native-parity development attempts preserved this failure.
  Installed-app code and live execution establish that a preview-focus exploration
  makes Camera consume Back; excluding that transient action restores Back → Home.
  Disappearance of the focus ring alone does not prove internal idle state.
  The second recorded location request still has no live counterpart: live
  preferences mark permission dialogs seen, location is denied with `USER_FIXED`,
  and no requester activity remains. The source records the initial mutable
  permission baseline, but not post-denial preferences, flags or caller stack.
  No general fixture-restore defect was established. Creating a request, changing
  flags, or deleting the grant transition would be unsupported by this recording.

Video remains in the denominator. Its development attempts are not formal
measurements. All device writers are released; this campaign retains a concrete
source-evidence blocker and is not full-catalog coverage.

## Latest module timing and fixture provenance

The latest twelve use public `--replay-module`: the CLI owns a monotonic clock from
before native connection through execution, final screenshot/source capture and
close. Module loading and artifact writes are outside it. Reused complete original
manifests prove the recording-session duration exactly, including recorder
overhead. These are documented **non-identical scopes**, so ratios are raw
operational comparisons, not isolated AI-versus-native action costs.

Original/replay revisions: OpenApp and Contacts `9ed0a1c`/`0df0c86`;
MarkorDeleteNote `0df0c86`/`665337f`; ExpenseDeleteSingle `0df0c86`/`51fc35a`;
BrightnessMax `9ed0a1c`/`1a99712`; recipes, calendars and SMS
`0df0c86`/`1a99712`. Later permission-parser repair is `d717eda`.
Shared repairs were committed before fresh independent synthesis; their timings
must not be combined into a same-revision aggregate.

Photo original/replay revisions are `e5524ec`/`00b163f`; duplicate expenses are
`0df0c86`/`c976c94`. Their checkpoint stage timings are separately instrumented:

| Task | Native source ms | Screenshot ms | Visual comparison ms | Settle delay ms |
| --- | ---: | ---: | ---: | ---: |
| CameraTakePhoto | 691.252 | 407.720 | 68.218 | 244 |
| ExpenseDeleteDuplicates | 2183.26 | 224.85 | 86.92 | 365 |

These capture totals exclude the final CLI evidence collection and are not the
whole replay duration. Source timing may include an adjacent-checkpoint cache hit.
The native coordinate touch-parity repair `8604b87` and detached-emulator startup
repair `528b3d3` postdate these formal runs; already-passed cases were not retested
on those revisions.

Prepared fixture RNG recovery is source-attested for Markor, recipes, calendars,
SMS and duplicate expenses. Legacy originals retain explicit `legacy-uncontrolled`
provenance where unavailable, not a claim of identical hidden RNG state.
ExpenseDeleteSingle's original outer wrapper exit was not captured, though its
child exit, complete recording and official reward were verified. The obsolete
`compile-result.json` is absent; its ledger, source hashes and two-pass
qualification were independently audited instead.

## Evidence locations and persistence

Local raw artifacts are under `.cache/android-world/readme-fresh-20261010/`
and `.cache/android-world/readme-remaining-20261012/`.
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

The following paths are relative to `readme-remaining-20261012/`:

| Task | Local formal directory | Evaluation SHA-256 |
| --- | --- | --- |
| Open app | `formal-open-app-module` | `ad9e9fcc1a4ecd4e5fc4737c5528e8aaceb4f041fdbe7e679ceed2de2492ca3f` |
| Contact | `formal-contacts-module` | `ae32b69d8ba493e057513690959704a6036c7ff1502ec19935807c9399788bae` |
| Delete note | `formal-markor-delete-module` | `9dcb934cd842069cfa0d96f766676086c6f47de55839c46176a88f725c192c63` |
| Delete expense | `formal-expense-delete-module` | `382976c44dfc5bef95474dfa4aa91b922f66214e65246952bc54c30a64db2084` |
| Brightness maximum | `formal-brightness-max-module` | `59db270f36503c1bdc045b0a81612985edf9386a84213bf58734cb810c0f219a` |
| Delete recipe | `formal-recipe-single-module` | `ad60be5c34a8abf724ef298982e363e14070512b5f91282b25adf1f9951c5d93` |
| Duplicate recipes | `formal-recipe-duplicates-module` | `2b3d43af6bacb71effd960a57d0fa238ff578701d67dd141a0fdf04bd3719676` |
| Delete event | `formal-calendar-one-module` | `4595b30dbf671d85e79cc2e512641f0f7515704766c47e6ed1fca1fb6d7daffc` |
| Relative-day events | `formal-calendar-relative-module` | `faae89b89cd8b2ff8c91c543a22769616f2e4dec867a471e7fbd3ef09b1fde0c` |
| SMS | `formal-sms-module` | `966c36492fc918d38a6bcb1cc6cc02bdfa8848c7523dc3e94cfe784887d8d423` |
| Photo | `formal-camera-photo-module-v4` | `d354c9e26bf54ebeec3c64c73b44512f9154b7fcd5691085935d520254393c92` |
| Duplicate expenses | `formal-expense-duplicates-module-v3-forward` | `c4ee6efcab3365fa41135cd8426e4ed40737f1b6e11b92a79e2309753bd6e80c` |

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
