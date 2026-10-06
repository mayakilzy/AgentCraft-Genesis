/**
 * TASK-023 workload generator — the deterministic transformation that
 * turns the pristine worklog project into the benchmark base.
 *
 * What it does, in order (all offline, all deterministic):
 *
 *  1. Copy workload/pristine (the correct project, gold tests included)
 *     into the sealed gold directory, together with the doc harness.
 *  2. VALIDATE the pristine tree: every source parses; the gold suite
 *     passes 100%; the executable-documentation harness reports zero
 *     failures on the pristine docs.
 *  3. Build the broken tree: pristine minus tests/, plus exactly five
 *     single-hunk implementation defects and two documentation-example
 *     corruptions (precise string replacements; each anchor must be
 *     found exactly once or the generator fails loudly).
 *  4. VALIDATE the broken tree: sources still parse; the CLI still runs;
 *     the gold suite fails on >= 8 tests; per-defect attribution records
 *     which tests each defect flips; the doc harness on the broken tree
 *     reports >= 3 output mismatches (the mostly-correct docs no longer
 *     describe the broken behavior).
 *  5. VALIDATE the traps: the gold implementation combined with the
 *     CORRUPTED docs fails the doc harness on >= 2 examples (the two
 *     corrupted blocks mirror the broken behavior, so they are stale
 *     exactly when the code is repaired — the documentation gate has
 *     teeth in the post-repair direction).
 *  6. Create the benchmark base repository at a NEUTRAL local path as a
 *     fresh git repo with a SINGLE commit of the broken tree — the
 *     pristine state is never committed to any worker-visible history.
 *  7. Emit the sealed manifest (defects, doc corruptions, per-defect
 *     failing tests, SHAs) into the gold directory, and the pinned base
 *     SHA into workload/base-commit.txt.
 *
 * Usage: bun experiments/benchmark-023/workload/generate.ts
 * Prints a summary safe for the builder's log (counts and SHAs, not the
 * defect map — that lives in the sealed manifest only).
 */

import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';

const HERE = dirname(new URL(import.meta.url).pathname);
const WORKLOAD = HERE;
const PRISTINE = join(WORKLOAD, 'pristine');
const GOLD_ROOT = '/home/z/my-project/target-repos/.worklog-gold';
const BASE_REPO = '/home/z/my-project/target-repos/worklog';
const SCRATCH = '/tmp/workload-generate';

interface Mutation {
  readonly id: string;
  readonly file: string;
  readonly find: string;
  readonly replace: string;
  readonly note: string;
}

/** The five implementation defects (sealed until evidence commit). */
const DEFECTS: readonly Mutation[] = [
  {
    id: 'D1',
    file: 'src/report.mjs',
    find: `  rows.sort(\n    (a, b) => b.minutes - a.minutes || a.project.localeCompare(b.project),\n  );`,
    replace: `  rows.sort(\n    (a, b) => a.minutes - b.minutes || b.project.localeCompare(a.project),\n  );`,
    note: 'summarize sorts ascending with reversed tie-break (spec: minutes desc, name asc)',
  },
  {
    id: 'D5',
    file: 'src/report.mjs',
    find: '  if (h === 0) return `${r}m`;',
    replace: '  if (h === 0) return `0h ${r}m`;',
    note: 'formatDuration emits a zero hours segment for sub-hour totals',
  },
  {
    id: 'D2',
    file: 'src/format.mjs',
    find: `export function csvField(value) {\n  const s = String(value);\n  if (/[",\\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';\n  return s;\n}`,
    replace: `export function csvField(value) {\n  const s = String(value);\n  if (s.includes(',')) return '"' + s + '"';\n  return s;\n}`,
    note: 'csvField quotes only commas, never doubles embedded quotes (spec: RFC 4180)',
  },
  {
    id: 'D3',
    file: 'src/store.mjs',
    find: `export function isValidDate(value) {\n  if (typeof value !== 'string') return false;\n  if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(value)) return false;\n  const [y, m, d] = value.split('-').map(Number);\n  if (m < 1 || m > 12 || d < 1 || d > 31) return false;\n  const dt = new Date(Date.UTC(y, m - 1, d));\n  return (\n    dt.getUTCFullYear() === y &&\n    dt.getUTCMonth() === m - 1 &&\n    dt.getUTCDate() === d\n  );\n}`,
    replace: `export function isValidDate(value) {\n  if (typeof value !== 'string') return false;\n  if (!/^\\d{4}-\\d{1,2}-\\d{1,2}$/.test(value)) return false;\n  const [y, m, d] = value.split('-').map(Number);\n  return y >= 1 && m >= 1 && m <= 12 && d >= 1 && d <= 31;\n}`,
    note: 'date validation accepts non-padded and calendar-invalid dates',
  },
  {
    id: 'D4',
    file: 'src/parse.mjs',
    find: `        flags[name] = arg.slice(eq + 1);`,
    replace: `        flags[name] = true;`,
    note: 'equals-form long flags silently drop their value',
  },
];

/** The two documentation corruptions (sealed until evidence commit). */
const DOC_CORRUPTIONS: readonly Mutation[] = [
  {
    id: 'DOC1',
    file: 'README.md',
    find: `PROJECT  TIME    ENTRIES\ndocs     1h 30m  1\napi      45m     1\ntotal: 2h 15m`,
    replace: `PROJECT  TIME    ENTRIES\napi      0h 45m  1\ndocs     1h 30m  1\ntotal: 2h 15m`,
    note: 'quickstart summary shows the broken sort order and broken duration style',
  },
  {
    id: 'DOC2',
    file: 'docs/api.md',
    find: `id,date,minutes,project,note\ne0001,2026-10-01,30,api,"fixed ""priority"" bug, see SPEC"\ne0002,2026-10-01,45,docs,`,
    replace: `id,date,minutes,project,note\ne0001,2026-10-01,30,api,"fixed "priority" bug, see SPEC"\ne0002,2026-10-01,45,docs,`,
    note: 'toCSV example shows un-doubed embedded quotes (mirrors the broken csvField)',
  },
];

function sh(cmd: string, cwd: string, okCodes: readonly number[] = [0]): {
  stdout: string;
  code: number;
} {
  try {
    return {
      stdout: execFileSync('bash', ['-c', cmd], {
        cwd,
        encoding: 'utf8',
        timeout: 300_000,
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
      code: 0,
    };
  } catch (error) {
    const e = error as { stdout?: string; status?: number };
    if (okCodes.includes(e.status ?? -1)) {
      return { stdout: e.stdout ?? '', code: e.status ?? -1 };
    }
    throw error;
  }
}

function applyMutation(root: string, mutation: Mutation): void {
  const path = join(root, mutation.file);
  const text = readFileSync(path, 'utf8');
  const count = text.split(mutation.find).length - 1;
  if (count !== 1) {
    throw new Error(
      `${mutation.id}: anchor found ${count} times in ${mutation.file} (expected exactly 1) — refusing to generate`,
    );
  }
  writeFileSync(path, text.replace(mutation.find, mutation.replace), 'utf8');
}

interface TestRun {
  pass: number;
  fail: number;
  failing: string[];
}

function runGoldTests(tree: string): TestRun {
  cpSync(join(GOLD_ROOT, 'tests'), join(tree, 'tests'), { recursive: true });
  // A failing suite exits 1 — that is the expected signal here, not an error.
  const out = sh('node --test --test-reporter=tap', tree, [0, 1]).stdout;
  const failing: string[] = [];
  let pass = 0;
  let fail = 0;
  for (const line of out.split('\n')) {
    const m = /^not ok \d+ - (.+)$/.exec(line);
    if (m) failing.push(m[1].trim());
    if (/^# pass \d+$/.test(line)) {
      pass = Number(line.split(' ')[2]);
    }
    if (/^# fail \d+$/.test(line)) {
      fail = Number(line.split(' ')[2]);
    }
  }
  rmSync(join(tree, 'tests'), { recursive: true, force: true });
  return { pass, fail, failing };
}

function docFailures(tree: string): number {
  const out = sh(
    `node ${JSON.stringify(join(WORKLOAD, 'verify-docs.mjs'))} README.md docs/api.md`,
    tree,
    [0, 1],
  );
  const m = /(\d+) failure\(s\)/.exec(out.stdout);
  const mismatches = (out.stdout.match(/example output mismatch/g) ?? []).length;
  return mismatches > 0 ? mismatches : Number(m?.[1] ?? 0);
}

function syntaxCheck(tree: string): void {
  for (const f of sh('ls src/*.mjs', tree).stdout.trim().split('\n')) {
    sh(`node --check ${JSON.stringify(f)}`, tree);
  }
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function main(): void {
  // ---- 1. sealed gold ----
  rmSync(GOLD_ROOT, { recursive: true, force: true });
  mkdirSync(GOLD_ROOT, { recursive: true });
  cpSync(PRISTINE, GOLD_ROOT, { recursive: true });
  mkdirSync(join(GOLD_ROOT, 'tools'), { recursive: true });
  cpSync(join(WORKLOAD, 'verify-docs.mjs'), join(GOLD_ROOT, 'tools', 'verify-docs.mjs'));

  // ---- 2. validate pristine ----
  const pristineCheck = join(SCRATCH, 'pristine');
  rmSync(SCRATCH, { recursive: true, force: true });
  cpSync(GOLD_ROOT, pristineCheck, { recursive: true });
  syntaxCheck(pristineCheck);
  const pristineTests = runGoldTests(pristineCheck);
  if (pristineTests.fail !== 0 || pristineTests.pass < 50) {
    throw new Error(
      `pristine gold suite not green: ${pristineTests.pass} pass / ${pristineTests.fail} fail`,
    );
  }
  const pristineDocs = docFailures(pristineCheck);
  if (pristineDocs !== 0) {
    throw new Error(`pristine docs not truthful: ${pristineDocs} failure(s)`);
  }

  // ---- 3. broken tree ----
  const broken = join(SCRATCH, 'broken');
  cpSync(PRISTINE, broken, { recursive: true });
  rmSync(join(broken, 'tests'), { recursive: true, force: true });
  for (const defect of DEFECTS) applyMutation(broken, defect);
  for (const doc of DOC_CORRUPTIONS) applyMutation(broken, doc);

  // ---- 4. validate broken ----
  syntaxCheck(broken);
  if (sh('node src/cli.mjs --help > /dev/null', broken).code !== 0) {
    throw new Error('broken tree: cli --help no longer exits 0');
  }
  const brokenTests = runGoldTests(broken);
  if (brokenTests.fail < 8) {
    throw new Error(
      `broken tree flips only ${brokenTests.fail} gold tests (expected >= 8) — defects too weak`,
    );
  }
  const perDefect: Record<string, string[]> = {};
  for (const defect of DEFECTS) {
    const one = join(SCRATCH, `defect-${defect.id}`);
    cpSync(PRISTINE, one, { recursive: true });
    rmSync(join(one, 'tests'), { recursive: true, force: true });
    applyMutation(one, defect);
    const run = runGoldTests(one);
    if (run.fail < 1) {
      throw new Error(`${defect.id} flips no gold test — not a real defect`);
    }
    perDefect[defect.id] = run.failing;
    rmSync(one, { recursive: true, force: true });
  }
  const brokenDocs = docFailures(broken);
  if (brokenDocs < 3) {
    throw new Error(
      `doc harness on broken tree: only ${brokenDocs} mismatch(es) (expected >= 3)`,
    );
  }

  // ---- 5. validate the traps (gold src + corrupted docs must fail) ----
  const trapCheck = join(SCRATCH, 'trap');
  cpSync(PRISTINE, trapCheck, { recursive: true });
  rmSync(join(trapCheck, 'tests'), { recursive: true, force: true });
  for (const doc of DOC_CORRUPTIONS) applyMutation(trapCheck, doc);
  const trapDocs = docFailures(trapCheck);
  if (trapDocs < 2) {
    throw new Error(
      `corrupted docs on gold src: only ${trapDocs} mismatch(es) (expected >= 2) — traps not detectable`,
    );
  }

  // ---- 6. the base repository (single commit, broken tree only) ----
  rmSync(BASE_REPO, { recursive: true, force: true });
  mkdirSync(BASE_REPO, { recursive: true });
  cpSync(broken, BASE_REPO, { recursive: true });
  sh('git init -q', BASE_REPO);
  sh('git config user.name "worklog release bot"', BASE_REPO);
  sh('git config user.email "release@worklog.example"', BASE_REPO);
  sh('git add -A', BASE_REPO);
  sh('git commit -q -m "worklog v1.4.2 release snapshot"', BASE_REPO);
  const baseSha = sh('git rev-parse HEAD', BASE_REPO).stdout.trim();
  const baseFiles = sh('git ls-files', BASE_REPO).stdout
    .trim()
    .split('\n')
    .filter((l) => l.length > 0)
    .sort();

  // ---- 7. sealed manifest ----
  const goldFiles = sh(
    `find . -type f -not -path './.git/*' | sort`,
    GOLD_ROOT,
  ).stdout.trim().split('\n').map((f) => f.replace(/^\.\//, ''));
  const manifest = {
    generated_at: new Date().toISOString(),
    workload: 'worklog v1.4.2 (TASK-023 benchmark target)',
    base_repo: BASE_REPO,
    base_sha: baseSha,
    base_file_count: baseFiles.length,
    base_files: baseFiles,
    gold_root: GOLD_ROOT,
    gold_files: goldFiles,
    gold_file_sha256: Object.fromEntries(
      goldFiles.map((f) => [f, sha256(readFileSync(join(GOLD_ROOT, f), 'utf8'))]),
    ),
    validations: {
      pristine_tests: `${pristineTests.pass} pass / ${pristineTests.fail} fail`,
      pristine_docs_failures: pristineDocs,
      broken_tests: `${brokenTests.pass} pass / ${brokenTests.fail} fail`,
      broken_doc_mismatches: brokenDocs,
      trap_doc_mismatches_on_gold_src: trapDocs,
    },
    defects: DEFECTS.map((d) => ({
      id: d.id,
      file: d.file,
      note: d.note,
      flips_gold_tests: perDefect[d.id],
    })),
    doc_corruptions: DOC_CORRUPTIONS.map((d) => ({
      id: d.id,
      file: d.file,
      note: d.note,
    })),
  };
  writeFileSync(
    join(GOLD_ROOT, 'manifest.json'),
    JSON.stringify(manifest, null, 2),
    'utf8',
  );
  writeFileSync(
    join(WORKLOAD, 'base-commit.txt'),
    `${baseSha}\n`,
    'utf8',
  );

  rmSync(SCRATCH, { recursive: true, force: true });

  console.log('TASK-023 workload generated and validated:');
  console.log(`  pristine gold tests : ${pristineTests.pass} pass / ${pristineTests.fail} fail`);
  console.log(`  pristine doc check  : ${pristineDocs} failure(s)`);
  console.log(`  broken gold tests   : ${brokenTests.pass} pass / ${brokenTests.fail} fail`);
  console.log(`  per-defect flips    : ${DEFECTS.map((d) => `${d.id}=${perDefect[d.id].length}`).join(' ')}`);
  console.log(`  broken doc mismatch : ${brokenDocs}`);
  console.log(`  trap doc mismatch   : ${trapDocs} (corrupted docs vs gold src)`);
  console.log(`  base repository     : ${BASE_REPO}`);
  console.log(`  pinned base SHA     : ${baseSha}`);
  console.log(`  sealed gold         : ${GOLD_ROOT} (manifest.json inside)`);
}

if (!existsSync(PRISTINE)) {
  throw new Error(`pristine tree not found at ${PRISTINE}`);
}
main();
