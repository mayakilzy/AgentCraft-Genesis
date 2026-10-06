import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { cliMain } from '../src/cli.mjs';

function withTmpStore(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'worklog-cli-'));
  const storePath = join(dir, 'worklog.jsonl');
  const origCwd = process.cwd();
  process.chdir(dir);
  try {
    return fn(storePath);
  } finally {
    process.chdir(origCwd);
    rmSync(dir, { recursive: true, force: true });
  }
}

test('add appends, prints the id, and writes the ledger', () => {
  withTmpStore((storePath) => {
    const a = cliMain(['add', '90', '--project', 'docs', '--date', '2026-10-01']);
    assert.equal(a.exitCode, 0);
    assert.equal(a.stdout, 'added e0001');
    const b = cliMain(['add', '45', '--project', 'api', '--date', '2026-10-01']);
    assert.equal(b.stdout, 'added e0002');
    const text = readFileSync(storePath, 'utf8');
    assert.equal(
      text,
      '{"id":"e0001","date":"2026-10-01","minutes":90,"project":"docs"}\n' +
        '{"id":"e0002","date":"2026-10-01","minutes":45,"project":"api"}\n',
    );
  });
});

test('add requires --project and an integer minutes positional', () => {
  withTmpStore(() => {
    assert.equal(cliMain(['add', '45', '--date', '2026-10-01']).exitCode, 2);
    assert.equal(cliMain(['add', 'x', '--project', 'api']).exitCode, 2);
    assert.equal(cliMain(['add', '--project', 'api']).exitCode, 2);
  });
});

test('add rejects invalid dates with exit 2', () => {
  withTmpStore(() => {
    const r = cliMain(['add', '45', '--project', 'api', '--date', '2026-1-5']);
    assert.equal(r.exitCode, 2);
    assert.match(r.stderr, /date must be a valid YYYY-MM-DD/);
    const r2 = cliMain(['add', '45', '--project', 'api', '--date', '2026-02-30']);
    assert.equal(r2.exitCode, 2);
  });
});

test('list renders the entry table', () => {
  withTmpStore(() => {
    cliMain(['add', '90', '--project', 'docs', '--date', '2026-10-01']);
    cliMain(['add', '45', '--project', 'api', '--note', 'review', '--date', '2026-10-01']);
    const r = cliMain(['list', '--day', '2026-10-01']);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      'ID     DATE        MINUTES  PROJECT  NOTE\n' +
        'e0001  2026-10-01  90       docs\n' +
        'e0002  2026-10-01  45       api      review',
    );
  });
});

test('list on an empty or unmatched day prints (no entries)', () => {
  withTmpStore(() => {
    assert.equal(cliMain(['list']).stdout, '(no entries)');
    assert.equal(cliMain(['list', '--day', '2030-01-01']).stdout, '(no entries)');
  });
});

test('summary renders sorted rows and the compact total', () => {
  withTmpStore(() => {
    cliMain(['add', '90', '--project', 'docs', '--date', '2026-10-01']);
    cliMain(['add', '45', '--project', 'api', '--date', '2026-10-01']);
    cliMain(['add', '30', '--project', 'api', '--date', '2026-10-02']);
    const r = cliMain(['summary', '--day', '2026-10-01']);
    assert.equal(
      r.stdout,
      'PROJECT  TIME    ENTRIES\n' +
        'docs     1h 30m  1\n' +
        'api      45m     1\n' +
        'total: 2h 15m',
    );
    const all = cliMain(['summary']);
    assert.equal(
      all.stdout,
      'PROJECT  TIME    ENTRIES\n' +
        'docs     1h 30m  1\n' +
        'api      1h 15m  2\n' +
        'total: 2h 45m',
    );
  });
});

test('summary --day=VALUE (equals form) filters the same day', () => {
  withTmpStore(() => {
    cliMain(['add', '90', '--project', 'docs', '--date', '2026-10-01']);
    cliMain(['add', '45', '--project', 'api', '--date', '2026-10-01']);
    cliMain(['add', '30', '--project', 'api', '--date', '2026-10-02']);
    const r = cliMain(['summary', '--day=2026-10-01']);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      'PROJECT  TIME    ENTRIES\n' +
        'docs     1h 30m  1\n' +
        'api      45m     1\n' +
        'total: 2h 15m',
    );
  });
});

test('export renders CSV with RFC 4180 quoting', () => {
  withTmpStore(() => {
    cliMain([
      'add', '30', '--project', 'api',
      '--note', 'fixed "priority" bug, see SPEC',
      '--date', '2026-10-01',
    ]);
    cliMain(['add', '45', '--project', 'docs', '--date', '2026-10-01']);
    const r = cliMain(['export', '--format', 'csv']);
    assert.equal(
      r.stdout,
      'id,date,minutes,project,note\n' +
        'e0001,2026-10-01,30,api,"fixed ""priority"" bug, see SPEC"\n' +
        'e0002,2026-10-01,45,docs,\n',
    );
  });
});

test('export json renders the pretty entry array', () => {
  withTmpStore(() => {
    cliMain(['add', '45', '--project', 'docs', '--date', '2026-10-01']);
    const r = cliMain(['export', '--format', 'json']);
    assert.equal(
      r.stdout,
      '[\n  {\n    "id": "e0001",\n    "date": "2026-10-01",\n    "minutes": 45,\n    "project": "docs"\n  }\n]',
    );
  });
});

test('export rejects unknown formats; usage errors exit 2', () => {
  withTmpStore(() => {
    assert.equal(cliMain(['export', '--format', 'xml']).exitCode, 2);
    assert.equal(cliMain(['bogus']).exitCode, 2);
    assert.equal(cliMain([]).exitCode, 2);
  });
});

test('--help prints usage and exits 0', () => {
  const r = cliMain(['--help']);
  assert.equal(r.exitCode, 0);
  assert.match(r.stdout, /usage:/);
  assert.equal(cliMain(['-h']).exitCode, 0);
});
