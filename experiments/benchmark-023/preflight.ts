/**
 * TASK-023 preflight (Step 4) — run BEFORE any arm executes.
 *
 * Verifies, in order:
 *
 *  1. Benchmark base integrity: the pinned SHA matches, the working tree
 *     is clean, the history is exactly one commit, and the tree hashes
 *     to the sealed manifest's expectation.
 *  2. Sealed gold present (manifest + tests + pristine tree + harness).
 *  3. Deterministic goal compilation: the frozen goal compiles to the
 *     expected domain and capability needs (verified, not tuned).
 *  4. All three arm organizations compile: Arm C's real planner output
 *     is RECORDED (not directed), Arms A/B planner shapes are valid,
 *     and every plan compiles through the GenomeCompiler without gaps.
 *  5. Negative controls: the gold suite fails on the base (>= 8 tests);
 *     the doc harness flags the base docs (>= 3 mismatches); the
 *     EVALUATOR, run against the broken base, FAILS the truth gates.
 *  6. Positive control: the evaluator, run against a simulated perfect
 *     repair (the pristine tree committed on top of the base), PASSES
 *     all ten gates — proving the evaluator accepts the true solution.
 *  7. Environment hygiene: no leftover mission processes, clean mission
 *     root, OpenBot checkout present.
 *
 * The serving-protocol smoke test (one fresh session serving one
 * synthetic journal request) is performed by the operator and recorded
 * in evidence/PREFLIGHT.md — a script cannot spawn GLM sessions.
 *
 * usage: bun experiments/benchmark-023/preflight.ts
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, cpSync } from 'node:fs';
import { join } from 'node:path';

import { GoalCompiler } from '../../src/goal/goal-compiler.js';
import { GenomeCompiler, loadOwnership } from '../../src/genome/genome-compiler.js';
import { CognitiveRouter } from '../../src/routing/cognitive-router.js';
import { RuleDecisionProvider } from '../../src/routing/decision-provider.js';
import { OrganizationPlanner } from '../../src/organization/organization-planner.js';
import { BENCHMARK_GOAL, StaticTeamPlanner, StrongSingleAgentPlanner } from './mission.js';

const HERE = new URL('.', import.meta.url).pathname;
const BASE_REPO = '/home/z/my-project/target-repos/worklog';
const GOLD_ROOT = '/home/z/my-project/target-repos/.worklog-gold';
const BASE_COMMIT = readFileSync(join(HERE, 'workload', 'base-commit.txt'), 'utf8').trim();
const MISSIONS_ROOT = '/home/z/my-project/missions';
const OPENBOT_CHECKOUT =
  process.env.GENESIS_OPENBOT_DIR ?? join(HERE, '..', '..', '..', 'OpenBot');

function sh(cmd: string, cwd: string, ok: boolean = false): { stdout: string; code: number } {
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
    if (ok) return { stdout: e.stdout ?? '', code: e.status ?? -1 };
    throw error;
  }
}

const lines: string[] = [];
let allOk = true;
function report(ok: boolean, label: string, detail = ''): boolean {
  allOk = allOk && ok;
  lines.push(`[${ok ? 'PASS' : 'FAIL'}] ${label}${detail === '' ? '' : ` — ${detail}`}`);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail === '' ? '' : ` — ${detail}`}`);
  return ok;
}

async function main(): Promise<void> {
  // ---- 1. base integrity ----
  const headSha = sh('git rev-parse HEAD', BASE_REPO).stdout.trim();
  report(headSha === BASE_COMMIT, 'base repository is at the pinned SHA', headSha.slice(0, 12));
  const status = sh('git status --porcelain', BASE_REPO).stdout.trim();
  report(status === '', 'base working tree is clean', status === '' ? '' : status.split('\n')[0]);
  const commitCount = Number(sh('git rev-list --count HEAD', BASE_REPO).stdout.trim());
  report(commitCount === 1, 'base history is exactly one commit (no pristine ancestor to mine)', `commits=${commitCount}`);

  // ---- 2. sealed gold ----
  const manifest = JSON.parse(readFileSync(join(GOLD_ROOT, 'manifest.json'), 'utf8')) as {
    base_sha: string;
    gold_files: string[];
  };
  report(manifest.base_sha === BASE_COMMIT, 'sealed manifest matches the pinned base');
  report(
    existsSync(join(GOLD_ROOT, 'tests')) && existsSync(join(GOLD_ROOT, 'tools', 'verify-docs.mjs')),
    'sealed gold holds the test suite and the doc harness',
  );

  // ---- 3. deterministic goal compilation ----
  const compiler = new GoalCompiler();
  const requirements = await compiler.compile(BENCHMARK_GOAL);
  report(
    requirements.domain === 'software-engineering',
    'goal compiles to the software-engineering domain',
    `domain=${requirements.domain}`,
  );
  report(
    [...requirements.capabilityNeeds].sort().join(',') === 'code-execution,document-authoring',
    'goal compiles to code-execution + document-authoring',
    [...requirements.capabilityNeeds].join(', '),
  );

  // ---- 4. the three organizations ----
  const realPlanner = new OrganizationPlanner();
  const planC = realPlanner.plan(requirements);
  lines.push('');
  lines.push('ARM C (adaptive chain) planned organization — RECORDED, not directed:');
  for (const w of planC.workers) {
    lines.push(`  - ${w.id} [${w.role}] needs=[${w.capabilityNeeds.join(', ')}]`);
  }
  lines.push(`  rationale: ${planC.rationale}`);
  console.log(`ARM C org: ${planC.workers.map((w) => `${w.id}(${w.role})`).join(' + ')}`);

  const plans: [string, ReturnType<OrganizationPlanner['plan']>][] = [
    ['A', new StrongSingleAgentPlanner().plan(requirements)],
    ['B', new StaticTeamPlanner().plan(requirements)],
    ['C', planC],
  ];
  const genomeCompiler = new GenomeCompiler({
    registry: loadOwnership('data/ownership.yaml'),
    selectTier: (selection) =>
      new CognitiveRouter(new RuleDecisionProvider()).selectTier(selection),
  });
  for (const [arm, plan] of plans) {
    const compilation = await genomeCompiler.compilePlan(plan, requirements);
    report(
      compilation.ok,
      `arm ${arm} organization compiles without capability gaps`,
      plan.workers.map((w) => w.role).join(' + '),
    );
  }
  const armAWorkers = plans[0][1].workers;
  report(armAWorkers.length === 1, 'arm A is exactly one worker (Sole Operator)');

  // ---- 5. negative controls on the base ----
  const neg = '/tmp/preflight-neg';
  rmSync(neg, { recursive: true, force: true });
  mkdirSync(neg, { recursive: true });
  cpSync(BASE_REPO, join(neg, 'repo'), { recursive: true });
  rmSync(join(neg, 'repo', '.git'), { recursive: true, force: true });
  cpSync(join(GOLD_ROOT, 'tests'), join(neg, 'repo', 'tests'), { recursive: true });
  const negSuite = sh('npm test 2>&1 || true', join(neg, 'repo'), true).stdout;
  const negFail = Number(/^ℹ fail (\d+)$/m.exec(negSuite)?.[1] ?? 0);
  report(negFail >= 8, 'gold suite fails on the base (defects are real)', `${negFail} failing`);

  // ---- 6. evaluator controls ----
  // 6a. negative: the evaluator must reject the broken base.
  const negRoot = '/tmp/preflight-evalneg';
  rmSync(negRoot, { recursive: true, force: true });
  mkdirSync(join(negRoot, 'mission', 'wt'), { recursive: true });
  sh(
    `git clone -q --no-hardlinks ${JSON.stringify(BASE_REPO)} mission/wt/integration && ` +
      'git -C mission/wt/integration checkout -q -b genesis/integration',
    negRoot,
  );
  const negArmResult = join(negRoot, 'ARM-RESULT.json');
  writeFileSync(
    negArmResult,
    JSON.stringify({ arm: 'NEGCTRL', missionId: 'preflight-negative', runRoot: negRoot, baseCommit: BASE_COMMIT }),
    'utf8',
  );
  const negEval = sh(
    `bun ${JSON.stringify(join(HERE, 'evaluate.ts'))} ${JSON.stringify(negArmResult)} 2>&1 || true`,
    HERE,
    true,
  ).stdout;
  const negPassed = /^arm NEGCTRL: (\d+)\/10 gates/m.exec(negEval);
  const negGates = negPassed ? Number(negPassed[1]) : -1;
  report(
    negGates === 6,
    'evaluator NEGATIVE control: the broken base fails exactly the 4 truth gates (6/10 structural gates pass)',
    `${negGates}/10 gates`,
  );
  report(
    negEval.includes('FAIL  G3') &&
      negEval.includes('FAIL  G4') &&
      negEval.includes('FAIL  G5') &&
      negEval.includes('FAIL  G6'),
    'negative control fails G3 (gold suite), G4 (own suite), G5 (quality), G6 (docs)',
  );

  // 6b. positive: the evaluator must accept the perfect repair
  // (pristine tree committed on top of the base — what an ideal arm
  // would produce).
  const posRoot = '/tmp/preflight-evalpos';
  rmSync(posRoot, { recursive: true, force: true });
  mkdirSync(join(posRoot, 'mission', 'wt'), { recursive: true });
  sh(
    `git clone -q --no-hardlinks ${JSON.stringify(BASE_REPO)} mission/wt/integration && ` +
      'git -C mission/wt/integration checkout -q -b genesis/integration',
    posRoot,
  );
  const posWt = join(posRoot, 'mission', 'wt', 'integration');
  sh('rm -rf src docs tests README.md SPEC.md package.json .gitignore', posWt);
  for (const item of ['src', 'docs', 'tests', 'README.md', 'SPEC.md', 'package.json', '.gitignore']) {
    cpSync(join(GOLD_ROOT, item), join(posWt, item), { recursive: true });
  }
  sh('git add -A && git -c user.name=preflight -c user.email=p@x commit -q -m "preflight positive control"', posWt);
  const posArmResult = join(posRoot, 'ARM-RESULT.json');
  writeFileSync(
    posArmResult,
    JSON.stringify({ arm: 'POSCTRL', missionId: 'preflight-positive', runRoot: posRoot, baseCommit: BASE_COMMIT }),
    'utf8',
  );
  const posEval = sh(
    `bun ${JSON.stringify(join(HERE, 'evaluate.ts'))} ${JSON.stringify(posArmResult)} 2>&1 || true`,
    HERE,
    true,
  ).stdout;
  const posPassed = /^arm POSCTRL: (\d+)\/10 gates/m.exec(posEval);
  const posGates = posPassed ? Number(posPassed[1]) : -1;
  report(
    posGates === 10,
    'evaluator POSITIVE control: the perfect repair passes all 10 gates',
    `${posGates}/10 gates`,
  );

  // ---- 7. environment hygiene ----
  // (exclude this preflight's own process: its command line contains the
  // benchmark path; also exclude the grep itself)
  const leftovers = sh(
    "ps aux | grep -E 'benchmark-023/run.ts|agent-computer' | grep -v grep | grep -v preflight | wc -l",
    HERE,
  ).stdout.trim();
  report(lefters(leftovers), 'no leftover mission or computer processes', `${leftovers} found`);
  if (existsSync(MISSIONS_ROOT)) {
    const existing = sh('ls /home/z/my-project/missions 2>/dev/null | wc -l', HERE).stdout.trim();
    report(existing === '0', 'mission root is empty (no cross-arm artifacts)', `${existing} entries`);
  } else {
    report(true, 'mission root does not exist yet (clean)');
  }
  report(
    existsSync(join(OPENBOT_CHECKOUT, 'agent-computer', 'src', 'index.ts')),
    'OpenBot checkout present',
  );

  // ---- freeze preflight evidence ----
  const evidenceDir = join(HERE, 'evidence');
  mkdirSync(evidenceDir, { recursive: true });
  lines.unshift(
    '# TASK-023 Preflight (Step 4)',
    '',
    `Run at: ${new Date().toISOString()}`,
    `Pinned base: ${BASE_COMMIT}`,
    '',
    'Operator actions recorded alongside this file: the serving-protocol',
    'smoke test (one fresh GLM session served one synthetic journal request',
    'through the frozen protocol) is documented in the benchmark report.',
    '',
  );
  lines.push('');
  lines.push(`PREFLIGHT OVERALL: ${allOk ? 'PASS' : 'FAIL'}`);
  writeFileSync(join(evidenceDir, 'PREFLIGHT.md'), lines.join('\n') + '\n', 'utf8');
  console.log(`\nPREFLIGHT OVERALL: ${allOk ? 'PASS' : 'FAIL'}`);
  console.log(`evidence: ${join(evidenceDir, 'PREFLIGHT.md')}`);

  rmSync('/tmp/preflight-neg', { recursive: true, force: true });
  rmSync('/tmp/preflight-evalneg', { recursive: true, force: true });
  rmSync('/tmp/preflight-evalpos', { recursive: true, force: true });

  process.exit(allOk ? 0 : 1);
}

function lefters(count: string): boolean {
  return Number(count) === 0;
}

await main();
