#!/usr/bin/env node
// verify-docs.mjs — executable documentation harness for worklog.
//
// Convention (documented in the repo's README and docs):
//   - a fenced ```bash block whose command lines start with "$ " is an
//     EXAMPLE: every $-line is executed with bash, in document order,
//     in the CURRENT WORKING DIRECTORY (run this from a scratch copy of
//     the repository — examples create and remove demo ledger files);
//   - the fenced ```text block IMMEDIATELY following such a bash block
//     is the EXPECTED combined stdout, compared after per-line trailing
//     whitespace and trailing blank lines are normalized;
//   - a bash block with NO following text block only needs every command
//     to exit 0;
//   - ```text blocks not preceded by a bash block are prose, ignored.
//
// Usage: node verify-docs.mjs README.md docs/api.md
// Exit 0 = all examples truthful; 1 = any mismatch (details printed).

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

function blocks(markdown) {
  const out = [];
  const re = /```(\w+)\n([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(markdown)) !== null) {
    out.push({ lang: m[1], body: m[2] });
  }
  return out;
}

function commandsOf(bashBody) {
  return bashBody
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('$ '))
    .map((line) => line.slice(2).trim())
    .filter((line) => line.length > 0);
}

function normalize(text) {
  return text
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n+$/, '');
}

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('usage: verify-docs.mjs <markdown-file> [...]');
  process.exit(2);
}

let failures = 0;
let examples = 0;

for (const file of files) {
  const markdown = readFileSync(file, 'utf8');
  const all = blocks(markdown);
  for (let i = 0; i < all.length; i += 1) {
    const block = all[i];
    if (block.lang !== 'bash') continue;
    const commands = commandsOf(block.body);
    if (commands.length === 0) continue;
    const next = all[i + 1];
    const hasExpectation = next !== undefined && next.lang === 'text';

    let stdout = '';
    for (const command of commands) {
      try {
        stdout += execFileSync('bash', ['-c', command], {
          encoding: 'utf8',
          timeout: 60_000,
        });
      } catch (error) {
        failures += 1;
        examples += 1;
        console.error(
          `FAIL ${file}: command exited nonzero: $ ${command}\n  ${String(error.stderr ?? error.message).split('\n')[0]}`,
        );
        stdout = null;
        break;
      }
    }
    if (stdout === null) continue;
    examples += 1;

    if (!hasExpectation) continue;

    const expected = normalize(next.body);
    const actual = normalize(stdout);
    if (actual !== expected) {
      failures += 1;
      console.error(`FAIL ${file}: example output mismatch`);
      console.error('  expected:');
      for (const line of expected.split('\n').slice(0, 12)) {
        console.error(`    |${line}|`);
      }
      console.error('  actual:');
      for (const line of actual.split('\n').slice(0, 12)) {
        console.error(`    |${line}|`);
      }
    }
  }
}

console.log(`verify-docs: ${examples} example(s), ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
