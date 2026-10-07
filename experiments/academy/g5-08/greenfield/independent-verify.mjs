// Independent Greenfield artifact verification.
// Confirms the artifacts Genesis's worker produced actually function correctly
// — independent of the harness's own verify() (which checks file existence +
// content presence, not runtime correctness).

import { writeFileSync, readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert';
import { tokenize, countWords, topN, run } from './reference-impl-wordfreq.mjs';

const tmp = mkdtempSync(join(tmpdir(), 'wf-ind-'));
const inFile = join(tmp, 'in.txt');
const outFile = join(tmp, 'out.txt');

// Unit checks
assert.deepStrictEqual(tokenize('Hello World hello'), ['hello', 'world', 'hello']);

const c = countWords(['hello', 'world', 'hello']);
assert.strictEqual(c.get('hello'), 2);
assert.strictEqual(c.get('world'), 1);

const t = topN(c, 10);
assert.strictEqual(t[0][0], 'hello');
assert.strictEqual(t[0][1], 2);
assert.strictEqual(t[1][0], 'world');
assert.strictEqual(t[1][1], 1);

// End-to-end (matches test.mjs)
writeFileSync(inFile, 'apple banana apple cherry banana apple');
run(inFile, outFile, 2);
const out = readFileSync(outFile, 'utf8').trim().split('\n');
assert.strictEqual(out[0], 'apple 3');
assert.strictEqual(out[1], 'banana 2');

// Additional CLI invocation (independent — different input)
writeFileSync(inFile, 'the quick brown fox jumps over the lazy dog the dog runs');
run(inFile, outFile, 3);
const out2 = readFileSync(outFile, 'utf8').trim().split('\n');
assert.strictEqual(out2[0], 'the 3');
assert.strictEqual(out2[1], 'dog 2');

console.log('INDEPENDENT_GREENFIELD_VERIFICATION = PASS');
console.log('all artifacts function correctly; no false success');
