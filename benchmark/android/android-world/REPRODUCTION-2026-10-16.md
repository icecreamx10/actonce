# AndroidWorld selected follow-up · October 15–16, 2026

[简体中文](REPRODUCTION-2026-10-16.zh-CN.md)

**22/22 selected tasks now have independently formal-correct replays.** The
October 15 sweep supplied 19 passes; those were not rerun. October 16 resolved
the three remaining blockers. This is a selection of tasks with successful
originals, not a random sample, a full-suite pass rate, or 22 new runs on one
revision. All 22 have completed official reward 1 and zero replay action retries,
AI fallback and checkpoint timeouts.

The cumulative local inventory increases from 52 to **55/113 distinct tasks
with replay-pass evidence**. That inventory spans revisions and evidence quality;
it is not 55 freshly reproduced strict comparisons. Historical coverage sets
must not be added without deduplication.

## Newly resolved tasks

| Task | Original | Formal replay | Matched segments | Capture / settle |
| --- | ---: | ---: | ---: | ---: |
| ContactsNewContactDraft | 89.387 s | 5.476 s | 9 | 1.610 / 0.202 s |
| RecipeDeleteMultipleRecipesWithNoise | 209.174 s | 13.759 s | 18 | 2.305 / 2.622 s |
| RetroSavePlaylist | 439.022 s | 23.393 s | 35 | 6.560 / 5.049 s |

Each final candidate passed two independently initialized development runs,
then one formal invocation by a different agent with no inherited conversation.
Formal agents received repository/Skill/artifact/device constraints, not expected
actions, results or failure diagnoses. Candidate/source hashes were checked;
final screenshots were inspected and official validators completed. Four API 33
emulators were prepared; devices had exclusive writers and separate service/lease
ports. Shared-host execution overlapped, so this is not serial timing.

Recipe and Retro reuse successful immutable originals. Contacts required a new
`gpt-6-luna` original with frozen `grant-all` permissions/startup: the historical
orphan permission-dialog requester could not safely be reconstructed.

## Repairs and rejected candidates

- Generic direct-parent/sibling selectors uniquely identify repeated row controls;
  ambiguous or stale live lookups fail closed. Agent-authored optimizations retain
  recorded coordinate fallbacks; no task-wide mechanical replay compiler is used.
- Recipe excludes one ineffective exploratory Collapse click only after auditing
  its own screenshots/native observations and raw app implementation for permission,
  persistence and lifecycle effects. No contemporaneous original APK hash exists;
  current APK identity and predating update metadata support, but do not prove,
  historical binary parity.
- Contacts uses an evidenced unique label selector instead of incidental pixel
  bounds. The stronger filled-number/Home-on-the-same-row and unsaved-form checks
  remain: official reward alone had accepted earlier incomplete label states.
  Controlled input experiments did not justify a shared input-transport change;
  the historical 87-pixel offset's exclusive cause remains unproven.
- Retro preserves all 35 actions and recorded playback side effects. A candidate
  with a hidden uniform 10-second module timeout produced a correct result but was
  excluded from qualification. Final `synthesized-v2` stores source-audited budgets
  in its plan, consumes them unchanged and has a separate `formal-02` result.
- Oversized Recipe/Contacts budget candidates and other failed attempts remain
  preserved, not averaged. New polling budgets cite dispatch completion to each
  action's own modality-supported observations; preconditions do not invent a new
  settling window. The Skills now require executable-plan consistency checks.

## Timing and evidence limits

Original timing is the recording session including recorder overhead. Replay
timing includes native connection, actions/checkpoints/settling, final evidence
capture and close. Setup, official initialization/validation, module loading,
artifact writes and one-time synthesis/development are outside the replay clock.
Checkpoint capture and explicit settle delay are separate; the capture column
excludes final CLI evidence. No strict aggregate speedup is claimed. In particular,
Retro lacks historical RNG/permission baseline provenance; legacy fixtures and
host contention prevent treating all tasks as equivalent strict comparisons.

The committed [22-case metadata projection](results/2026-10-16-selected-followup.json)
lists each task, duration, official result, diagnostics and hashes of local
evaluation/qualification artifacts. It is not a self-contained reproduction or
raw evidence bundle. Local source artifacts remain under
`.cache/android-world/reuse22-20261015/` and
`.cache/android-world/remaining3-20261016/`; referenced files are not included in
this publication. Model logs, opaque fixture snapshots and new screenshots are
not published. Core repairs are in `b638c20`, `4d1a7dc` and `c2ab039`; the retained
19-task sweep used earlier revisions documented in its local scorecard.
