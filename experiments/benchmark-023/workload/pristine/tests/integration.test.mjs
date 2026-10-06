import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const CLI = join(REPO, 'src', 'cli.mjs');

function run(dir, args) {
  try {
    const stdout = execFileSync('node', [CLI, ...args], {
      cwd: dir,
      encoding: 'utf8',
    });
    return { stdout, exitCode: 0 };
  } catch (error) {
    return {
      stdout: error.stdout ?? '',
      stderr: error.stderr ?? '',
      exitCode: error.status ?? 1,
    };
  }
}

function withTmpRepo(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'worklog-e2e-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('end to end: add, list, summary, export across days', () => {
  withTmpRepo((dir) => {
    assert.equal(run(dir, ['add', '90', '--project', 'docs', '--date', '2026-10-01']).stdout, 'added e0001\n');
    assert.equal(
      run(dir, ['add', '45', '--project', 'api', '--note', 'review and triage', '--date', '2026-10-01']).stdout,
      'added e0002\n',
    );
    assert.equal(run(dir, ['add', '30', '--project', 'api', '--date', '2026-10-02']).stdout, 'added e0003\n');

    assert.equal(
      run(dir, ['summary', '--day', '2026-10-01']).stdout,
      'PROJECT  TIME    ENTRIES\n' +
        'docs     1h 30m  1\n' +
        'api      45m     1\n' +
        'total: 2h 15m\n',
    );

    assert.equal(
      run(dir, ['summary']).stdout,
      'PROJECT  TIME    ENTRIES\n' +
        'docs     1h 30m  1\n' +
        'api      1h 15m  2\n' +
        'total: 2h 45m\n',
    );

    assert.equal(
      run(dir, ['list', '--day', '2026-10-01']).stdout,
      'ID     DATE        MINUTES  PROJECT  NOTE\n' +
        'e0001  2026-10-01  90       docs\n' +
        'e0002  2026-10-01  45       api      review and triage\n',
    );

    assert.equal(
      run(dir, ['export']).stdout,
      'id,date,minutes,project,note\n' +
        'e0001,2026-10-01,90,docs,\n' +
        'e0002,2026-10-01,45,api,review and triage\n' +
        'e0003,2026-10-02,30,api,\n' +
        '\n',
    );
  });
});

test('the equals flag form works end to end', () => {
  withTmpRepo((dir) => {
    run(dir, ['add', '90', '--project', 'docs', '--date', '2026-10-01']);
    run(dir, ['add', '45', '--project', 'api', '--date', '2026-10-01']);
    run(dir, ['add', '30', '--project', 'api', '--date', '2026-10-02']);
    const r = run(dir, ['summary', '--day=2026-10-01']);
    assert.equal(r.exitCode, 0);
    assert.match(r.stdout, /docs     1h 30m  1/);
    assert.equal(r.stdout.includes('e0003'), false);
    assert.equal(r.stdout.includes('1h 15m'), false);
  });
});

test('invalid dates are rejected by the real process with exit 2', () => {
  withTmpRepo((dir) => {
    const r = run(dir, ['add', '45', '--project', 'api', '--date', '2026-1-5']);
    assert.equal(r.exitCode, 2);
    assert.match(r.stderr, /error: date must be a valid YYYY-MM-DD/);
    const r2 = run(dir, ['add', '45', '--project', 'api', '--date', '2026-02-30']);
    assert.equal(r2.exitCode, 2);
  });
});

test('unknown flags exit 2 with usage; --help exits 0', () => {
  withTmpRepo((dir) => {
    const bad = run(dir, ['summary', '--wat', '1']);
    assert.equal(bad.exitCode, 2);
    const help = run(dir, ['--help']);
    assert.equal(help.exitCode, 0);
    assert.match(help.stdout, /usage:/);
  });
});

test('summary sub-hour totals use the compact duration form', () => {
  withTmpRepo((dir) => {
    run(dir, ['add', '45', '--project', 'api', '--date', '2026-10-01']);
    const r = run(dir, ['summary']);
    assert.equal(r.exitCode, 0);
    assert.match(r.stdout, /api      45m   1/);
    assert.equal(r.stdout.includes('0h 45m'), false);
  });
});

test('the library surface exports the documented API', async () => {
  const lib = await import(join(REPO, 'src', 'lib.mjs'));
  for (const name of [
    'ValidationError',
    'addEntry',
    'isValidDate',
    'loadStore',
    'newStore',
    'nextId',
    'serializeStore',
    'validateEntry',
    'formatDuration',
    'summarize',
    'csvField',
    'renderTable',
    'toCSV',
    'toJSON',
  ]) {
    assert.equal(typeof lib[name], name === 'ValidationError' ? 'function' : 'function', `missing export: ${name}`);
  }
});
