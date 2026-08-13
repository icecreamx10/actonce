import type { WaitOptions } from "./types.js";

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_INTERVAL_MS = 100;

export async function waitUntil<T>(
  probe: () => Promise<T | false | null | undefined> | T | false | null | undefined,
  options: WaitOptions = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const deadline = performance.now() + timeoutMs;
  let lastError: unknown;
  do {
    try {
      const value = await probe();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    if (performance.now() >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  } while (true);

  const message = options.message ?? `Condition was not met within ${timeoutMs}ms`;
  throw new Error(
    lastError instanceof Error ? `${message}: ${lastError.message}` : message,
    { cause: lastError },
  );
}
