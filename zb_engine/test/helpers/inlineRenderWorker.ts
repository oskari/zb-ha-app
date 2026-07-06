/**
 * inlineRenderWorker.ts — shared test helper
 *
 * The render engine runs inside a worker_thread loaded from
 * the compiled `dist/core/renderWorker.js`. That file does not exist under
 * vitest (which runs TypeScript with no build, and whose `__dirname` points at
 * `src/core`). Any test that drives a real render through the pipeline must
 * therefore install this fake worker, which runs the real `render()` inline on
 * the main thread — byte-identical to the worker round-trip, since the worker
 * only transfers the packed 1-bit buffer back for lossless reconstruction.
 *
 * Call `installInlineRenderWorker()` in `beforeAll` and invoke the returned
 * restore function in `afterAll`. Tests that specifically exercise the
 * terminable worker (renderWorkerKill) install their own fake instead.
 */

import { EventEmitter } from "node:events";
import type { Worker } from "node:worker_threads";
import { __setEngineWorkerFactory } from "../../src/core/renderService";
import { render as realRender } from "../../src/engine/renderer";

function makeInlineRenderWorker() {
  const w = new EventEmitter() as EventEmitter & {
    postMessage: (req: {
      elements: Record<string, unknown>[];
      ctx: unknown;
      width: number;
      height: number;
    }) => void;
    terminate: () => Promise<number>;
    unref: () => void;
  };
  w.postMessage = (req) => {
    realRender(req.elements, req.ctx as never, req.width, req.height)
      .then(({ canvas, errors }) => {
        w.emit("message", {
          ok: true,
          buffer: canvas.buffer.buffer,
          width: canvas.width,
          height: canvas.height,
          stride: canvas.stride,
          errors,
        });
      })
      .catch((err) => {
        w.emit("message", {
          ok: false,
          message: err instanceof Error ? err.message : String(err),
        });
      });
  };
  w.terminate = () => {
    w.emit("exit", 0);
    return Promise.resolve(0);
  };
  w.unref = () => {};
  return w;
}

/**
 * Route the engine worker to an inline main-thread render for the duration of a
 * test file. Returns a restore function that reinstalls the default factory.
 */
export function installInlineRenderWorker(): () => void {
  __setEngineWorkerFactory(() => makeInlineRenderWorker() as unknown as Worker);
  return () => __setEngineWorkerFactory(null);
}
