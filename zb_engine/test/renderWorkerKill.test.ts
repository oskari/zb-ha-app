/**
 * renderWorkerKill.test.ts — unit tests for the terminable render
 * worker. A stuck engine (a worker that never replies) must be hard-killed
 * when the per-render AbortSignal fires, `renderInWorker` must reject with the
 * abort marker, and the terminated singleton worker must be discarded so the
 * next render spawns a fresh one.
 */

import { describe, it, expect, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import type { Worker } from "node:worker_threads";
import { renderInWorker, __setEngineWorkerFactory } from "../src/core/renderService";
import type { DataContext } from "@zb/expressions";

/**
 * A fake worker that NEVER replies to a posted message — simulating a stuck,
 * CPU-bound engine. `terminate()` counts its calls and fires `exit` like a real
 * killed worker (asynchronously, as `Worker.terminate` is a promise).
 */
function makeStuckWorker() {
  const w = new EventEmitter() as EventEmitter & {
    postMessage: (v: unknown) => void;
    terminate: () => Promise<number>;
    unref: () => void;
    terminateCount: number;
  };
  w.terminateCount = 0;
  w.postMessage = () => {
    /* never replies — the engine is "stuck" */
  };
  w.terminate = () => {
    w.terminateCount++;
    queueMicrotask(() => w.emit("exit", 1));
    return Promise.resolve(1);
  };
  w.unref = () => {};
  return w;
}

const emptyCtx = {} as unknown as DataContext;

describe("renderInWorker hard-kill", () => {
  afterEach(() => __setEngineWorkerFactory(null));

  it("terminates the worker and rejects with the abort marker when the signal fires", async () => {
    const stuck = makeStuckWorker();
    __setEngineWorkerFactory(() => stuck as unknown as Worker);

    const controller = new AbortController();
    const p = renderInWorker([], emptyCtx, 8, 8, controller.signal);

    // Nothing has replied; fire the timeout abort. The abort listener is
    // registered synchronously inside renderInWorker, so this reaches it.
    controller.abort();

    await expect(p).rejects.toThrow("RENDER_ABORTED");
    expect(stuck.terminateCount).toBe(1);
  });

  it("disposes the terminated worker and spawns a fresh one on the next render", async () => {
    let created = 0;
    __setEngineWorkerFactory(() => {
      created++;
      return makeStuckWorker() as unknown as Worker;
    });

    const c1 = new AbortController();
    const p1 = renderInWorker([], emptyCtx, 8, 8, c1.signal);
    c1.abort();
    await expect(p1).rejects.toThrow("RENDER_ABORTED");
    expect(created).toBe(1);

    // The exit handler disposed the singleton, so the next render must build a
    // brand-new worker rather than reuse the terminated (unusable) one.
    const c2 = new AbortController();
    const p2 = renderInWorker([], emptyCtx, 8, 8, c2.signal);
    c2.abort();
    await expect(p2).rejects.toThrow("RENDER_ABORTED");
    expect(created).toBe(2);
  });
});
