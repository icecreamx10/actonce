# @actonce/midscene-fallback

Injects an existing Midscene Agent as a bounded, segment-local fallback for
`@actonce/replay`. It calls `aiAction` only after a checkpoint mismatch and never
marks the checkpoint as passed itself; the replay flow captures and verifies the
checkpoint again before resuming deterministic execution.

The caller owns the Midscene device and recorder lifecycle. Use the recorded device
adapter so fallback actions remain in the same ActOnce event timeline.
