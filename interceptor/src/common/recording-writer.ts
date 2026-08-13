export {
  RecorderSession as RecordingWriter,
  type RecorderSessionOptions as RecordingWriterOptions,
  type RecordingPlatform,
} from "../core/recorder-session.js";
export type { ArtifactReference } from "../core/source-interceptor.js";

export function decodeDataUrl(value: string): { bytes: Buffer; mediaType: string } {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(value);
  if (!match) {
    return { bytes: Buffer.from(value, "base64"), mediaType: "image/png" };
  }
  return { bytes: Buffer.from(match[2], "base64"), mediaType: match[1] };
}
