---
name: hybrid-replay
description: "Run an ActOnce compiled plan deterministically, inspect a failed checkpoint, use agent-controlled device actions to reach that checkpoint, then resume the remaining plan. Use when an actonce-ios replay or actonce-android replay run returns a failed status and an agent should recover the UI without changing the plan's checkpoints, segment order, or basic case logic."
---

# Hybrid Replay

Treat hybrid replay as an agent workflow around deterministic replay. The runtime never recovers automatically.

1. Read the `plan.json` and note the ordered segment ids.
2. Run the platform command:

   ```bash
   actonce-ios replay <plan.json>
   # or
   actonce-android replay <plan.json>
   ```

3. If it passes, stop. If it fails, read `failedCheckpoint`: `segmentId`, `phase`, `state`, `expected`, and `differences`.
4. Inspect the current device state and use the available device tools to reach exactly that checkpoint. You may lightly adjust or manually perform the failed segment's actions. Do not change checkpoint assertions, segment order, or the case's basic logic.
5. Verify the checkpoint with current device evidence. Do not claim recovery from action success alone.
6. Resume deterministically:
   - `phase: "precondition"`: resume from `failedCheckpoint.segmentId`.
   - `phase: "postcondition"`: resume from the segment immediately after `failedCheckpoint.segmentId`. If there is no next segment, the case is complete once the failed checkpoint is verified.

   ```bash
   actonce-ios replay <plan.json> --from-segment <segment-id>
   # or
   actonce-android replay <plan.json> --from-segment <segment-id>
   ```

Repeat only when another checkpoint fails. Preserve every failure and report manual actions. Escalate when the checkpoint cannot be reached without changing the immutable checkpoint or basic run structure.
