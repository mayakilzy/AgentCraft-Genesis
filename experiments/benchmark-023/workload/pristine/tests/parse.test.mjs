import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ValidationError } from '../src/store.mjs';
import { parseArgs } from '../src/parse.mjs';

test('parses a command with long flags in space form', () => {
  const r = parseArgs(['add', '45', '--project', 'api', '--date', '2026-10-01']);
  assert.equal(r.command, 'add');
  assert.deepEqual(r.positionals, ['45']);
  assert.deepEqual(r.flags, { project: 'api', date: '2026-10-01' });
});

test('parses long flags in equals form', () => {
  const r = parseArgs(['summary', '--day=2026-10-01']);
  assert.equal(r.command, 'summary');
  assert.equal(r.flags.day, '2026-10-01');
});

test('parses long equals form for every valued flag', () => {
  const r = parseArgs([
    'add', '45',
    '--project=api',
    '--note=review',
    '--date=2026-10-01',
    '--store=demo.jsonl',
    '--format=csv',
  ]);
  assert.deepEqual(r.flags, {
    project: 'api',
    note: 'review',
    date: '2026-10-01',
    store: 'demo.jsonl',
    format: 'csv',
  });
});

test('parses short flags in space and inline form', () => {
  const a = parseArgs(['add', '45', '-p', 'api', '-n', 'review']);
  const b = parseArgs(['add', '45', '-papi', '-nreview']);
  assert.deepEqual(a.flags, { project: 'api', note: 'review' });
  assert.deepEqual(b.flags, { project: 'api', note: 'review' });
});

test('rejects unknown long and short flags', () => {
  assert.throws(() => parseArgs(['list', '--wat', 'x']), /unknown flag --wat/);
  assert.throws(() => parseArgs(['list', '-z', 'x']), /unknown flag -z/);
});

test('rejects flags without values', () => {
  assert.throws(() => parseArgs(['summary', '--day']), /--day requires a value/);
  assert.throws(() => parseArgs(['add', '45', '-p']), /-p requires a value/);
});

test('collects remaining words as positionals after the command', () => {
  const r = parseArgs(['add', '45', 'extra']);
  assert.deepEqual(r.positionals, ['45', 'extra']);
});

test('treats everything after -- as positionals', () => {
  const r = parseArgs(['list', '--', '--day', 'x']);
  assert.deepEqual(r.positionals, ['--day', 'x']);
  assert.deepEqual(r.flags, {});
});

test('empty argv yields no command', () => {
  const r = parseArgs([]);
  assert.equal(r.command, null);
  assert.deepEqual(r.positionals, []);
  assert.deepEqual(r.flags, {});
});

test('unknown flags raise ValidationError', () => {
  assert.throws(() => parseArgs(['--wat', '1']), ValidationError);
});
