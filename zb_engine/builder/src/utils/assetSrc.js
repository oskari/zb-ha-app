/**
 * assetSrc.js — Resolve payload `asset:<filename>` tokens for the browser preview
 *
 * Custom uploaded images/SVGs are stored in the payload as an opaque
 * `asset:<filename>` token; the server render pre-pass resolves these from disk.
 * The browser cannot load the `asset:` URL scheme, so the canvas preview must
 * map the token to the platform's authenticated raw-bytes URL
 * (`GET /api/assets/<filename>/raw`) before handing it to an <img> loader.
 *
 * Security: loading through an <img> element runs an SVG as an image with NO
 * script execution (the same mechanism the asset-picker thumbnails use), the
 * bytes were already sanitized on upload, and the raw endpoint sends
 * `nosniff` + a generic `Content-Disposition`. This resolution only affects how
 * the browser DISPLAYS the element — the payload `src` stays the `asset:` token,
 * so nothing about the deployed/rendered output changes.
 */

/** Payload token prefix for user-uploaded assets. */
export const ASSET_TOKEN_PREFIX = 'asset:';

/**
 * Resolve an element `src` to a browser-loadable URL for the canvas preview.
 *
 * @param {unknown} src  The element's `src`: an `asset:<filename>` token, an
 *   http(s) URL, inline data, a binding/expression object, or empty.
 * @param {((filename: string) => string) | null | undefined} rawUrlFor
 *   Platform resolver mapping an asset filename to its raw-bytes URL (e.g.
 *   `assetRawUrl`). Null/absent on builds without an asset store.
 * @returns {unknown} The raw-bytes URL for an `asset:` token when a resolver is
 *   available; otherwise `src` unchanged — http/inline/binding values, and (when
 *   no resolver is present) the token itself, pass through untouched.
 */
export function resolveAssetSrc(src, rawUrlFor) {
  if (
    typeof src === 'string' &&
    src.startsWith(ASSET_TOKEN_PREFIX) &&
    typeof rawUrlFor === 'function'
  ) {
    const filename = src.slice(ASSET_TOKEN_PREFIX.length);
    // Guard the degenerate empty-filename token — leave it unresolved rather
    // than requesting `…/api/assets//raw`.
    if (filename) return rawUrlFor(filename);
  }
  return src;
}
