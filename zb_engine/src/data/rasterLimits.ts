/**
 * rasterLimits.ts — Shared pixel-budget caps for out-of-engine rasterization
 *
 * Both `svgPreRasterizer.ts` and `userAssets.ts` (and any future pre-render
 * pass that decodes images outside the frozen engine) MUST clamp their
 * output dimensions through these constants. Per-element `sizeX`/`sizeY`
 * come from payload data and could otherwise request a multi-megapixel
 * allocation that OOMs the process before any timeout fires.
 */

/**
 * Hard cap on a single output bitmap axis. 4096 px caps a single
 * grayscale allocation at ~16 MB — well above any realistic e-ink layout.
 */
export const MAX_RASTER_AXIS = 4096;

/**
 * Hard cap on total output pixels per element (~4 MP). At 1 byte per
 * grayscale pixel that's 4 MB per element, which stays comfortably
 * within budget even with hundreds of elements per render.
 */
export const MAX_RASTER_PIXELS = 4 * 1024 * 1024;
