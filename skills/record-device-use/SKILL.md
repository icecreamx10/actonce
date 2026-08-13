---
name: record-device-use
description: Record AI-driven device or desktop tasks through ActOnce CLI profiles for Midscene on macOS, Midscene on iOS, or generic WDA-based iOS automation. Use when an agent must execute a qualitative UI task once and preserve its actions, checkpoints, screenshots, native UI evidence, protocol traffic, and timing for later inspection or replay compilation.
---

# Record Device Use

Capture one authoritative run without changing the task's intended behavior. Preserve raw evidence so a later compiler can select replayable segments.

## Availability and environment

- The bundled verifier is self-contained and needs only Node.js 20.19+, 22.12+, or 24+.
- Live recording requires `@byted-lynx/actonce-recorder` (included by `@byted-lynx/actonce`), the selected platform/device, and the permissions required by Midscene or WebDriverAgent.
- macOS profiles require a supported macOS developer machine. iOS profiles require an explicitly selected Simulator or device and reachable WebDriverAgent. Model-backed tasks also require the model credentials configured for Midscene.
- If `actonce-record profiles --json` does not list the required profile, stop and report the missing runtime instead of inventing commands.

## Workflow

1. Locate the installed `actonce-record` CLI or an ActOnce checkout. In a checkout, identify it by the `interceptor:start` package script.
2. Run `actonce-record profiles --json`; in a checkout use `npm run interceptor:start -- profiles --json`. Use only a profile returned by the CLI; do not construct or attach interceptor sources in the skill workflow.
3. Read [references/cli-profiles.md](references/cli-profiles.md) and prepare the task module required by `midscene-macos` or `midscene-ios`. Generic `ios-wda` recording does not require a task module.
4. Establish a meaningful recording ID and run the selected CLI profile. The CLI owns source composition, startup order, checkpoint policy, and shutdown.
5. Run the intended task normally. Do not add extra AI actions merely to improve the trace.
6. Stop proxy profiles with SIGINT after the client completes. Task-module profiles close automatically in `finally`, including when the task fails.
7. Resolve this skill's installation directory from the loaded `SKILL.md`, then run its bundled verifier by absolute path:

   ```bash
   node /absolute/path/to/record-device-use/scripts/verify-recording.mjs <recording-dir>
   ```

8. Report the recording directory, selected sources, integrity status, event count, and any unavailable evidence such as a missing AX tree.

## Profile boundary

- Treat `midscene-macos`, `midscene-ios`, and `ios-wda` as public CLI contracts.
- Never import `RecorderSession`, `RecorderInterceptor`, or source implementations into a generated task module.
- Never change a profile's source list from the skill. If a new combination is required, implement and test a new named profile in the CLI first.
- Do not claim arbitrary OS input capture for tools that do not have a shipped CLI profile.

## Integrity rules

- Never place API keys, authorization headers, clipboard secrets, or `.env` contents in events or task reports. Redact at the source boundary.
- Never edit a completed recording in place.

For exact commands and the task-module interface, read [references/cli-profiles.md](references/cli-profiles.md). For a concise Chinese workflow, read [references/guide.zh-CN.md](references/guide.zh-CN.md).
