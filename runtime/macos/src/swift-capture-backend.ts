import { createHash, randomUUID } from "node:crypto";
import { spawn, execFile, type ChildProcessWithoutNullStreams } from "node:child_process";
import { chmod, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createInterface } from "node:readline";
import type { CaptureBackendFrame, CaptureBackendTarget, MacCaptureBackend } from "./capture-protocol.js";

const runFile = promisify(execFile);

export class SwiftCaptureBackend implements MacCaptureBackend {
  private id = 0;
  private readonly pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();

  private constructor(private readonly child: ChildProcessWithoutNullStreams) {
    child.stderr.resume();
    createInterface({ input: child.stdout }).on("line", (line) => {
      const response = JSON.parse(line) as { id?: number; result?: unknown; error?: { code?: string; message?: string } };
      if (response.id === undefined) return;
      const pending = this.pending.get(response.id);
      if (!pending) return;
      this.pending.delete(response.id);
      if (response.error) pending.reject(Object.assign(
        new Error(response.error.message ?? "macOS capture helper failed"),
        { code: response.error.code ?? "NATIVE_HELPER_ERROR" },
      ));
      else pending.resolve(response.result);
    });
    child.once("exit", (code, signal) => {
      const error = new Error(`macOS capture helper exited (${code ?? signal ?? "unknown"})`);
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
    });
  }

  static async start(options: { executable?: string } = {}): Promise<SwiftCaptureBackend> {
    const executable = options.executable ?? await ensureCaptureHelper();
    return new SwiftCaptureBackend(spawn(executable, [], { stdio: ["pipe", "pipe", "pipe"] }));
  }

  targets(): Promise<CaptureBackendTarget[]> {
    return this.request("targets", {});
  }

  async capture(windowId: number): Promise<CaptureBackendFrame> {
    const result = await this.request<{ pngBase64: string; widthPx: number; heightPx: number; scaleFactor: number }>("capture", { windowId });
    return { png: Buffer.from(result.pngBase64, "base64"), widthPx: result.widthPx, heightPx: result.heightPx, scaleFactor: result.scaleFactor };
  }

  async close(): Promise<void> {
    if (this.child.exitCode !== null) return;
    this.child.stdin.end();
    await new Promise<void>((resolveClose) => this.child.once("exit", () => resolveClose()));
  }

  private request<TResult>(method: string, params: Record<string, unknown>): Promise<TResult> {
    const id = ++this.id;
    return new Promise<TResult>((resolveRequest, reject) => {
      this.pending.set(id, { resolve: (value) => resolveRequest(value as TResult), reject });
      this.child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    });
  }
}

export async function ensureCaptureHelper(): Promise<string> {
  const source = resolve(dirname(fileURLToPath(import.meta.url)), "../native/capture-helper.swift");
  const bytes = await readFile(source);
  const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
  const directory = resolve(tmpdir(), "actonce-capture", hash);
  const executable = resolve(directory, "actonce-capture-helper");
  await mkdir(directory, { recursive: true });
  try {
    await chmod(executable, 0o755);
    return executable;
  } catch {
    // Build below.
  }
  const temporary = resolve(directory, `capture-helper-${randomUUID()}`);
  await runFile("/usr/bin/swiftc", ["-parse-as-library", "-O", source, "-o", temporary], { timeout: 120_000 });
  await chmod(temporary, 0o755);
  await runFile("/bin/mv", [temporary, executable]);
  return executable;
}
