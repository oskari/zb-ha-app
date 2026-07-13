/**
 * Builder-only calendar list row layout (mirrors src/data/calendar/listLayout.ts).
 */

function startOfDay(ts) {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/**
 * @param {Array<{ start_ts: number, date_line?: string, detail_label?: string, date_heading: string }>} events
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
    const remaining = maxLines - lineCount;

    if (group.length >= 2) {
      if (remaining < 2) break;

      const dateText = group[0].date_line || group[0].date_heading;
      rows.push({ kind: 'date', text: dateText, fontWeight: 600 });
      lineCount++;

      for (const ev of group) {
        if (lineCount >= maxLines) break;
        const detail = ev.detail_label ?? '';
        if (!detail) continue;
        rows.push({ kind: 'detail', text: detail, fontWeight: 400 });
        lineCount++;
      }
    } else {
      if (remaining < 2) break;

      const ev = group[0];
      rows.push({
        kind: 'date',
        text: ev.date_line || ev.date_heading,
        fontWeight: 600,
      });
      lineCount++;

      if (lineCount < maxLines && ev.detail_label) {
        rows.push({ kind: 'detail', text: ev.detail_label, fontWeight: 400 });
        lineCount++;
      }
    }

    i = j;
  }

  return rows;
}

export function countCalendarListRows(events, maxLines) {
  return buildCalendarListRows(events, maxLines).length;
}
