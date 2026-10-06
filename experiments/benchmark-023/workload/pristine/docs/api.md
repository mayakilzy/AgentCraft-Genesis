# worklog — Library API

The stable library surface is `src/lib.mjs` (plain ESM, zero
dependencies). Behavioral details live in
[SPEC.md](../SPEC.md); this page documents signatures and shows real,
runnable output.

All examples below run from the repository root.

## addEntry(store, entry)

Validates `entry` (project 1..40 chars, minutes integer 1..1440, strict
`YYYY-MM-DD` date, optional note ≤ 200 chars) and appends it with the
next sequential id. Returns the stored record.

```bash
$ node -e 'import("./src/lib.mjs").then(m => { const s = m.newStore(); const a = m.addEntry(s, { date: "2026-10-01", minutes: 30, project: "api" }); const b = m.addEntry(s, { date: "2026-10-01", minutes: 45, project: "docs", note: "review" }); console.log(a.id, b.id); })'
```

```text
e0001 e0002
```

Invalid input raises `ValidationError`:

```bash
$ node -e 'import("./src/lib.mjs").then(m => { try { m.addEntry(m.newStore(), { date: "2026-1-5", minutes: 30, project: "api" }); } catch (e) { console.log(e.name + ": " + e.message); } })'
```

```text
ValidationError: date must be a valid YYYY-MM-DD calendar date, got "2026-1-5"
```

## loadStore(text) / serializeStore(store)

`loadStore` parses JSON Lines ledger text (blank lines skipped, invalid
lines rejected with a 1-based line number); `serializeStore` writes the
canonical form back. They round-trip exactly:

```bash
$ node -e 'import("./src/lib.mjs").then(m => { const s = m.newStore(); m.addEntry(s, { date: "2026-10-01", minutes: 30, project: "api" }); m.addEntry(s, { date: "2026-10-01", minutes: 45, project: "docs" }); m.addEntry(s, { date: "2026-10-02", minutes: 30, project: "api" }); const back = m.loadStore(m.serializeStore(s)); console.log("roundtrip=" + (JSON.stringify(back.entries) === JSON.stringify(s.entries)) + " ids=" + back.entries.map(e => e.id).join(",")); })'
```

```text
roundtrip=true ids=e0001,e0002,e0003
```

## summarize(entries, opts)

Per-project totals for `entries`, restricted to `opts.day` when given.
Rows are sorted by total minutes descending, ties by project name
ascending; `total` and `count` aggregate the filtered entries.

```bash
$ node -e 'import("./src/lib.mjs").then(m => { const s = m.newStore(); m.addEntry(s, { date: "2026-10-01", minutes: 30, project: "api", note: "fixed \"priority\" bug, see SPEC" }); m.addEntry(s, { date: "2026-10-01", minutes: 45, project: "docs" }); m.addEntry(s, { date: "2026-10-02", minutes: 30, project: "api" }); console.log(m.summarize(s.entries).rows.map(r => r.project + "=" + r.minutes + "m/" + r.entries).join(" ")); })'
```

```text
api=60m/2 docs=45m/1
```

## formatDuration(totalMinutes)

Renders a minutes total compactly — `0m`, `45m`, `1h`, `1h 15m`:

```bash
$ node -e 'import("./src/lib.mjs").then(m => { console.log(m.formatDuration(45) + " | " + m.formatDuration(60) + " | " + m.formatDuration(75) + " | " + m.formatDuration(0)); })'
```

```text
45m | 1h | 1h 15m | 0m
```

## renderTable(headers, rows)

Left-aligned text table; columns padded to their widest cell, separated
by two spaces, trailing padding trimmed:

```bash
$ node -e 'import("./src/lib.mjs").then(m => { console.log(m.renderTable(["PROJECT", "TIME", "ENTRIES"], [["api", "1h 45m", 3], ["docs", "1h 30m", 1]])); })'
```

```text
PROJECT  TIME    ENTRIES
api      1h 45m  3
docs     1h 30m  1
```

## toCSV(entries)

RFC 4180 rendering with the fixed header `id,date,minutes,project,note`
— fields containing commas or quotes are quoted, embedded quotes
doubled:

```bash
$ node -e 'import("./src/lib.mjs").then(m => { const s = m.newStore(); m.addEntry(s, { date: "2026-10-01", minutes: 30, project: "api", note: "fixed \"priority\" bug, see SPEC" }); m.addEntry(s, { date: "2026-10-01", minutes: 45, project: "docs" }); process.stdout.write(m.toCSV(s.entries)); })'
```

```text
id,date,minutes,project,note
e0001,2026-10-01,30,api,"fixed ""priority"" bug, see SPEC"
e0002,2026-10-01,45,docs,
```

## toJSON(entries)

`JSON.stringify(entries, null, 2)` — the entry array pretty-printed
with two-space indentation.

## csvField(value)

The single-field RFC 4180 quoting rule used by `toCSV`: plain fields
pass through; fields containing a comma, a double quote or a newline
are wrapped in double quotes with embedded quotes doubled.

## ValidationError

The error class every validation rule raises (`e instanceof ValidationError`);
its message names the violated rule. See the `addEntry` example above.

## isValidDate(value)

True when `value` is a strict `YYYY-MM-DD` calendar date (exactly
zero-padded and real — `2026-1-5` and `2026-02-30` are invalid).

## validateEntry(entry)

Validates one entry (id excepted) against the data model rules of
[SPEC.md](../SPEC.md) §1 — project 1..40 chars, minutes integer
1..1440, strict date, optional note ≤ 200 chars. Returns `true` or
throws `ValidationError`.

## newStore()

An empty store: `{ entries: [] }`.

## nextId(store)

The next sequential id for a store (`e0001`, `e0002`, ...) — the rule
`addEntry` uses when appending.
