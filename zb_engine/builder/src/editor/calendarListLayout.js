/**
 * Builder-only calendar list row layout (mirrors src/data/calendar/listLayout.ts).
 */

function startOfDay(ts) {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/**
 * @param {Array<{ start_ts: number, label: string, detail_label?: string, date_heading: string, relative_label?: string }>} events
 * @param {number} maxLines
 */
export function buildCalendarListRows(events, maxLines) {
  const rows = [];
  let lineCount = 0;

  let i = 0;
  while (i < events.length && lineCount < maxLines) {
    const dayKey = startOfDay(events[i].start_ts);
    let j = i + 1;
    while (j < events.length && startOfDay(events[j].start_ts) === dayKey) {
      j++;
    }
    const group = events.slice(i, j);

    if (group.length >= 2) {
      const remaining = maxLines - lineCount;
      if (remaining < 2) break;

      const headingSuffix = group[0].relative_label || '';
      const headingText = headingSuffix
        ? `${group[0].date_heading} ${headingSuffix}`
        : group[0].date_heading;

      rows.push({ kind: 'heading', text: headingText, fontWeight: 600 });
      lineCount++;

      for (const ev of group) {
        if (lineCount >= maxLines) break;
        const detail = ev.detail_label ?? '';
        if (!detail) continue;
        rows.push({ kind: 'detail', text: detail, fontWeight: 400 });
        lineCount++;
      }
    } else {
      rows.push({ kind: 'standalone', text: group[0].label, fontWeight: 400 });
      lineCount++;
    }

    i = j;
  }

  return rows;
}

export function countCalendarListRows(events, maxLines) {
  return buildCalendarListRows(events, maxLines).length;
}
