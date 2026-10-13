# AndroidWorld video audit · October 13, 2026

[简体中文](REPRODUCTION-2026-10-13.zh-CN.md)

CameraTakeVideo now has one qualified independent formal replay. Together with
the [October 10–12 audit](REPRODUCTION-2026-10-12.md), this completes the broader
19/19 set; the strict slice remains 5/5. Other passed cases were not rerun.
These 24 audited cases span revisions and fixture policies, not a homogeneous
suite run or the complete 113-task target.

## Correctness and timing

| Original | Replay | Raw ratio | Official reward | Runtime |
| ---: | ---: | ---: | --- | --- |
| 125.921 s | 12.351938125 s | 10.1944× | 1 / 1 | 9 matched segments; retries, fallback and timeouts 0 |

Both phases ran once on API 33 `emulator-5554`, seed 70001, revision `f836fe9`,
each in a separate context-free agent. Original used `codex-6.1-sol`; replay
was model-free. The original recording has 210 events and complete integrity.
Replay passed the official evaluator and the recorded saved-thumbnail gate.
Its final screenshot was inspected; playback/codec validation was not added,
so this result is not a claim of exhaustive video-quality validation.

Original time is the full recording session, including recorder overhead.
Replay uses the public `--replay-module` clock including native connection,
actions, checkpoints, final evidence and close. The ratio is a raw operational
comparison of documented, non-identical scopes, not isolated action cost.

| Replay checkpoint stage | Milliseconds |
| --- | ---: |
| Native source capture | 3307.485 |
| Screenshot capture | 1437.183 |
| Visual comparison | 120.012 |
| Explicit settle delay | 4666 |

Aggregate checkpoint capture is 4867 ms (rounded event timings); these totals
exclude final CLI evidence collection. All 64 checked samples have stage timing.
Setup and official validation are outside execution time. Formal setup used one
attempt, no startup failures; individual setup wall times are not instrumented.

## Stable setup, not replay recovery

Committed public setup now freezes scoped permissions and startup state
(`3c92b89`), drawn-window readiness and bounded pre-measurement fixture recovery
(`bd0472b`), and Camera media-publication normalization (`f836fe9`).
Video defaults to pregranting declared runtime permissions. Other tasks retain
their existing policy. `task-state/start-environment.json` schema 2 is verified
for original/replay parity; legacy video recordings are not retroactively upgraded.

After official initialization clears Camera's Pictures/Movies outputs, setup
verifies those namespaces and removes only orphan provider rows there. Recognized
pending Camera outputs are quarantined recoverably; system thumbnail caches and
unrelated outputs are preserved. Formal replay removed one orphan Movies row,
quarantined no files. Earlier setup quarantined two pending files. No global
permission or MediaProvider database reset is used.

Earlier evidence proved a saved file and its MediaStore metadata disagreed;
the stale-index explanation was inferred, not proven to explain every failure.
An earlier APK startup crash was observed, but the cause of its zero-size measure
input remains unproven. The successful new baseline is not a universal fix claim.

## Synthesis qualification and preservation

A separate fresh agent authored all nine segments from one isolated successful
attempt. Six development failures were preserved, including a read-only staging
error and evidence-backed readiness/visual/deadline repairs. Attempts 7 and 8
then passed runtime and official reward on independently initialized fixtures
with the identical final plan, zero retry/fallback. A different fresh agent
performed the sole formal replay without changes.

Older recordings (including 121.921-second schema-1 and 170.473-second legacy
originals), derived candidates and failures remain preserved. They are not
averaged or compared across baseline policies. A premature read-only evaluation
before the formal validator completed reported missing replay; it is preserved
separately. Final evaluation passes; no extra device execution was performed.

## Evidence identities

Local root: `.cache/android-world/video-pregranted-20261013/`.
New source: `published-sample-1/original`; synthesis:
`published-sample-1/synthesized-v1`; formal: `published-sample-1/formal-replay`.
These ignored raw artifacts are not bundled with a clean clone. The public
harness and synthesis Skill can generate new evidence; this audit is not a
self-contained exact reproduction package.

| Artifact | SHA-256 |
| --- | --- |
| Start-environment contract | `29ba8952d3d858e3601b77156ca8023c6b4ab9cc928a2996278b30257c6bc3be` |
| Original manifest | `5774abb503d45cf9f3c09f58eb0e295421f342c22927cf26fe662d038f211305` |
| Original result | `c1bf574a44b795e6ac2c3ed113949a5417c4bfef3ccbec5aef92dce97f9c7cd5` |
| Replay module | `299e3db5783396fd4150824c7af1978e6bd8a75fe4219e73b2bb2bada3eb3553` |
| Replay plan | `edb804f67fb8aa8cf796a8d1284f999fc3cf9d7355f653bd0cd97d58f0feb8f1` |
| Formal replay result | `7aebf75ba63615373b017ba0ca7e59ad99506795befe6ae57f8e07b042f16c8d` |
| Final evaluation | `0866bef40210be6f0c8281a97962c65b690396c77b8442e709f9c0228fd3f9df` |

Source immutability, module integrity and clean tracked tree were verified before
and after formal execution. Device writer and lease were released.
