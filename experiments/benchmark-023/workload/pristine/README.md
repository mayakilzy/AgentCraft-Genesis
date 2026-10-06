# worklog

A tiny time-tracking ledger for the command line. Zero dependencies,
one JSON Lines file, plain output you can read, pipe and export.

worklog tracks time entries per project and per day, summarizes them,
and exports them as CSV or JSON. The behavioral contract is
[SPEC.md](SPEC.md); the library API is documented in
[docs/api.md](docs/api.md).

## Install

```bash
$ npm install
```

worklog has no dependencies; the install is a formality that keeps the
standard tooling happy.

## Quickstart

Every command writes to a ledger file — `--store` selects it
(default `worklog.jsonl`). This tour uses `demo.jsonl`:

```bash
$ rm -f demo.jsonl
$ node src/cli.mjs --store demo.jsonl add 90 --project docs --date 2026-10-01
$ node src/cli.mjs --store demo.jsonl add 45 --project api --note "review and triage" --date 2026-10-01
$ node src/cli.mjs --store demo.jsonl add 30 --project api --date 2026-10-02
$ node src/cli.mjs --store demo.jsonl summary --day 2026-10-01
```

```text
added e0001
added e0002
added e0003
PROJECT  TIME    ENTRIES
docs     1h 30m  1
api      45m     1
total: 2h 15m
```

The summary lists projects by their tracked time — most time first —
and `total:` adds up the day.

## Commands

### add

```bash
$ node src/cli.mjs --store demo.jsonl add 75 --project api --note "pair session" --date 2026-10-02
$ node src/cli.mjs --store demo.jsonl list --day 2026-10-02
```

```text
added e0004
ID     DATE        MINUTES  PROJECT  NOTE
e0003  2026-10-02  30       api
e0004  2026-10-02  75       api      pair session
```

`add` requires `<minutes>` and `--project`; `--note` and `--date`
(default: today) are optional. Dates are strict `YYYY-MM-DD`.

### summary

```bash
$ node src/cli.mjs --store demo.jsonl summary
```

```text
PROJECT  TIME    ENTRIES
api      2h 30m  3
docs     1h 30m  1
total: 4h
```

### export

```bash
$ node src/cli.mjs --store demo.jsonl export --format csv
```

```text
id,date,minutes,project,note
e0001,2026-10-01,90,docs,
e0002,2026-10-01,45,api,review and triage
e0003,2026-10-02,30,api,
e0004,2026-10-02,75,api,pair session
```

CSV follows RFC 4180: fields containing commas or quotes are quoted and
embedded quotes are doubled. `--format json` emits the entry array as
pretty-printed JSON.

### help

`node src/cli.mjs --help` prints usage and exits 0. Unknown commands or
flags exit 2 with the usage text on stderr.

## The ledger file

One JSON object per line, in entry order:

```text
{"id":"e0001","date":"2026-10-01","minutes":90,"project":"docs"}
{"id":"e0002","date":"2026-10-01","minutes":45,"project":"api","note":"review and triage"}
```

Reading it back is one line of library code — see
[docs/api.md](docs/api.md).

## Development

```bash
$ npm test
```

runs the test suite (`node --test tests/`). The project is plain
ESM JavaScript; `node --check src/<file>.mjs` parses any module.
