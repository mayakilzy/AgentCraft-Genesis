import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Goal } from '../../src/contracts/core.js';
import { FileFlightRecorder } from '../../src/mission/flight-recorder.js';
import type { AcceptanceCheck } from '../../src/mission/verification.js';
import { ZAIReasoningProvider } from '../../src/providers/zai-reasoning.js';
import { runRepoMission } from '../../src/work/repo-mission.js';

/**
 * EXPERIMENT 003 — Diagnostic Organization (TASK-022).
 *
 * A diagnostic goal on the same real external repository (pinned commit):
 * the flaky-orders case — a real seeded concurrency defect (disclosed:
 * the non-atomic read-check-write in InventoryService.reserve) whose
 * observable symptom is an intermittently failing test suite (~80% at the
 * pinned commit, per the committed evidence bundle).
 *
 * What this experiment proves: given a DIAGNOSTIC goal (outcome, not team),
 * Genesis designs a genuinely different organization — Reproduction
 * Engineer, Diagnostic Analyst, Report Writer under a Mission Coordinator —
 * no force-fit coding workers — and the mission's success is decided by
 * clean-room checks on the DIAGNOSIS's structure, its correctness against
 * the disclosed ground truth, a deterministic reproduction, and the
 * objective presence of the race in the integrated state.
 *
 * The engineering gates are deliberately OFF: the repository's test suite
 * is the SYMPTOM under diagnosis (it fails intermittently on the pinned
 * commit by design); using it as a gate would mislabel every diagnosis
 * mission. There is no build and no dependencies to install.
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

const OPENBOT_CHECKOUT =
  process.env.GENESIS_OPENBOT_DIR ?? join(REPO, '..', 'OpenBot');
const ZAI_SDK_PATH =
  process.env.ZAI_SDK_PATH ??
  '/home/z/.bun/install/global/node_modules/z-ai-web-dev-sdk/dist/index.js';

/** The pinned external target (same repository as Experiment 002). */
const GOLD_SOURCE = 'https://github.com/mayakilzy/genesis-gold-tasks';
const GOLD_REF = 'c9106df8a6fcad5c45fddd7698a5ac635a4badae';

function buildGoal(): Goal {
  return {
    outcome:
      'Diagnose the intermittent failure in the flaky-orders order system (the flaky-orders ' +
      'directory of the mission workspace): CI reports its suite failing on the same commit in ' +
      'about 80% of runs, with three different assertions failing across runs. The symptom is ' +
      'an oversell: more orders accepted than available stock. Analyze the provided evidence ' +
      'bundle (incident logs and observed pass/fail metrics), reproduce the fault, and deliver ' +
      'a written diagnosis report as flaky-orders/DIAGNOSIS.md stating the root cause with ' +
      'supporting evidence, an explicit confidence level, and explicit unknowns.',
    context:
      'The evidence bundle is in flaky-orders/evidence/. Commit a deterministic reproduction ' +
      'script as flaky-orders/repro.mjs that prints RACE REPRODUCED and exits with status 0 ' +
      'exactly when it demonstrates the oversell on the unmodified source. This mission is a ' +
      'diagnosis — do not repair or modify the source.',
    constraints: [
      'this is a diagnosis mission: identify and explain the root cause; do not repair or modify the source',
      'the diagnosis report must state a confidence level and explicit unknowns',
      'the reproduction must be deterministic and committed as flaky-orders/repro.mjs',
    ],
    budget: { maxUsd: 6, tier: 'default' },
  };
}

/**
 * Task-specific assertions, composed against the verifier's clean-room
 * clone of the integration branch. The ground truth (the seeded defect)
 * is disclosed here and in the report: this is a gold task.
 */
function extraChecks({ repoDir }: { repoDir: string }): AcceptanceCheck[] {
  const root = `${repoDir}/flaky-orders`;
  return [
    {
      kind: 'command',
      label: 'a structured diagnosis exists (root cause, evidence, confidence, unknowns)',
      command:
        `cd ${root} && test -f DIAGNOSIS.md && ` +
        `grep -qi 'root cause' DIAGNOSIS.md && ` +
        `grep -qi 'confidence' DIAGNOSIS.md && ` +
        `grep -qi 'unknown' DIAGNOSIS.md && ` +
        `grep -qiE 'evidence|reproduc' DIAGNOSIS.md`,
    },
    {
      kind: 'command',
      label:
        'the diagnosis identifies the actual defect: the inventory reserve path and a ' +
        'concurrency mechanism (disclosed ground truth)',
      command:
        `cd ${root} && grep -qi 'inventory' DIAGNOSIS.md && ` +
        `grep -qi 'reserve' DIAGNOSIS.md && ` +
        `grep -qiE 'race|atomic|interleav|concurrent|serial|lock|critical' DIAGNOSIS.md`,
    },
    {
      kind: 'command',
      label: 'the committed reproduction demonstrates the oversell on the unmodified source',
      command:
        `cd ${root} && test -f repro.mjs && node repro.mjs 2>&1 | grep -q 'RACE REPRODUCED'`,
    },
    {
      kind: 'command',
      label: 'the diagnosis references the provided evidence bundle (incident logs / rates)',
      command:
        `cd ${root} && grep -qiE 'incident|metrics|80%|pass.?fail|failure rate' DIAGNOSIS.md`,
    },
    {
      kind: 'command',
      label:
        'the race is objectively present in the integrated state (independent instrumented ' +
        'probe, latency pinned so every concurrent reservation reads the same stock)',
      command:
        `cd ${root} && node -e "Math.random=()=>0.999; import('./src/inventory.mjs').then(async m => { ` +
        `const inv = new m.InventoryService({ widget: 8 }); ` +
        `const rs = await Promise.all(Array.from({ length: 12 }, () => inv.reserve('widget', 1))); ` +
        `const a = rs.filter(Boolean).length; ` +
        `if (a > 8) { console.log('GATE: RACE PRESENT accepted=' + a); process.exit(0); } ` +
        `console.log('GATE: no oversell accepted=' + a); process.exit(1); })"`,
    },
  ];
}

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
): string {
  const flight = readFlight(missionId);
  const byType = (type: string): FlightLine[] => flight.filter((e) => e.type === type);

  const plan = byType('plan-created')[0] as
    | { workers: { id: string; role: string; needs: string[] }[]; rationale: string }
    | undefined;
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
  lines.push(`- **Mission:** \`${missionId}\``);
  lines.push(`- **Status:** **${result.status.toUpperCase()}**`);
  lines.push(`- **Wall time:** ${fmtMs(result.cost.wallMs)}`);
  lines.push(
    `- **Cognitive spend (separated per the GROUP 3 review requirement):** ` +
      `workers ${finished?.worker_reasoning_calls ?? '?'} + reviewer ${finished?.reviewer_calls ?? '?'} + handoffs ${finished?.handoff_calls ?? '?'} = ` +
      `${finished?.total_provider_calls ?? usage.calls} total provider calls ` +
      `(${usage.promptTokens.toLocaleString()} prompt + ${usage.completionTokens.toLocaleString()} completion tokens; ` +
      `${usage.rateLimitRetries} rate-limit retries, ${usage.failures} provider failures).`,
  );
  lines.push(`- **Human interventions:** 0 — the goal ran unattended.`);
  lines.push(
    `- **Target:** \`${GOLD_SOURCE}\` @ \`${GOLD_REF.slice(0, 12)}\` — same pinned repository as ` +
      `Experiment 002; the flaky-orders diagnostic case. Disclosed ground truth (gold task): ` +
      `the seeded defect is the non-atomic read-check-write in \`InventoryService.reserve\`, ` +
      `observable as an intermittent oversell (~80% failing runs at the pinned commit).`,
  );
  lines.push('');
  lines.push('## The goal (given, not a team)');
  lines.push('');
  lines.push(`> ${buildGoal().outcome}`);
  lines.push('');
  lines.push('## The organization Genesis designed');
  lines.push('');
  if (plan !== undefined) {
    lines.push(`Rationale: ${plan.rationale}`);
    lines.push('');
    lines.push('| Worker | Role | Capability needs |');
    lines.push('| --- | --- | --- |');
    for (const worker of plan.workers) {
      lines.push(`| \`${worker.id}\` | ${worker.role} | ${worker.needs.join(', ') || '—'} |`);
    }
    lines.push('');
    lines.push(
      'A genuinely different organization from both earlier experiments — no force-fit ' +
        'coding workers: Experiment 001 ran a Software Engineer + Documentation Writer; ' +
        'Experiment 002 added a Verification Engineer for browser acceptance. A diagnostic ' +
        'goal produces a diagnostic team: a Reproduction Engineer (reproduces the fault, ' +
        'tests hypotheses hands-on), a Diagnostic Analyst (isolates the fault from ' +
        'telemetry and code), a Report Writer, and a Mission Coordinator.',
    );
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
      'below decide instead on the diagnosis\u2019s structure, its correctness against the ' +
      'disclosed ground truth, a deterministic reproduction, and the objective presence ' +
      'of the race in the integrated state.',
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
  const reasoning = new ZAIReasoningProvider({ sdkPath: ZAI_SDK_PATH });

  console.log(`[experiment-003] mission ${missionId} starting...`);
  console.log(`[experiment-003] target: ${GOLD_SOURCE} @ ${GOLD_REF.slice(0, 12)}`);

  const run = await runRepoMission({
    goal: buildGoal(),
    source: GOLD_SOURCE,
    ref: GOLD_REF,
    missionRoot: join(runRoot, 'mission'),
    computersRoot: join(runRoot, 'computers'),
    openbotCheckout: OPENBOT_CHECKOUT,
    reasoning,
    reviewer: reasoning,
    recorder,
    missionId,
    projectDir: 'flaky-orders',
    gates: false,
    extraChecks,
    maxWorkerSteps: 18,
    missionTimeoutMs: 22 * 60_000,
    costSource: () => {
      const usage = reasoning.usage();
      return { usd: 0, tokens: usage.totalTokens };
    },
    providerCallsSource: () => reasoning.usage().calls,
  });

  recorder.close();

  const usage = reasoning.usage();
  const report = writeReport(missionId, run.result, usage, run.integration.path);
  writeFileSync(REPORT_PATH, report, 'utf8');

  console.log(`[experiment-003] status: ${run.result.status.toUpperCase()}`);
  console.log(`[experiment-003] summary: ${run.result.summary.slice(0, 300)}`);
  console.log(`[experiment-003] report: ${REPORT_PATH}`);
  console.log(`[experiment-003] flight record: ${join(FLIGHT_DIR, `${missionId}.jsonl`)}`);
  console.log(`[experiment-003] mission workspace (evidence) kept at: ${runRoot}`);
  await run.runtime.close();

  process.exit(run.result.status === 'success' ? 0 : 1);
}

await main();
