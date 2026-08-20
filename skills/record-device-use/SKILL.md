---
name: record-device-use
description: Record AI-driven device or desktop tasks through ActOnce CLI profiles for Midscene on macOS, iOS, or Android, plus generic WDA-based iOS automation. Use when an agent must execute a qualitative UI task once and preserve its actions, checkpoints, screenshots, native UI evidence, protocol traffic, and timing for later inspection or replay compilation.
---

# Record Device Use

Capture one authoritative run without changing the task. Preserve enough raw evidence for replay compilation.

## Availability and environment

- Offline verification needs only Node.js 20.19+, 22.12+, or 24+.
- Recording is not self-contained in this skill package. It requires `@byted-lynx/actonce-recorder` (included by `@byted-lynx/actonce`) or an ActOnce checkout, plus the selected platform/device and permissions required by Midscene or WebDriverAgent.
- macOS needs a supported developer machine and required permissions; iOS needs an explicitly selected Simulator/device and reachable WebDriverAgent; Android needs one connected ADB device. Model-backed tasks also need configured Midscene credentials.
- If `actonce-record profiles --json` omits the required profile, report the missing runtime instead of inventing commands.
- Use this skill to capture a new run. If the user only supplies an existing `manifest.json` and `events.ndjson`, use `synthesize-device-replay` instead; its inspection helpers do not require a live device.

## Workflow

1. Run `actonce-record profiles --json`; in a checkout use `npm run interceptor:start -- profiles --json` from its root.
2. Read [references/cli-profiles.md](references/cli-profiles.md) completely. Use only a returned profile and its documented task-module contract.
3. Choose a meaningful recording ID and run the profile. The CLI owns capture sources, startup order, checkpoints, and shutdown; never import recorder internals or change a profile's sources.
4. Run the intended task normally. Do not add actions merely to improve the trace. Stop proxy profiles with SIGINT after the client completes; task-module profiles finalize automatically.
5. Resolve this skill's directory from the loaded `SKILL.md`, then verify by absolute path:

   ```bash
   node /absolute/path/to/record-device-use/scripts/verify-recording.mjs <recording-dir>
   ```

6. Report the recording directory, sources, integrity, event count, and unavailable evidence.

## Integrity rules

- Never place API keys, authorization headers, clipboard secrets, or `.env` contents in events or task reports. Redact at the source boundary.
- Never edit a completed recording in place.
- Do not claim capture beyond profiles shipped by the CLI.

For exact commands and the task-module interface, read [references/cli-profiles.md](references/cli-profiles.md). For a concise Chinese workflow, read [references/guide.zh-CN.md](references/guide.zh-CN.md).
