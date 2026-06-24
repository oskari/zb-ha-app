/**
 * timeAgo.js — Short relative-time formatting.
 *
 * Shared by the TopBar auto-save readout and the canvas data-freshness pill
 * so both render identical "Xm ago" labels.
 */

/** Format an epoch timestamp (ms) as a short relative label (e.g. "2m ago"). */
export function formatTimeAgo(epoch) {
  const sec = Math.round((Date.now() - epoch) / 1000);
  if (sec < 5) return 'just now';
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  return `${hr}h ago`;
}
