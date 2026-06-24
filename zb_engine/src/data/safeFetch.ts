/**
 * safeFetch.ts — non-engine fetch helpers for data/platform code.
 *
 * This module intentionally lives outside `src/engine/` so source and HA
 * fetch hardening can evolve without touching the frozen renderer port.
 *
 * Cancellation: every helper accepts an optional external `AbortSignal`
 * (typically the per-render signal owned by `runPipeline`). Aborts are
 * honored independently of the per-request timeout so a render that has
 * already exceeded `RENDER_TIMEOUT_MS` does not keep consuming CPU /
 * sockets while a stale `Promise.race` loser drains in the background.
 */

function timeoutError(label: string, timeoutMs: number): Error {
  return new Error(`${label} timed out after ${timeoutMs}ms`);
}

/** Internal marker thrown when the external abort signal fires mid-read. */
function abortedError(label: string): Error {
  const err = new Error(`${label} aborted.`);
  err.name = "AbortError";
  return err;
}

/**
 * Race `promise` against a deadline AND an optional external abort signal.
 * Cleans up timers / listeners on every settlement path so callers cannot
 * leak unhandled rejections after the loser settles.
 */
async function readWithDeadline<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
  signal?: AbortSignal,
): Promise<T> {
  if (signal?.aborted) throw abortedError(label);

  let handle: ReturnType<typeof setTimeout> | undefined;
  let abortListener: (() => void) | undefined;
  try {
    return await new Promise<T>((resolve, reject) => {
      handle = setTimeout(() => reject(timeoutError(label, timeoutMs)), timeoutMs);
      handle.unref?.();
      if (signal) {
        abortListener = () => reject(abortedError(label));
        signal.addEventListener("abort", abortListener, { once: true });
      }
      promise.then(resolve, reject);
    });
  } finally {
    if (handle) clearTimeout(handle);
    if (signal && abortListener) signal.removeEventListener("abort", abortListener);
  }
}

/**
 * Fetch with AbortController timeout. The optional `signal` parameter is an
 * external cancellation signal (typically the render-level signal); when it
 * fires we abort the in-flight fetch and surface a distinct `RENDER_ABORTED`
 * error so callers can distinguish a render-cancellation from a per-request
 * timeout.
 */
export async function fetchWithTimeout(
  url: string,
  timeoutMs: number,
  init?: RequestInit,
  signal?: AbortSignal,
): Promise<Response> {
  if (signal?.aborted) throw new Error("RENDER_ABORTED");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();

  // Forward an external abort to the per-request controller so the
  // underlying socket is closed promptly. We DO NOT pipe the external
  // signal directly into `fetch()` because we want to distinguish a
  // render abort from a per-request timeout in the error path.
  let abortListener: (() => void) | undefined;
  if (signal) {
    abortListener = () => controller.abort();
    signal.addEventListener("abort", abortListener, { once: true });
  }

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } catch (err) {
    if (signal?.aborted) {
      throw new Error("RENDER_ABORTED");
    }
    const message = err instanceof Error
      ? `${err.name}: ${err.message}`
      : String(err);
    if (message.includes("AbortError") || message.includes("aborted")) {
      throw timeoutError("Request", timeoutMs);
    }
    throw err instanceof Error ? err : new Error(String(err));
  } finally {
    clearTimeout(timer);
    if (signal && abortListener) signal.removeEventListener("abort", abortListener);
  }
}

/**
 * Read a response body as text with both byte and total-time limits.
 * Honors an optional external abort signal; on abort the underlying
 * stream reader is cancelled and a `RENDER_ABORTED` error is thrown.
 */
export async function readResponseTextWithLimit(
  response: Response,
  maxBytes: number,
  totalTimeoutMs: number,
  label = "Response body",
  signal?: AbortSignal,
): Promise<string> {
  if (signal?.aborted) throw new Error("RENDER_ABORTED");

  if (!response.body) {
    const text = await readWithDeadline(response.text(), totalTimeoutMs, label, signal);
    if (Buffer.byteLength(text, "utf-8") > maxBytes) {
      throw new Error(`${label} exceeds ${maxBytes} byte limit.`);
    }
    return text;
  }

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  const deadline = Date.now() + totalTimeoutMs;

  // Forward external abort to the stream reader so an in-flight
  // `reader.read()` settles promptly when the render is cancelled.
  let abortListener: (() => void) | undefined;
  if (signal) {
    abortListener = () => {
      try { void reader.cancel(); } catch { /* ignore */ }
    };
    signal.addEventListener("abort", abortListener, { once: true });
  }

  try {
    while (true) {
      if (signal?.aborted) throw new Error("RENDER_ABORTED");
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw timeoutError(label, totalTimeoutMs);

      const { done, value } = await readWithDeadline(reader.read(), remaining, label, signal);
      if (done) break;
      if (!value) continue;

      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw new Error(`${label} exceeds ${maxBytes} byte limit.`);
      }
      chunks.push(Buffer.from(value));
    }
  } catch (err) {
    try { await reader.cancel(); } catch { /* ignore cancel failure */ }
    if (signal?.aborted) throw new Error("RENDER_ABORTED");
    throw err;
  } finally {
    if (signal && abortListener) signal.removeEventListener("abort", abortListener);
  }

  return Buffer.concat(chunks, totalBytes).toString("utf-8");
}

/**
 * Typed error thrown when a JSON body exceeds its byte cap. Carries the
 * limit so callers (and tests) can distinguish a size-cap rejection from
 * a malformed-JSON or HTTP error.
 */
export class ResponseBodyTooLargeError extends Error {
  readonly maxBytes: number;
  constructor(label: string, maxBytes: number) {
    super(`${label} exceeds ${maxBytes} byte limit.`);
    this.name = "ResponseBodyTooLargeError";
    this.maxBytes = maxBytes;
  }
}

/**
 * Read a response body as JSON with both a byte cap and a total-time
 * cap. Backed by `readResponseTextWithLimit`, so abort propagation and
 * timeout semantics are identical. Throws `ResponseBodyTooLargeError`
 * specifically when the byte cap is exceeded; everything else surfaces
 * as the existing timeout / `RENDER_ABORTED` / parse error.
 */
export async function readResponseJsonWithLimit<T = unknown>(
  response: Response,
  maxBytes: number,
  totalTimeoutMs: number,
  label = "Response body",
  signal?: AbortSignal,
): Promise<T> {
  let text: string;
  try {
    text = await readResponseTextWithLimit(response, maxBytes, totalTimeoutMs, label, signal);
  } catch (err) {
    if (err instanceof Error && err.message.endsWith(`exceeds ${maxBytes} byte limit.`)) {
      throw new ResponseBodyTooLargeError(label, maxBytes);
    }
    throw err;
  }
  return JSON.parse(text) as T;
}
