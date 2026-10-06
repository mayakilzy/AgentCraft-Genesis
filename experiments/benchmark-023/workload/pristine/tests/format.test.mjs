import { test } from 'node:test';
import assert from 'node:assert/strict';

import { csvField, renderTable, toCSV, toJSON } from '../src/format.mjs';

test('renderTable pads columns to the widest cell and trims the line end', () => {
  const table = renderTable(
    ['ID', 'DATE', 'MINUTES'],
    [
      ['e0001', '2026-10-01', 90],
      ['e2', '2026-10-02', 5],
    ],
  );
  assert.equal(
    table,
    'ID     DATE        MINUTES\ne0001  2026-10-01  90\ne2     2026-10-02  5',
  );
});

test('renderTable with zero rows returns only the header line', () => {
  assert.equal(renderTable(['A', 'B'], []), 'A  B');
});

test('csvField leaves plain fields untouched', () => {
  assert.equal(csvField('api'), 'api');
  assert.equal(csvField('2026-10-01'), '2026-10-01');
  assert.equal(csvField(''), '');
});

test('csvField quotes fields containing commas', () => {
  assert.equal(csvField('review and triage, round one'), '"review and triage, round one"');
});

test('csvField quotes and doubles fields containing double quotes', () => {
  assert.equal(csvField('fixed "priority" bug'), '"fixed ""priority"" bug"');
  assert.equal(csvField('say ""hi""'), '"say """"hi"""""');
});

test('csvField quotes fields containing newlines', () => {
  assert.equal(csvField('two\nlines'), '"two\nlines"');
});

test('toCSV renders the fixed header and quoted fields per RFC 4180', () => {
  const csv = toCSV([
    {
      id: 'e0001',
      date: '2026-10-01',
      minutes: 30,
      project: 'api',
      note: 'fixed "priority" bug, see SPEC',
    },
    { id: 'e0002', date: '2026-10-01', minutes: 45, project: 'docs' },
  ]);
  assert.equal(
    csv,
    'id,date,minutes,project,note\n' +
      'e0001,2026-10-01,30,api,"fixed ""priority"" bug, see SPEC"\n' +
      'e0002,2026-10-01,45,docs,\n',
  );
});

test('toCSV quotes project names when needed', () => {
  const csv = toCSV([
    { id: 'e0001', date: '2026-10-01', minutes: 30, project: 'a,b' },
  ]);
  assert.equal(csv, 'id,date,minutes,project,note\ne0001,2026-10-01,30,"a,b",\n');
});

test('toJSON pretty-prints the entry array', () => {
  const out = toJSON([{ id: 'e0001', date: '2026-10-01', minutes: 30, project: 'api' }]);
  assert.equal(
    out,
    '[\n  {\n    "id": "e0001",\n    "date": "2026-10-01",\n    "minutes": 30,\n    "project": "api"\n  }\n]',
  );
});
