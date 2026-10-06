# worklog — Behavioral Specification (v1.4.2)

This document is the authoritative contract for correct worklog behavior.
Where README.md or docs/api.md disagree with this specification, this
specification wins. The library API is `src/lib.mjs`.

## 1. Data model

A worklog entry is a JSON object with exactly these keys, in this order:

```json
{"id":"e0001","date":"2026-10-01","minutes":45,"project":"api","note":"review"}
```

- `id` — string, assigned by the store: `"e"` + the 1-based entry count
  zero-padded to 4 digits (`e0001`, `e0002`, ... `e9999`).
- `date` — string, a **strict** calendar date `YYYY-MM-DD`: exactly four
  digits, hyphen, two digits, hyphen, two digits (`^\d{4}-\d{2}-\d{2}$`),
  AND a real calendar date (`2026-02-30` is invalid; `2026-1-5` is
  invalid because the month and day are not zero-padded).
- `minutes` — integer, `1 <= minutes <= 1440`.
- `project` — non-empty string, at most 40 characters.
- `note` — optional string, at most 200 characters. Absent when not
  provided; never `null`.

Validation failures raise `ValidationError` (exported by the library)
with a message naming the violated rule.

## 2. Store (persistence)

The ledger is a JSON Lines file: one entry per line, in entry order,
with a trailing newline after the last line. An empty store serializes
to the empty string.

- `loadStore(text)` — parses ledger text. Blank lines are skipped. A
  line that is not valid JSON, or not a valid entry (including its
  `id`), raises `ValidationError` carrying the 1-based line number.
- `serializeStore(store)` — writes entries back, one JSON object per
  line, key order as in §1.
- `addEntry(store, entry)` — validates the entry (id excepted), assigns
  the next sequential id, appends it, and returns the stored record.

## 3. Reporting

`summarize(entries, opts)` where `opts.day` optionally restricts to one
calendar date:

- produces one row per project: `{ project, minutes, entries }` where
  `minutes` is the project's filtered total and `entries` its filtered
  count;
- **rows are sorted by total minutes DESCENDING; ties are broken by
  project name ASCENDING** (plain lexicographic);
- `total` — the filtered minutes sum; `count` — the filtered entry count.

`formatDuration(totalMinutes)` renders a nonnegative minute total:

| input | output |
| --- | --- |
| 0 | `0m` |
| 45 | `45m` |
| 60 | `1h` |
| 75 | `1h 15m` |
| 135 | `2h 15m` |

Rules: the hours segment appears only when nonzero; the minutes segment
appears only when nonzero; a single space separates them. There is
never a zero-valued segment (no `0h 45m`, no `1h 0m`).

## 4. Output formats

### Text tables (`renderTable(headers, rows)`)

- columns left-aligned, padded to the widest cell of the column
  (header included);
- columns separated by exactly two spaces;
- trailing padding trimmed at the end of each line;
- lines joined by `\n`, no trailing newline;
- zero data rows → the header line only.

`list` renders columns `ID, DATE, MINUTES, PROJECT, NOTE` (empty note →
empty string). `summary` renders columns `PROJECT, TIME, ENTRIES` where
`TIME` is `formatDuration` of the project total, followed by a final
line `total: <formatDuration(total)>`.

### CSV (`toCSV(entries)`, RFC 4180)

Fixed header `id,date,minutes,project,note`. Every field is passed
through `csvField`:

- a field containing a comma (`,`), a double quote (`"`) or a newline is
  wrapped in double quotes;
- double quotes inside a quoted field are doubled (`"` → `""`).

Example: the note `fixed "priority" bug, see SPEC` is rendered as
`"fixed ""priority"" bug, see SPEC"`.

Lines are joined by `\n` with a trailing newline.

### JSON (`toJSON(entries)`)

`JSON.stringify(entries, null, 2)` — the entry array, pretty-printed,
no trailing newline beyond the serialization itself.

## 5. Command line (`node src/cli.mjs`)

Exit codes: `0` success; `2` usage or validation error (message on
stderr, prefixed `error: ` for validation and usage errors); usage text
accompanies parse errors.

- `add <minutes> --project <name> [--note <text>] [--date <YYYY-MM-DD>]`
  — appends an entry and prints `added <id>`. `--date` defaults to the
  current local date. `--project` is required; exactly one positional
  `<minutes>` is required.
- `list [--day <YYYY-MM-DD>] [--project <name>]` — table of entries, or
  the line `(no entries)` when nothing matches.
- `summary [--day <YYYY-MM-DD>]` — the summary table plus total line, or
  `(no entries)` when nothing matches.
- `export [--format csv|json]` — the CSV (default) or JSON rendering of
  all entries.
- `--store <path>` — ledger file, default `worklog.jsonl` in the CWD.
- `--help` / `-h` — usage on stdout, exit 0. No command or an unknown
  command — usage on stderr, exit 2.
- A missing store file is an empty store for every command; `add`
  creates the file.

## 6. Argument grammar (`parseArgs`)

- One optional leading command word; remaining non-flag words are
  positionals.
- Long flags: `--name value` and `--name=value` are equivalent.
- Short flags: `-x value` and inline `-xvalue` are equivalent
  (`-p api`, `-papi`).
- Defined flags (all take values): `--project/-p`, `--note/-n`,
  `--date/-d`, `--day`, `--format/-f`, `--store/-s`.
- Unknown flags and flags without a value raise `ValidationError`.
- `--` makes every remaining word a positional.
