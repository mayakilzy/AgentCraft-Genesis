import { test } from 'node:test';
import assert from 'node:assert/strict';

import { formatDuration, summarize } from '../src/report.mjs';

function entries() {
  return [
    { id: 'e0001', date: '2026-10-01', minutes: 30, project: 'api' },
    { id: 'e0002', date: '2026-10-01', minutes: 45, project: 'docs' },
    { id: 'e0003', date: '2026-10-02', minutes: 30, project: 'api' },
  ];
}

test('summarize aggregates per project with total and count', () => {
  const s = summarize(entries());
  assert.deepEqual(
    s.rows.map((r) => [r.project, r.minutes, r.entries]),
    [
      ['api', 60, 2],
      ['docs', 45, 1],
    ],
  );
  assert.equal(s.total, 105);
  assert.equal(s.count, 3);
});

test('summarize sorts by minutes descending, then project name ascending', () => {
  const es = [
    { id: 'e1', date: '2026-10-01', minutes: 10, project: 'beta' },
    { id: 'e2', date: '2026-10-01', minutes: 30, project: 'alpha' },
    { id: 'e3', date: '2026-10-01', minutes: 10, project: 'alpha' },
    { id: 'e4', date: '2026-10-01', minutes: 20, project: 'gamma' },
    { id: 'e5', date: '2026-10-01', minutes: 10, project: 'beta' },
  ];
  const s = summarize(es);
  // alpha 40, beta 20, gamma 20 -> beta before gamma by name ascending.
  assert.deepEqual(
    s.rows.map((r) => r.project),
    ['alpha', 'beta', 'gamma'],
  );
  assert.deepEqual(
    s.rows.map((r) => r.minutes),
    [40, 20, 20],
  );
});

test('summarize sorts strictly descending by minutes', () => {
  const es = [
    { id: 'e1', date: '2026-10-01', minutes: 5, project: 'zzz' },
    { id: 'e2', date: '2026-10-01', minutes: 500, project: 'aaa' },
    { id: 'e3', date: '2026-10-01', minutes: 50, project: 'mmm' },
  ];
  assert.deepEqual(
    summarize(es).rows.map((r) => r.project),
    ['aaa', 'mmm', 'zzz'],
  );
});

test('summarize filters by day when opts.day is given', () => {
  const s = summarize(entries(), { day: '2026-10-01' });
  assert.deepEqual(
    s.rows.map((r) => [r.project, r.minutes]),
    [
      ['docs', 45],
      ['api', 30],
    ],
  );
  assert.equal(s.total, 75);
  assert.equal(s.count, 2);
});

test('summarize with a day that has no entries is empty', () => {
  const s = summarize(entries(), { day: '2026-10-05' });
  assert.deepEqual(s.rows, []);
  assert.equal(s.total, 0);
  assert.equal(s.count, 0);
});

test('formatDuration renders the compact spec forms', () => {
  assert.equal(formatDuration(0), '0m');
  assert.equal(formatDuration(45), '45m');
  assert.equal(formatDuration(59), '59m');
  assert.equal(formatDuration(60), '1h');
  assert.equal(formatDuration(75), '1h 15m');
  assert.equal(formatDuration(135), '2h 15m');
  assert.equal(formatDuration(1440), '24h');
});

test('formatDuration never emits a zero-valued segment', () => {
  for (const [input, expected] of [[30, '30m'], [90, '1h 30m'], [60, '1h']]) {
    const out = formatDuration(input);
    assert.equal(out, expected);
    assert.equal(out.includes('0h '), false, `${input} -> ${out}`);
    assert.equal(/h 0m/.test(out), false, `${input} -> ${out}`);
  }
});
