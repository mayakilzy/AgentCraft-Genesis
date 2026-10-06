// Output rendering: aligned text tables, CSV and JSON.

function pad(value, width) {
  const s = String(value);
  return s.length >= width ? s : s + ' '.repeat(width - s.length);
}

/**
 * Render a text table. Columns are left-aligned, padded to the widest
 * cell of each column (header included), separated by exactly two spaces;
 * trailing padding at the end of each line is trimmed. Returns the lines
 * joined by "\n" (no trailing newline). With zero rows, only the header
 * line is returned.
 */
export function renderTable(headers, rows) {
  const widths = headers.map(
    (h, i) =>
      Math.max(String(h).length, ...rows.map((r) => String(r[i]).length)),
  );
  const renderRow = (cells) =>
    cells.map((c, i) => pad(c, widths[i])).join('  ').trimEnd();
  return [renderRow(headers), ...rows.map((r) => renderRow(r))].join('\n');
}

/**
 * Quote one CSV field per RFC 4180: fields containing a comma, a double
 * quote or a newline are wrapped in double quotes, and embedded double
 * quotes are doubled.
 */
export function csvField(value) {
  const s = String(value);
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

/**
 * Render entries as CSV with the fixed header
 * id,date,minutes,project,note — every field passed through the RFC 4180
 * quoting rule, lines joined by "\n" and a trailing newline.
 */
export function toCSV(entries) {
  const lines = ['id,date,minutes,project,note'];
  for (const e of entries) {
    lines.push(
      [e.id, e.date, e.minutes, e.project, e.note ?? '']
        .map(csvField)
        .join(','),
    );
  }
  return lines.join('\n') + '\n';
}

/** Render entries as pretty-printed JSON (an array of entry objects). */
export function toJSON(entries) {
  return JSON.stringify(entries, null, 2);
}
