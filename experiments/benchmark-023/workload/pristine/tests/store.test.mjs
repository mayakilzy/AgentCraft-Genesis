import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ValidationError,
  addEntry,
  isValidDate,
  loadStore,
  newStore,
  nextId,
  serializeStore,
  validateEntry,
} from '../src/store.mjs';

test('isValidDate accepts strict zero-padded calendar dates', () => {
  assert.equal(isValidDate('2026-10-01'), true);
  assert.equal(isValidDate('2024-02-29'), true);
  assert.equal(isValidDate('2026-12-31'), true);
});

test('isValidDate rejects non-padded dates', () => {
  assert.equal(isValidDate('2026-1-5'), false);
  assert.equal(isValidDate('2026-01-5'), false);
  assert.equal(isValidDate('26-01-05'), false);
});

test('isValidDate rejects calendar-invalid and malformed dates', () => {
  assert.equal(isValidDate('2026-02-30'), false);
  assert.equal(isValidDate('2026-13-01'), false);
  assert.equal(isValidDate('2026-00-10'), false);
  assert.equal(isValidDate('2026/10/01'), false);
  assert.equal(isValidDate(''), false);
  assert.equal(isValidDate(20261001), false);
});

test('validateEntry enforces minutes and project rules', () => {
  const base = { date: '2026-10-01', minutes: 30, project: 'api' };
  assert.equal(validateEntry({ ...base }), true);
  assert.throws(() => validateEntry({ ...base, minutes: 0 }), ValidationError);
  assert.throws(() => validateEntry({ ...base, minutes: 1441 }), ValidationError);
  assert.throws(() => validateEntry({ ...base, minutes: 7.5 }), ValidationError);
  assert.throws(() => validateEntry({ ...base, project: '' }), ValidationError);
  assert.throws(() => validateEntry({ ...base, note: 'x'.repeat(201) }), ValidationError);
});

test('validateEntry rejects invalid dates', () => {
  assert.throws(
    () => validateEntry({ date: '2026-1-5', minutes: 30, project: 'api' }),
    ValidationError,
  );
  assert.throws(
    () => validateEntry({ date: '2026-02-30', minutes: 30, project: 'api' }),
    ValidationError,
  );
});

test('addEntry assigns sequential ids and preserves key order', () => {
  const store = newStore();
  const a = addEntry(store, { date: '2026-10-01', minutes: 30, project: 'api' });
  const b = addEntry(store, {
    date: '2026-10-01',
    minutes: 45,
    project: 'docs',
    note: 'review',
  });
  assert.equal(a.id, 'e0001');
  assert.equal(b.id, 'e0002');
  assert.equal(nextId(store), 'e0003');
  assert.deepEqual(Object.keys(b), ['id', 'date', 'minutes', 'project', 'note']);
  assert.equal(Object.hasOwn(a, 'note'), false);
});

test('addEntry validates its input', () => {
  const store = newStore();
  assert.throws(
    () => addEntry(store, { date: '2026-10-01', minutes: 30 }),
    ValidationError,
  );
});

test('loadStore skips blank lines and parses entries', () => {
  const text =
    '{"id":"e0001","date":"2026-10-01","minutes":30,"project":"api"}\n\n' +
    '{"id":"e0002","date":"2026-10-02","minutes":45,"project":"docs","note":"n"}\n';
  const store = loadStore(text);
  assert.equal(store.entries.length, 2);
  assert.equal(store.entries[1].note, 'n');
});

test('loadStore rejects invalid JSON lines with the line number', () => {
  assert.throws(() => loadStore('not json\n'), /line 1/);
});

test('loadStore rejects structurally invalid entries', () => {
  assert.throws(
    () => loadStore('{"id":"e0001","date":"2026-1-5","minutes":30,"project":"api"}\n'),
    ValidationError,
  );
  assert.throws(() => loadStore('{"nope":true}\n'), ValidationError);
});

test('serializeStore round-trips and formats canonically', () => {
  const store = newStore();
  addEntry(store, { date: '2026-10-01', minutes: 30, project: 'api' });
  addEntry(store, { date: '2026-10-01', minutes: 45, project: 'docs', note: 'r' });
  const text = serializeStore(store);
  assert.equal(
    text,
    '{"id":"e0001","date":"2026-10-01","minutes":30,"project":"api"}\n' +
      '{"id":"e0002","date":"2026-10-01","minutes":45,"project":"docs","note":"r"}\n',
  );
  const back = loadStore(text);
  assert.deepEqual(back.entries, store.entries);
  assert.equal(serializeStore(newStore()), '');
});
