/**
 * asyncMutex.ts — Minimal promise-chain mutex
 *
 * Serialises async critical sections so a check-then-write sequence cannot
 * interleave across concurrent callers (e.g. two parallel uploads/saves that
 * both pass a quota check before either persists). Single source of truth for
 * the pattern (ENGINEERING_CONSTRAINTS §6) used by the asset-upload and widget-storage
 * quota guards.
 *
 * `RenderGuard` is intentionally NOT built on this: it is a non-blocking
 * try-acquire gate (reject when busy), whereas this queues callers.
 */
export class AsyncMutex {
  private chain: Promise<void> = Promise.resolve();

  /**
   * Run `fn` after every previously enqueued operation finishes. Errors from
   * `fn` propagate to the caller but do NOT break the chain — the next caller
   * starts cleanly even if the previous one rejected.
   */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    const prior = this.chain;
    let release: () => void = () => {};
    this.chain = new Promise<void>((resolve) => {
      release = resolve;
    });
    try {
      await prior;
      return await fn();
    } finally {
      release();
    }
  }
}
