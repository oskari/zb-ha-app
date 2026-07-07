/**
 * renderWorker.ts — Terminable worker-thread host for the frozen render engine
 *
 * The frozen engine's `render()` runs a synchronous per-element draw
 * loop and takes no AbortSignal (`src/engine/renderer.ts`), so the per-render
 * timeout in `renderService` can only *signal* cancellation — it cannot
 * interrupt CPU-bound engine work on the main event loop. Running `render()`
 * here, inside a Node `worker_thread`, lets `renderService` hard-kill a runaway
 * render via `worker.terminate()` when the timeout's AbortController fires: the
 * main-thread timer runs unblocked, the worker is destroyed, and the render
 * promise rejects so the route can release the RenderGuard.
 *
 * This module only IMPORTS the public `render` symbol from the frozen engine
 * and calls it. It does NOT modify anything under `src/engine/`.
 */

import { parentPort } from "node:worker_threads";
import { render } from "../engine/renderer";
import type { DataContext } from "@zb/expressions";
import type { RenderErrorInfo } from "../errors/renderError";

/** Message posted from `renderService` to this worker. */
interface RenderWorkerRequest {
  elements: Record<string, unknown>[];
  ctx: DataContext;
  width: number;
  height: number;
}

if (parentPort) {
  const port = parentPort;
  port.on("message", async (msg: RenderWorkerRequest) => {
    try {
      const { canvas, errors } = await render(
        msg.elements,
        msg.ctx,
        msg.width,
        msg.height,
      );
      // `Canvas.buffer` wraps a dedicated ArrayBuffer at offset 0 spanning the
      // whole allocation (stride * height bytes), so transferring `.buffer` is
      // a zero-copy hand-off of the packed 1-bit bitmap back to the main
      // thread, which reconstructs the Canvas losslessly.
      const buffer = canvas.buffer.buffer as ArrayBuffer;
      port.postMessage(
        {
          ok: true,
          buffer,
          width: canvas.width,
          height: canvas.height,
          stride: canvas.stride,
          errors,
        },
        [buffer],
      );
    } catch (err) {
      port.postMessage({
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  });
}
