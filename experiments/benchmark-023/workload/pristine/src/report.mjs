// Aggregation over worklog entries: per-project summaries and durations.

/**
 * Summarize entries, optionally filtered to one calendar day.
 *
 * Rows are per project with total minutes and entry counts, sorted by
 * total minutes DESCENDING, ties broken by project name ASCENDING.
 * `total` is the filtered minutes sum; `count` the filtered entry count.
 */
export function summarize(entries, opts = {}) {
  const day = opts === null || opts === undefined ? undefined : opts.day;
  const filtered =
    day === undefined ? entries : entries.filter((e) => e.date === day);
  const byProject = new Map();
  for (const e of filtered) {
    const row = byProject.get(e.project) ?? {
      project: e.project,
      minutes: 0,
      entries: 0,
    };
    row.minutes += e.minutes;
    row.entries += 1;
    byProject.set(e.project, row);
  }
  const rows = [...byProject.values()];
  rows.sort(
    (a, b) => b.minutes - a.minutes || a.project.localeCompare(b.project),
  );
  return {
    rows,
    total: filtered.reduce((sum, e) => sum + e.minutes, 0),
    count: filtered.length,
  };
}

/**
 * Render a minutes total as a compact human duration:
 * 0 -> "0m"; 45 -> "45m"; 60 -> "1h"; 75 -> "1h 15m"; 135 -> "2h 15m".
 * The hours segment appears only when nonzero; likewise the minutes
 * segment; the two are separated by a single space.
 */
export function formatDuration(totalMinutes) {
  const m = Math.max(0, Math.floor(totalMinutes));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h === 0) return `${r}m`;
  if (r === 0) return `${h}h`;
  return `${h}h ${r}m`;
}
