import { agentForRecordedComputer } from "./recording-computer-device.js";

const recorded = await agentForRecordedComputer();
try {
  // Read-only smoke: proves Midscene's screenshot path crosses our recorder.
  await recorded.device.screenshotBase64();
  console.log(`macOS recording: ${recorded.writer.recordingDir}`);
} finally {
  await recorded.close();
}
