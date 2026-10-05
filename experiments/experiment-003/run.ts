import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { FileFlightRecorder } from '../../src/mission/flight-recorder.js';
import type { ReasoningProvider } from '../../src/contracts/core.js';
import { ZAIReasoningProvider } from '../../src/providers/zai-reasoning.js';
import { runRepoMission } from '../../src/work/repo-mission.js';
import {
  DevelopmentFallbackProvider,
  type FallbackUsage,
} from './dev-fallback.js';
import {
  buildDiagnosticGoal,
  EXP002_MISSION_ID,
  extraChecks,
  GOLD_REF,
  GOLD_SOURCE,
} from './mission.js';

/**
 * EXPERIMENT 003 — Diagnostic Organization (TASK-022).
 *
 * A diagnostic goal on the same real external repository as Experiment 002
 * (pinned commit): the flaky-orders case — a real seeded concurrency defect
 * (disclosed: the non-atomic read-check-write in InventoryService.reserve)
 * whose observable symptom is an intermittently failing suite (~80% at the
 * pinned commit, per the committed evidence bundle).
 *
 * What this experiment tests is NOT "can Genesis do diagnosis" but a sharper
 * claim: given a goal whose NATURE differs (diagnose an incident vs fix and
 * verify code), does the organization Genesis designs differ — and does it
 * differ because the capability requirements differ? The goal names no
 * roles; GoalCompiler → OrganizationPlanner → GenomeCompiler decide the
 * team, exactly as in Experiment 002. The comparison at the end is computed
 * from both flight records — if the organizations are effectively the same,
 * the report says NO.
 *
 * The epistemic contract (OBSERVED / INFERRED / UNKNOWN / HYPOTHESIS /
 * RECOMMENDED CHECK; unknown stays unknown) is carried by the goal and
 * enforced by deterministic gates (see mission.ts).
 *
 * Provider policy (review instruction): ONE lightweight availability probe
 * before the mission; if the provider is throttled, report
 * TASK-022 BLOCKED — EXTERNAL PROVIDER UNAVAILABLE with the probe evidence
 * and stop. No repeated retries, no waiting, no redesign. If available, the
 * mission runs ONCE under the standing bounded-retry policy.
 *
 * Usage:
 *   GENESIS_OPENBOT_DIR=../OpenBot \
 *   ZAI_SDK_PATH=/path/to/z-ai-web-dev-sdk/dist/index.js \
 *   bun experiments/experiment-003/run.ts
 */

const HERE = import.meta.dir;
const REPO = join(HERE, '..', '..');
const WORK_ROOT = join(HERE, '.runs');
const FLIGHT_DIR = join(REPO, 'data', 'flight-records');
const REPORT_PATH = join(HERE, 'REPORT.md');
const BLOCKED_PATH = join(HERE, 'BLOCKED-PROVIDER.md');

const OPENBOT_CHECKOUT =
  process.env.GENESIS_OPENBOT_DIR ?? join(REPO, '..', 'OpenBot');
const ZAI_SDK_PATH =
  process.env.ZAI_SDK_PATH ??
  '/home/z/.bun/install/global/node_modules/z-ai-web-dev-sdk/dist/index.js';

/** Evidence-calibrated per-worker bounds (EXP002 lesson: 18 steps starved
 *  the sole producing specialist through two rounds; 30 carried the full
 *  fix+verify+document load). */
const MAX_WORKER_STEPS = 30;
const MISSION_TIMEOUT_MS = 30 * 60_000;

/**
 * DEVELOPMENT FALLBACK mode (TASK-022 rule): the external provider is
 * already demonstrated unavailable (BLOCKED-PROVIDER.md), so this run
 * substitutes reasoning through the declared development fallback —
 * replace reasoning, never execution. No provider probe is performed.
 * The mission timeout is raised because fallback latency (a human-speed
 * actor answering a file journal) dominates wall time; the deviation is
 * reported, and MISSION TIME is still measured honestly.
 */
const DEV_FALLBACK = process.env.DEV_FALLBACK === '1';
const DEV_FALLBACK_TIMEOUT_MS = 120 * 60_000;
const FALLBACK_PER_CALL_TIMEOUT_MS = 15 * 60_000;

interface FlightLine {
  at: string;
  type: string;
  [key: string]: unknown;
}

function readFlight(missionId: string): FlightLine[] {
  const path = join(FLIGHT_DIR, `${missionId}.jsonl`);
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as FlightLine);
}

function fmtMs(ms: number): string {
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

interface PlanLine {
  workers: { id: string; role: string; needs: string[] }[];
  rationale: string;
}
interface RequirementsLine {
  domain: string;
  capabilityNeeds: string[];
}

/**
 * The organization comparison, computed from the two flight records — never
 * narrated in advance. If the organizations are effectively the same, this
 * returns NO and says why; that would be an important finding before
 * TASK-023, and manipulating the planner to force YES is forbidden.
 */
function organizationComparison(flight003: FlightLine[]): string {
  const exp2 = readFlight(EXP002_MISSION_ID);
  const req2 = exp2.find((e) => e.type === 'requirements-compiled') as
    | RequirementsLine
    | undefined;
  const plan2 = exp2.find((e) => e.type === 'plan-created') as PlanLine | undefined;
  const req3 = flight003.find((e) => e.type === 'requirements-compiled') as
    | RequirementsLine
    | undefined;
  const plan3 = flight003.find((e) => e.type === 'plan-created') as PlanLine | undefined;
  if (!req2 || !plan2 || !req3 || !plan3) {
    return ['(organization comparison unavailable: flight records incomplete)'].join(
      '\n',
    );
  }
  const specialists = (plan: PlanLine) =>
    plan.workers.filter((w) => w.role !== 'Mission Coordinator');
  const roles2 = specialists(plan2).map((w) => w.role);
  const roles3 = specialists(plan3).map((w) => w.role);
  const needs2 = [...req2.capabilityNeeds].sort();
  const needs3 = [...req3.capabilityNeeds].sort();
  const rolesDisjoint = roles2.every((role) => !roles3.includes(role));
  const needsDiffer = needs2.join(',') !== needs3.join(',');
  const different = rolesDisjoint && needsDiffer;
  const only3 = needs3.filter((need) => !needs2.includes(need));
  const only2 = needs2.filter((need) => !needs3.includes(need));
  const shared = needs2.filter((need) => needs3.includes(need));
  const why = [
    `EXP002 (domain ${req2.domain}) required [${needs2.join(', ')}] and staffed ${roles2.join(', ')}.`,
    `EXP003 (domain ${req3.domain}) required [${needs3.join(', ')}] and staffed ${roles3.join(', ')}.`,
    needsDiffer
      ? `Capability needs differ: [${only3.join(', ')}] appear only in EXP003; [${only2.join(', ')}] only in EXP002; shared: [${shared.join(', ') || 'none'}].`
      : 'The capability needs are identical.',
    rolesDisjoint
      ? 'No specialist role is shared between the two organizations.'
      : `Roles overlap: ${roles2.filter((r) => roles3.includes(r)).join(', ')}.`,
    `Plan sizes: EXP002 ${plan2.workers.length} workers, EXP003 ${plan3.workers.length} workers — the comparison is about composition driven by the goal, not headcount.`,
  ].join(' ');
  return [
    `EXP002 WORKERS = ${plan2.workers.map((w) => `${w.id} (${w.role})`).join(', ')}`,
    `EXP003 WORKERS = ${plan3.workers.map((w) => `${w.id} (${w.role})`).join(', ')}`,
    `EXP002 CAPABILITY NEEDS = ${needs2.join(', ')}`,
    `EXP003 CAPABILITY NEEDS = ${needs3.join(', ')}`,
    `ORGANIZATION STRUCTURALLY DIFFERENT = ${different ? 'YES' : 'NO'}`,
    `WHY = ${why}`,
  ].join('\n');
}

function writeReport(
  missionId: string,
  result: { status: string; summary: string; cost: { wallMs: number } },
  usage: {
    calls: number;
    failures: number;
    rateLimitRetries: number;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  },
  integrationPath: string,
  fallback: FallbackUsage | null,
): string {
  const flight = readFlight(missionId);
  const byType = (type: string): FlightLine[] => flight.filter((e) => e.type === type);

  const plan = byType('plan-created')[0] as PlanLine | undefined;
  const genomes = byType('genomes-compiled')[0] as
    | { workers: { id: string; tier: string; tools: string[]; computerRequired: boolean }[] }
    | undefined;
  const workers = byType('worker-finished') as {
    workerId: string;
    result: {
      status: string;
      summary: string;
      steps: number;
      reasoningCalls: number;
      artifacts: string[];
      refusals: string[];
    };
  }[];
  const lastOf = new Map(workers.map((w) => [w.workerId, w.result]));
  const repository = byType('repository') as {
    phase: string;
    detail?: string;
    changedFiles?: string[];
  }[];
  const verifications = byType('verification') as {
    ok: boolean;
    passed: number;
    failed: number;
    failures: string[];
  }[];
  const retries = byType('worker-retry') as { reason: string }[];
  const finished = byType('mission-finished')[0] as
    | {
        status: string;
        wallMs: number;
        worker_reasoning_calls: number;
        reviewer_calls: number;
        handoff_calls: number;
        total_provider_calls?: number;
      }
    | undefined;

  let integrationLog = '';
  try {
    integrationLog = execFileSync(
      'git',
      ['-C', integrationPath, 'log', '--oneline', 'genesis/integration', `^${GOLD_REF}`],
      { encoding: 'utf8' },
    ).trim();
  } catch {
    integrationLog = '(integration log unavailable)';
  }
  let integrationDiff = '';
  try {
    integrationDiff = execFileSync(
      'git',
      ['-C', integrationPath, 'diff', '--stat', GOLD_REF, 'genesis/integration'],
      { encoding: 'utf8' },
    ).trim();
  } catch {
    integrationDiff = '(diff unavailable)';
  }

  const lines: string[] = [];
  lines.push('# Experiment 003 — Diagnostic Organization');
  lines.push('');
  lines.push(
    `- **EXECUTION MODE:** **${
      fallback === null ? 'REAL PROVIDER' : 'DEVELOPMENT FALLBACK'
    }**${
      fallback === null
        ? ''
        : ' — the external provider was unavailable (429, evidence in BLOCKED-PROVIDER.md); ' +
          'every reasoning call was served by the declared GLM Primary Builder fallback. ' +
          'Organization, tools, computers, git, integration and verification all ran for real. ' +
          'This run is development evidence, never provider evidence.'
    }`,
  );
  lines.push(`- **Mission:** \`${missionId}\``);
  lines.push(`- **Status:** **${result.status.toUpperCase()}**`);
  lines.push(`- **Wall time:** ${fmtMs(result.cost.wallMs)}${
    fallback === null ? '' : ' (inflated by fallback actor latency — not work complexity)'
  }`);
  if (fallback === null) {
    lines.push(
      `- **Cognitive spend (separated per the GROUP 3 review requirement):** ` +
        `workers ${finished?.worker_reasoning_calls ?? '?'} + reviewer ${finished?.reviewer_calls ?? '?'} + handoffs ${finished?.handoff_calls ?? '?'} = ` +
        `${finished?.total_provider_calls ?? usage.calls} total provider calls ` +
        `(${usage.promptTokens.toLocaleString()} prompt + ${usage.completionTokens.toLocaleString()} completion tokens; ` +
        `${usage.rateLimitRetries} rate-limit retries, ${usage.failures} provider failures).`,
    );
  } else {
    lines.push(
      `- **Cognitive spend (separated, development fallback):** ` +
        `EXTERNAL PROVIDER CALLS = 0 (unavailable before launch; not probed, not retried). ` +
        `DEVELOPMENT FALLBACK CALLS = ${fallback.calls}` +
        ` (${fallback.promptChars.toLocaleString()} prompt chars + ${fallback.completionChars.toLocaleString()} completion chars; ` +
        `${fallback.timeouts} timeout(s)). Role separation: workers ${finished?.worker_reasoning_calls ?? '?'} + ` +
        `reviewer ${finished?.reviewer_calls ?? '?'} + handoffs ${finished?.handoff_calls ?? '?'}. ` +
        `Token/latency/cost figures for the external provider are deliberately NOT reported — ` +
        `this run is not provider evidence.`,
    );
  }
  lines.push(
    `- **Human interventions:** 0 — the mission loop ran unattended; ${
      fallback === null
        ? 'no human touched the orchestrator, workspaces or verification.'
        : 'the declared fallback actor answered reasoning calls ONLY through the file journal ' +
          '(request → response), with no access to the orchestrator, workspaces, git or verification.'
    }`,
  );
  lines.push(
    `- **Target:** \`${GOLD_SOURCE}\` @ \`${GOLD_REF.slice(0, 12)}\` — same pinned repository as ` +
      `Experiment 002; the flaky-orders diagnostic case. Disclosed ground truth (gold task): ` +
      `the seeded defect is the non-atomic read-check-write in \`InventoryService.reserve\`, ` +
      `observable as an intermittent oversell (~80% failing runs at the pinned commit).`,
  );
  lines.push('');
  lines.push('## The goal (given, not a team)');
  lines.push('');
  lines.push(`> ${buildDiagnosticGoal().outcome}`);
  lines.push('');
  lines.push('## The organization Genesis designed');
  lines.push('');
  if (plan !== undefined) {
    lines.push(
      'Designed by the pipeline from the goal alone — GoalCompiler → ' +
        'OrganizationPlanner → GenomeCompiler. No roles were prescribed by the ' +
        'experiment; the goal names no workers.',
    );
    lines.push('');
    lines.push(`Rationale: ${plan.rationale}`);
    lines.push('');
    lines.push('| Worker | Role | Capability needs |');
    lines.push('| --- | --- | --- |');
    for (const worker of plan.workers) {
      lines.push(`| \`${worker.id}\` | ${worker.role} | ${worker.needs.join(', ') || '—'} |`);
    }
    lines.push('');
    lines.push(
      '## Organization comparison — Experiment 002 vs Experiment 003 (computed from flight records)',
    );
    lines.push('');
    lines.push('```');
    lines.push(organizationComparison(flight));
    lines.push('```');
    lines.push('');
  }
  if (genomes !== undefined) {
    lines.push('## Genomes (cognitive and tool grants)');
    lines.push('');
    lines.push('| Worker | Tier | Grants |');
    lines.push('| --- | --- | --- |');
    for (const worker of genomes.workers) {
      lines.push(`| \`${worker.id}\` | ${worker.tier} | ${worker.tools.join(', ') || '—'} |`);
    }
    lines.push('');
  }
  lines.push('## The repository work (from the flight record)');
  lines.push('');
  for (const event of repository) {
    lines.push(
      `- **${event.phase}**: ${event.detail ?? ''}${
        event.changedFiles && event.changedFiles.length > 0
          ? ` (files: ${event.changedFiles.slice(0, 6).join(', ')})`
          : ''
      }`,
    );
  }
  lines.push('');
  lines.push('## The workers');
  lines.push('');
  for (const [workerId, workerResult] of lastOf) {
    lines.push(`### ${workerId}`);
    lines.push('');
    lines.push(
      `- **Status:** ${workerResult.status} (${workerResult.steps} steps, ${workerResult.reasoningCalls} reasoning calls)`,
    );
    lines.push(`- **Summary:** ${workerResult.summary}`);
    if (workerResult.refusals.length > 0) {
      lines.push(`- **Refusals:** ${workerResult.refusals.length}`);
    }
    lines.push('');
  }
  lines.push('## Verification (clean room: committed state only, diagnosis-quality gates)');
  lines.push('');
  lines.push(
    'Engineering gates are off by design: the repository\u2019s own test suite is the ' +
      'symptom under diagnosis (it fails intermittently on the pinned commit). The gates ' +
      'decide on the diagnosis\u2019s structure, its epistemic honesty (OBSERVED/INFERRED/' +
      'UNKNOWN/HYPOTHESIS/RECOMMENDED CHECK, evidence-cited observations, no unhedged ' +
      'certainty about environments the evidence does not cover), its correctness against ' +
      'the disclosed ground truth, a deterministic reproduction, the objective presence ' +
      'of the race in the integrated state, and that the source under diagnosis was not ' +
      'modified. Deterministic wherever practical; the LLM reviewer engages only on failure.',
  );
  lines.push('');
  for (const [index, verification] of verifications.entries()) {
    lines.push(
      `- **Pass ${index + 1}:** ${verification.ok ? 'ALL PASSED' : 'FAILED'} — ` +
        `${verification.passed} passed, ${verification.failed} failed`,
    );
    for (const failure of verification.failures) {
      lines.push(`  - ${failure}`);
    }
  }
  if (retries.length > 0) {
    lines.push('');
    lines.push('**Bounded retry (one, with recorded reason):**');
    for (const retry of retries) {
      lines.push(`- ${retry.reason}`);
    }
  }
  lines.push('');
  lines.push('## The integrated result (what the gates actually ran against)');
  lines.push('');
  lines.push('```diff');
  lines.push(integrationDiff || '(no changes)');
  lines.push('```');
  lines.push('');
  lines.push('Integration branch commits beyond the pinned base:');
  lines.push('');
  lines.push('```');
  lines.push(integrationLog || '(none)');
  lines.push('```');
  lines.push('');
  lines.push('## Mission summary (as integrated)');
  lines.push('');
  lines.push(result.summary);
  lines.push('');
  return lines.join('\n');
}

/** ONE lightweight provider availability probe — no retry, per instruction. */
async function probeProvider(): Promise<void> {
  const probe = new ZAIReasoningProvider({ sdkPath: ZAI_SDK_PATH, retryBackoffMs: [] });
  const started = Date.now();
  await probe.reason({
    system: 'Availability probe. Reply with the single word: ready.',
    prompt: 'ping',
    tier: 'cheap',
  });
  console.log(`[experiment-003] provider probe: available (${Date.now() - started}ms)`);
}

async function main(): Promise<void> {
  if (!existsSync(join(OPENBOT_CHECKOUT, 'agent-computer', 'src', 'index.ts'))) {
    throw new Error(`OpenBot checkout not found at ${OPENBOT_CHECKOUT} — set GENESIS_OPENBOT_DIR`);
  }

  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\..+$/, '');
  const missionId = `experiment-003-${stamp}`;
  const runRoot = join(WORK_ROOT, missionId);
  mkdirSync(runRoot, { recursive: true });

  const recorder = new FileFlightRecorder({ dir: FLIGHT_DIR, missionId });

  // DEVELOPMENT FALLBACK mode: the provider's unavailability is already
  // evidenced (BLOCKED-PROVIDER.md) — no probe, no retry, no waiting; the
  // declared fallback serves reasoning through the file journal instead.
  if (DEV_FALLBACK) {
    console.log('[experiment-003] EXECUTION MODE: DEVELOPMENT FALLBACK (declared)');
    const fallback = new DevelopmentFallbackProvider({
      queueDir: join(runRoot, 'fallback-queue'),
      missionId,
      recorder,
      waitTimeoutMs: FALLBACK_PER_CALL_TIMEOUT_MS,
    });
    await runMission(missionId, runRoot, recorder, fallback, fallback, null);
    return;
  }

  try {
    await probeProvider();
  } catch (error) {
    const detail = (error as Error).message.slice(0, 500);
    writeFileSync(
      BLOCKED_PATH,
      [
        '# TASK-022 BLOCKED — EXTERNAL PROVIDER UNAVAILABLE',
        '',
        `- Probe time (UTC): ${new Date().toISOString()}`,
        '- Probe: single ZAIReasoningProvider call, retryBackoffMs [] (no retry), tier cheap',
        `- Result: FAILED — ${detail}`,
        '- Classification: external provider constraint (same class as the Experiment 002',
        '  throttle window recorded in the recovery gate); not a Genesis defect.',
        '- Per instruction: no repeated retries, no waiting, no redesign.',
        '- Action: STOP. No mission was launched; no Experiment 003 evidence was produced.',
        '',
      ].join('\n'),
      'utf8',
    );
    console.log('[experiment-003] TASK-022 BLOCKED — EXTERNAL PROVIDER UNAVAILABLE');
    console.log(`[experiment-003] probe failure: ${detail}`);
    console.log(`[experiment-003] evidence: ${BLOCKED_PATH}`);
    process.exit(3);
  }

  const reasoning = new ZAIReasoningProvider({ sdkPath: ZAI_SDK_PATH });
  await runMission(missionId, runRoot, recorder, reasoning, reasoning, reasoning);
}

async function runMission(
  missionId: string,
  runRoot: string,
  recorder: FileFlightRecorder,
  reasoning: ReasoningProvider,
  reviewer: ReasoningProvider,
  zai: ZAIReasoningProvider | null,
): Promise<void> {
  const fallback =
    reasoning instanceof DevelopmentFallbackProvider ? reasoning : null;

  console.log(`[experiment-003] mission ${missionId} starting...`);
  console.log(`[experiment-003] target: ${GOLD_SOURCE} @ ${GOLD_REF.slice(0, 12)}`);
  if (fallback !== null) {
    console.log(`[experiment-003] fallback journal: ${join(runRoot, 'fallback-queue')}`);
  }

  const run = await runRepoMission({
    goal: buildDiagnosticGoal(),
    source: GOLD_SOURCE,
    ref: GOLD_REF,
    missionRoot: join(runRoot, 'mission'),
    computersRoot: join(runRoot, 'computers'),
    openbotCheckout: OPENBOT_CHECKOUT,
    reasoning,
    reviewer,
    recorder,
    missionId,
    projectDir: 'flaky-orders',
    gates: false,
    extraChecks,
    maxWorkerSteps: MAX_WORKER_STEPS,
    missionTimeoutMs: fallback === null ? MISSION_TIMEOUT_MS : DEV_FALLBACK_TIMEOUT_MS,
    costSource: () => {
      if (zai !== null) {
        return { usd: 0, tokens: zai.usage().totalTokens };
      }
      return { usd: 0, tokens: 0 };
    },
    providerCallsSource: () =>
      zai !== null ? zai.usage().calls : fallback!.currentUsage().calls,
  });

  recorder.close();

  const usage = zai !== null ? zai.usage() : {
    calls: 0,
    failures: 0,
    rateLimitRetries: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
  };
  const fallbackUsage = fallback !== null ? fallback.currentUsage() : null;
  const report = writeReport(missionId, run.result, usage, run.integration.path, fallbackUsage);
  writeFileSync(REPORT_PATH, report, 'utf8');

  console.log(`[experiment-003] status: ${run.result.status.toUpperCase()}`);
  console.log(`[experiment-003] summary: ${run.result.summary.slice(0, 300)}`);
  console.log(`[experiment-003] report: ${REPORT_PATH}`);
  console.log(`[experiment-003] flight record: ${join(FLIGHT_DIR, `${missionId}.jsonl`)}`);
  console.log(`[experiment-003] mission workspace (evidence) kept at: ${runRoot}`);
  if (fallbackUsage !== null) {
    console.log(
      `[experiment-003] development fallback: ${fallbackUsage.calls} call(s), ` +
        `${fallbackUsage.timeouts} timeout(s) — journal preserved at ${join(runRoot, 'fallback-queue')}`,
    );
  }
  await run.runtime.close();

  process.exit(run.result.status === 'success' ? 0 : 1);
}

await main();
