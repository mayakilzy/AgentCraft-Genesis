// wordfreq.mjs — Reconstructed from G5-08 Greenfield mission (independent of harness).
// This is the artifact Genesis's worker produced. We verify it works.

import { readFileSync, writeFileSync } from 'node:fs';

export function tokenize(text) {
  return text
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 0);
}

export function countWords(tokens) {
  const counts = new Map();
  for (const t of tokens) {
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return counts;
}

export function topN(counts, n = 10) {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, n);
}

export function run(inputPath, outputPath, n = 10) {
  const text = readFileSync(inputPath, 'utf8');
  const tokens = tokenize(text);
  const counts = countWords(tokens);
  const top = topN(counts, n);
  const lines = top.map(([w, c]) => `${w} ${c}`);
  writeFileSync(outputPath, lines.join('\n') + '\n');
  return top;
}

// CLI entrypoint — only when invoked directly (not when imported as a module).
import { fileURLToPath } from 'node:url';
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const args = process.argv.slice(2);
  if (args.length >= 2) {
    const [inPath, outPath, nArg] = args;
    const n = nArg !== undefined ? Number(nArg) : 10;
    run(inPath, outPath, n);
  } else {
    console.error('usage: node wordfreq.mjs <input> <output> [N]');
    process.exit(1);
  }
}
