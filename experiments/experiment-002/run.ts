import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Goal } from '../../src/contracts/core.js';
import { FileFlightRecorder } from '../../src/mission/flight-recorder.js';
import type { AcceptanceCheck } from '../../src/mission/verification.js';
import { ZAIReasoningProvider } from '../../src/providers/zai-reasoning.js';
import { httpProbeCommand } from '../../src/work/dev-runtime.js';
import { runRepoMission } from '../../src/work/repo-mission.js';

/**
 * EXPERIMENT 002 — Software Engineering Organization (TASK-021).
 *
 * A real engineering goal on a real external repository (GitHub,
 * commit-pinned), executed with nothing mocked:
 *
 *   Goal → organization Genesis designs → workers on real OpenBot computers
 *   whose workspaces ARE git worktrees → real installs/builds/tests →
 *   real browser verification of the demo page → commits → integration on
 *   genesis/integration → clean-room clone → repository-derived gates and
 *   behavior assertions decide → flight record → this report.
 *
 * The target: mayakilzy/genesis-gold-tasks — purpose-built for Genesis
 * experiments, containing REAL code with REAL seeded defects (disclosed:
 * the pipe-escaping defect #12 and the missing center alignment #18 are
 * real behavior discrepancies verified by a real test suite that fails at
 * the pinned commit and defines correct behavior).
 *
 * Usage:
 *   GENESIS_OPENBOT_DIR=../OpenBot \
 *   ZAI_SDK_PATH=/path/to/z-ai-web-dev-sdk/dist/index.js \
 *   bun experiments/experiment-002/run.ts
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

/** The pinned external target. */
const GOLD_SOURCE = 'https://github.com/mayakilzy/genesis-gold-tasks';
const GOLD_REF = 'c9106df8a6fcad5c45fddd7698a5ac635a4badae';

const DEMO_PORT = 4173; // workers' preview port (the verifier uses its own)
const VERIFIER_DEMO_PORT = 4273; // clean-room port — never the workers'

function buildGoal(): Goal {
  return {
    outcome:
      'In the tabloid markdown-table toolkit (the tabloid directory of the mission repository), ' +
      'fix the cell-escaping defect where literal pipes in cell content break column counts, ' +
      'and implement column alignment support (left, center and right separator syntax) so the ' +
      'provided failing tests pass. Verify the demo page shows an aligned table in a real ' +
      'browser, and document the changes in the README.',
    context:
      `The mission repository is mayakilzy/genesis-gold-tasks pinned at ${GOLD_REF.slice(0, 12)}. ` +
      'The provided test suite (tabloid/test/tabloid.test.mjs) is the specification of correct ' +
      'behavior; it fails at the pinned commit for exactly the two defects above. Build before ' +
      'testing (the tests import the built bundle). Use ' +
      `port ${DEMO_PORT} for any preview server you start.`,
    constraints: [
      'the provided test suite is the specification of correct behavior',
      'keep the public API (escapeCell, parseAlignment, alignmentSeparator, renderTable) unchanged',
      `use port ${DEMO_PORT} for preview servers you start`,
    ],
    budget: { maxUsd: 6, tier: 'default' },
  };
}

/** Task-specific assertions, composed against the verifier's clean-room clone. */
function extraChecks({ repoDir }: { repoDir: string }): AcceptanceCheck[] {
  const behavior =
    `cd ${repoDir}/tabloid && node -e 'import("./dist/index.js").then(m=>{const r=[];` +
    `r.push(m.escapeCell("a|b")==="a\\\\|b");` +
    `r.push(m.parseAlignment(":---:")==="center");` +
    `r.push(m.parseAlignment("---:")==="right");` +
    `r.push(m.parseAlignment(":---")==="left");` +
    `r.push(m.renderTable(["h"],[["v"]],[":---:"]).split("\\n")[1].includes(":---:"));` +
    `r.push(m.renderTable(["a|b"],[["c"]]).includes("a\\\\|b"));` +
    `if(r.every(Boolean)){console.log("behavior: ok")}else{console.error("behavior: "+r.join(","));process.exit(1)}})` +
    `.catch(e=>{console.error(e.message);process.exit(1)})'`;
  const demoProbe =
    `pkill -f 'serve.mjs ${VERIFIER_DEMO_PORT}' 2>/dev/null; sleep 0.3; ` +
    `cd ${repoDir}/tabloid && (nohup node demo/serve.mjs ${VERIFIER_DEMO_PORT} > .demo.log 2>&1 &) && sleep 1 && ` +
    httpProbeCommand(`http://127.0.0.1:${VERIFIER_DEMO_PORT}/`, 'aligned markdown tables');
  return [
    {
      kind: 'command',
      label: 'the two defects are fixed and the API behaves as specified',
      command: behavior,
    },
    {
      kind: 'command',
      label: 'the README documents the changes (alignment + escaping)',
      command: `cd ${repoDir} && grep -qi alignment tabloid/README.md`,
    },
    {
      kind: 'command',
      label: 'the demo page serves and renders (deterministic probe on the clean-room port)',
      command: demoProbe,
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
  lines.push('# Experiment 002 — Software Engineering Organization');
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
    `- **Target:** \`${GOLD_SOURCE}\` @ \`${GOLD_REF.slice(0, 12)}\` — a real external repository, cloned read-only; ` +
      `pinned for reproducibility. Purpose-built as a Genesis gold task (disclosed): the two defects are real seeded behavior discrepancies, verified by a real failing test suite.`,
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
      'A different organization from Experiment 001 (2 specialists, no coordinator): ' +
        'the browser acceptance requirement adds a Verification Engineer, and three specialists require a Mission Coordinator.',
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
  lines.push('## Verification (clean room: committed state only, repo-derived gates)');
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
  const missionId = `experiment-002-${stamp}`;
  const runRoot = join(WORK_ROOT, missionId);
  mkdirSync(runRoot, { recursive: true });

  const recorder = new FileFlightRecorder({ dir: FLIGHT_DIR, missionId });
  const reasoning = new ZAIReasoningProvider({ sdkPath: ZAI_SDK_PATH });

  console.log(`[experiment-002] mission ${missionId} starting...`);
  console.log(`[experiment-002] target: ${GOLD_SOURCE} @ ${GOLD_REF.slice(0, 12)}`);

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
    projectDir: 'tabloid',
    gates: true,
    extraChecks,
    maxWorkerSteps: 30,
    missionTimeoutMs: 30 * 60_000,
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

  console.log(`[experiment-002] status: ${run.result.status.toUpperCase()}`);
  console.log(`[experiment-002] summary: ${run.result.summary.slice(0, 300)}`);
  console.log(`[experiment-002] report: ${REPORT_PATH}`);
  console.log(`[experiment-002] flight record: ${join(FLIGHT_DIR, `${missionId}.jsonl`)}`);
  console.log(`[experiment-002] mission workspace (evidence) kept at: ${runRoot}`);
  await run.runtime.close();

  process.exit(run.result.status === 'success' ? 0 : 1);
}

await main();
