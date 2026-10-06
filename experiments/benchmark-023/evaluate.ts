/**
 * TASK-023 clean-room evaluator — the FINAL acceptance gates, identical
 * and arm-blind: the same frozen checks run against all three arms'
 * final integrated states. It takes a path to an ARM-RESULT.json (which
 * carries the arm label for bookkeeping only — no gate consults it) and
 * evaluates the repository, never the story.
 *
 * Gates (frozen in BENCHMARK-DESIGN.md §5 before any arm ran):
 *   G1 BUILD          every src/*.mjs parses
 *   G2 BUILD          the CLI runs (--help exits 0)
 *   G3 TEST/BEHAVIOR  the gold test suite passes 100% (the executable
 *                     specification, evaluator-held, never shown to arms)
 *   G4 TEST           the arm's own test suite passes 100%
 *   G5 TEST/BEHAVIOR  test-suite quality: arm tests pass >= 90% against
 *                     the PRISTINE implementation, and >= 2 arm tests
 *                     fail against the broken BASE (defect coverage)
 *   G6 DOC/BEHAVIOR   executable documentation: README.md and docs/api.md
 *                     examples produce exactly their documented output
 *   G7 DOC            every src/lib.mjs export is documented in docs/api.md
 *   G8 HYGIENE        the integration worktree is fully committed
 *   G9 HYGIENE        base files intact; additions within the allowlist
 *   G10 INTEGRATION   the pinned base commit is an ancestor of HEAD
 *
 * usage: bun experiments/benchmark-023/evaluate.ts <arm-result.json>
 */

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const HERE = new URL('.', import.meta.url).pathname;
const GOLD_ROOT = '/home/z/my-project/target-repos/.worklog-gold';
const BASE_REPO = '/home/z/my-project/target-repos/worklog';
const VERIFY_DOCS = join(HERE, 'workload', 'verify-docs.mjs');

interface ArmResult {
  arm: string;
  missionId: string;
  runRoot: string;
  baseCommit: string;
}

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
    return { stdout: e.stdout ?? '', code: e.status ?? -1 };
  }
}

interface SuiteOutcome {
  pass: number;
  fail: number;
  failing: string[];
  ran: boolean;
}

function runSuite(tree: string): SuiteOutcome {
  const out = sh('npm test 2>&1 || true', tree);
  const text = out.stdout;
  if (!/(#|ℹ) (pass|fail)|not ok/.test(text)) {
    return { pass: 0, fail: 0, failing: [], ran: false };
  }
  const failing: string[] = [];
  for (const line of text.split('\n')) {
    const m =
      /^✖ (.+?)(?:\s+\(|$)/.exec(line) ??
      /^ℹ ✖ (.+?)(?:\s+\(|$)/.exec(line) ??
      /^not ok \d+ - (.+)$/.exec(line);
    if (m) failing.push(m[1].trim());
  }
  let pass = 0;
  let fail = 0;
  for (const line of text.split('\n')) {
    const p = /^ℹ pass (\d+)$/.exec(line) ?? /^# pass (\d+)$/.exec(line);
    const f = /^ℹ fail (\d+)$/.exec(line) ?? /^# fail (\d+)$/.exec(line);
    if (p) pass = Number(p[1]);
    if (f) fail = Number(f[1]);
  }
  if (fail === 0 && failing.length > 0) fail = failing.length;
  return { pass, fail, failing, ran: true };
}

function docFailures(tree: string): number {
  // 2>&1: the harness reports failures on stderr — merge it or the gate
  // is toothless.
  const out = sh(
    `node ${JSON.stringify(VERIFY_DOCS)} README.md docs/api.md 2>&1`,
    tree,
    [0, 1],
  );
  const mismatches = (out.stdout.match(/example output mismatch/g) ?? []).length;
  const exits = (out.stdout.match(/command exited nonzero/g) ?? []).length;
  return mismatches + exits;
}

interface Gate {
  id: string;
  label: string;
  klass: string;
  ok: boolean;
  detail: string;
}

function main(): void {
  const resultPath = process.argv[2];
  if (resultPath === undefined || !existsSync(resultPath)) {
    console.error('usage: bun evaluate.ts <arm-result.json>');
    process.exit(2);
  }
  const arm = JSON.parse(readFileSync(resultPath, 'utf8')) as ArmResult;
  const worktree = join(arm.runRoot, 'mission', 'wt', 'integration');
  if (!existsSync(worktree)) {
    throw new Error(`integration worktree not found at ${worktree}`);
  }

  const scratch = `/tmp/eval-${arm.arm}-${arm.missionId}`;
  rmSync(scratch, { recursive: true, force: true });
  mkdirSync(scratch, { recursive: true });
  const clone = join(scratch, 'repo');
  sh(`git clone -q --no-hardlinks ${JSON.stringify(worktree)} ${JSON.stringify(clone)} && git -C ${JSON.stringify(clone)} checkout -q genesis/integration`, scratch);

  const gates: Gate[] = [];

  // G1 — every source module parses
  {
    const out = sh(
      'for f in src/*.mjs; do node --check "$f" || exit 1; done && echo PARSE_OK',
      clone,
    );
    gates.push({
      id: 'G1',
      label: 'every src/*.mjs parses (node --check)',
      klass: 'BUILD',
      ok: out.stdout.includes('PARSE_OK'),
      detail: out.stdout.includes('PARSE_OK') ? 'all modules parse' : 'at least one module fails to parse',
    });
  }

  // G2 — the CLI runs
  {
    const out = sh('node src/cli.mjs --help > /dev/null && echo CLI_OK', clone);
    gates.push({
      id: 'G2',
      label: 'CLI --help exits 0',
      klass: 'BUILD',
      ok: out.stdout.includes('CLI_OK'),
      detail: out.stdout.includes('CLI_OK') ? 'cli runs' : 'cli --help failed',
    });
  }

  // G3 — the gold suite (the executable specification)
  let goldDetail = '';
  {
    const g3 = join(scratch, 'g3');
    cpSync(clone, g3, { recursive: true });
    rmSync(join(g3, 'tests'), { recursive: true, force: true });
    cpSync(join(GOLD_ROOT, 'tests'), join(g3, 'tests'), { recursive: true });
    const suite = runSuite(g3);
    goldDetail = suite.ran
      ? `${suite.pass} pass / ${suite.fail} fail` + (suite.failing.length > 0 ? `; failing: ${suite.failing.slice(0, 6).join(' | ')}` : '')
      : 'suite did not run';
    gates.push({
      id: 'G3',
      label: 'gold test suite passes 100% (behavioral conformance to SPEC)',
      klass: 'TEST/BEHAVIORAL',
      ok: suite.ran && suite.fail === 0 && suite.pass >= 50,
      detail: goldDetail || 'suite did not run',
    });
    rmSync(g3, { recursive: true, force: true });
  }

  // G4 — the arm's own suite passes on its own final repo (and is a real
  // suite: zero-test runs do not count — node --test exits 0 with no files)
  {
    const suite = runSuite(clone);
    gates.push({
      id: 'G4',
      label: "the arm's own test suite passes 100% (>= 5 tests)",
      klass: 'TEST',
      ok: suite.ran && suite.fail === 0 && suite.pass >= 5,
      detail: suite.ran ? `${suite.pass} pass / ${suite.fail} fail` : 'no runnable test suite found (npm test)',
    });
  }

  // G5 — test-suite quality (pristine pass rate + defect coverage)
  {
    const g5a = join(scratch, 'g5a');
    cpSync(clone, g5a, { recursive: true });
    rmSync(join(g5a, 'src'), { recursive: true, force: true });
    cpSync(join(GOLD_ROOT, 'src'), join(g5a, 'src'), { recursive: true });
    const pristine = runSuite(g5a);
    rmSync(g5a, { recursive: true, force: true });

    const g5b = join(scratch, 'g5b');
    cpSync(clone, g5b, { recursive: true });
    rmSync(join(g5b, 'src'), { recursive: true, force: true });
    cpSync(join(BASE_REPO, 'src'), join(g5b, 'src'), { recursive: true });
    const base = runSuite(g5b);
    rmSync(g5b, { recursive: true, force: true });

    const total = pristine.pass + pristine.fail;
    const rate = total === 0 ? 0 : pristine.pass / total;
    const ok = pristine.ran && rate >= 0.9 && base.fail >= 2;
    gates.push({
      id: 'G5',
      label: 'test quality: >= 90% pass on pristine, >= 2 fail on base',
      klass: 'TEST/BEHAVIORAL',
      ok,
      detail: `on pristine: ${pristine.pass}/${total} (${Math.round(rate * 100)}%); on base: ${base.fail} failing`,
    });
  }

  // G6 — executable documentation
  {
    const failures = docFailures(clone);
    gates.push({
      id: 'G6',
      label: 'README and docs examples produce exactly their documented output',
      klass: 'DOCUMENTATION/BEHAVIORAL',
      ok: failures === 0,
      detail: failures === 0 ? 'all examples truthful' : `${failures} untruthful example failure(s)`,
    });
  }

  // G7 — documented API surface (export names via a real module load)
  {
    let ok = false;
    let detail = 'docs/api.md missing';
    const out = sh(
      'node -e ' +
        JSON.stringify(
          'import("./src/lib.mjs").then(m => console.log(Object.keys(m).join("\\n")))',
        ),
      clone,
    );
    const names = out.stdout.trim().split('\n').filter(Boolean);
    try {
      const apiText = readFileSync(join(clone, 'docs', 'api.md'), 'utf8');
      const missing = names.filter((n) => !apiText.includes(n));
      ok = missing.length === 0 && names.length >= 10;
      detail = `${names.length} exports, ${missing.length} undocumented${missing.length > 0 ? ` (${missing.slice(0, 4).join(', ')})` : ''}`;
    } catch (error) {
      detail = `could not read docs/api.md: ${(error as Error).message.slice(0, 120)}`;
    }
    gates.push({
      id: 'G7',
      label: 'every src/lib.mjs export appears in docs/api.md',
      klass: 'DOCUMENTATION',
      ok,
      detail,
    });
  }

  // G8 — the integration worktree is fully committed
  {
    const out = sh('git status --porcelain', worktree);
    gates.push({
      id: 'G8',
      label: 'integration worktree is fully committed',
      klass: 'REPOSITORY HYGIENE',
      ok: out.stdout.trim() === '',
      detail: out.stdout.trim() === '' ? 'clean' : `uncommitted: ${out.stdout.trim().split('\n').slice(0, 4).join(', ')}`,
    });
  }

  // G9 — base integrity + additions allowlist
  {
    const baseFiles = sh('git ls-files', BASE_REPO).stdout.trim().split('\n').filter(Boolean).sort();
    const finalFiles = sh('git ls-files', clone).stdout.trim().split('\n').filter(Boolean).sort();
    const finalSet = new Set(finalFiles);
    const missing = baseFiles.filter((f) => !finalSet.has(f));
    const additions = finalFiles.filter((f) => !baseFiles.includes(f));
    const allowed = (f: string) =>
      /^(src|docs|tests)\//.test(f) || f === 'package-lock.json';
    const illegal = additions.filter((f) => !allowed(f));
    const ok = missing.length === 0 && illegal.length === 0;
    gates.push({
      id: 'G9',
      label: 'base files intact; additions within src/ docs/ tests/ (+ lockfile)',
      klass: 'REPOSITORY HYGIENE',
      ok,
      detail:
        `missing: ${missing.length === 0 ? 'none' : missing.slice(0, 4).join(', ')}; ` +
        `additions: ${additions.length === 0 ? 'none' : additions.slice(0, 6).join(', ')}${illegal.length > 0 ? ` (ILLEGAL: ${illegal.slice(0, 4).join(', ')})` : ''}`,
    });
  }

  // G10 — lineage
  {
    const out = sh(
      `git merge-base --is-ancestor ${arm.baseCommit} HEAD && echo ANCESTOR_OK`,
      clone,
    );
    gates.push({
      id: 'G10',
      label: 'the pinned base commit is an ancestor of HEAD',
      klass: 'INTEGRATION',
      ok: out.stdout.includes('ANCESTOR_OK'),
      detail: out.stdout.includes('ANCESTOR_OK') ? 'built on the pinned base' : 'history diverged from the pinned base',
    });
  }

  const passed = gates.filter((g) => g.ok).length;
  const evaluation = {
    arm: arm.arm,
    missionId: arm.missionId,
    runRoot: arm.runRoot,
    evaluatedAt: new Date().toISOString(),
    gatesPassed: `${passed}/${gates.length}`,
    ok: passed === gates.length,
    goldDetail,
    gates,
  };
  const outPath = join(dirname(resultPath), `evaluation-${arm.arm}.json`);
  writeFileSync(outPath, JSON.stringify(evaluation, null, 2), 'utf8');

  console.log(`\nevaluation — arm ${arm.arm} (mission ${arm.missionId})`);
  for (const gate of gates) {
    console.log(`  ${gate.ok ? 'PASS' : 'FAIL'}  ${gate.id} [${gate.klass}] ${gate.label}`);
    if (!gate.ok) console.log(`         -> ${gate.detail}`);
  }
  console.log(`\narm ${arm.arm}: ${passed}/${gates.length} gates -> ${evaluation.ok ? 'GOLD-EVAL PASS' : 'GOLD-EVAL FAIL'}`);
  console.log(`evidence: ${outPath}`);
  rmSync(scratch, { recursive: true, force: true });
}

main();
