/**
 * TASK-023 benchmark arm runner — executes ONE arm of the three-arm
 * benchmark. The operator launches arms sequentially (A, then B, then C)
 * with integrity checks between them; each arm runs ONCE, and whatever
 * happens is the result.
 *
 *   usage: bun experiments/benchmark-023/run.ts --arm A|B|C
 *   env:  GENESIS_OPENBOT_DIR (default: ../OpenBot)
 *
 * Design points pinned by BENCHMARK-DESIGN.md:
 *
 *   - DEVELOPMENT_FALLBACK reasoning for every arm, labeled
 *     reasoning_source=DEVELOPMENT_REASONING_FALLBACK,
 *     external_provider=unavailable,
 *     fallback_actor=GLM_FRESH_ISOLATED_SESSION (every response is
 *     served by a fresh stateless GLM session through the file journal;
 *     the persistent builder session serves NOTHING).
 *   - The ONLY variable across arms is the organization planner:
 *       A  StrongSingleAgentPlanner (harness-fixed single Sole Operator)
 *       B  StaticTeamPlanner        (harness-fixed four-role team)
 *       C  no planner               (the real Genesis chain decides)
 *   - Neutral, arm-blind paths everywhere a worker can see: the mission
 *     root and mission id contain no benchmark or arm vocabulary.
 *   - Budgets identical across arms: 30 steps per worker instance,
 *     120-minute mission wall (fallback actor latency dominates),
 *     15-minute per-call journal timeout, one bounded verification retry.
 *   - At the end the runner freezes this arm's evidence in place:
 *     ARM-RESULT.json + EXIT-CODE beside the mission root (flight record
 *     and fallback journals are already durable), never modified again.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';

import { FileFlightRecorder } from '../../src/mission/flight-recorder.js';
import { runRepoMission } from '../../src/work/repo-mission.js';
import { DevelopmentFallbackProvider } from '../experiment-003/dev-fallback.js';
import {
  BENCHMARK_GOAL,
  StaticTeamPlanner,
  StrongSingleAgentPlanner,
  benchmarkExtraChecks,
} from './mission.js';

const HERE = new URL('.', import.meta.url).pathname;
const REPO = join(HERE, '..', '..');
const FLIGHT_DIR = join(REPO, 'data', 'flight-records');
const BASE_COMMIT = readFileSync(join(HERE, 'workload', 'base-commit.txt'), 'utf8').trim();
const BASE_SOURCE = '/home/z/my-project/target-repos/worklog';
const WORK_ROOT = '/home/z/my-project/missions';

const OPENBOT_CHECKOUT =
  process.env.GENESIS_OPENBOT_DIR ?? join(REPO, '..', 'OpenBot');

const MAX_WORKER_STEPS = 30;
const MISSION_TIMEOUT_MS = 120 * 60_000;
const PER_CALL_TIMEOUT_MS = 15 * 60_000;

const ARM = ((): 'A' | 'B' | 'C' => {
  const idx = process.argv.indexOf('--arm');
  const value = idx === -1 ? undefined : process.argv[idx + 1];
  if (value !== 'A' && value !== 'B' && value !== 'C') {
    console.error('usage: bun experiments/benchmark-023/run.ts --arm A|B|C');
    process.exit(2);
  }
  return value;
})();

interface FlightLine {
  type: string;
  [key: string]: unknown;
}

function readFlight(missionId: string): FlightLine[] {
  const path = join(FLIGHT_DIR, `${missionId}.jsonl`);
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .trim()
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as FlightLine);
}

async function main(): Promise<void> {
  if (!existsSync(join(OPENBOT_CHECKOUT, 'agent-computer', 'src', 'index.ts'))) {
    throw new Error(`OpenBot checkout not found at ${OPENBOT_CHECKOUT}`);
  }
  if (!existsSync(BASE_SOURCE)) {
    throw new Error(`benchmark base repository not found at ${BASE_SOURCE} — run the workload generator first`);
  }

  // Neutral mission identity — no arm or benchmark vocabulary reaches any
  // worker-visible path (mission root, worktrees, remotes, journals).
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\..+$/, '');
  const missionId = `mission-${stamp}-${randomBytes(3).toString('hex')}`;
  const runRoot = join(WORK_ROOT, missionId);
  mkdirSync(runRoot, { recursive: true });

  const recorder = new FileFlightRecorder({ dir: FLIGHT_DIR, missionId });

  const planner =
    ARM === 'A'
      ? new StrongSingleAgentPlanner()
      : ARM === 'B'
        ? new StaticTeamPlanner()
        : undefined;

  console.log(`[arm ${ARM}] mission ${missionId} starting (target pinned at ${BASE_COMMIT.slice(0, 12)})`);

  const fallback = new DevelopmentFallbackProvider({
    queueDir: join(runRoot, 'fallback-queue'),
    missionId,
    recorder,
    waitTimeoutMs: PER_CALL_TIMEOUT_MS,
    fallbackActor: 'GLM_FRESH_ISOLATED_SESSION',
  });

  let status = 'crashed';
  let summary = 'the arm crashed before producing a result';
  let wallMs = 0;
  let error: string | undefined;

  try {
    const run = await runRepoMission({
      goal: BENCHMARK_GOAL,
      source: BASE_SOURCE,
      ref: BASE_COMMIT,
      missionRoot: join(runRoot, 'mission'),
      computersRoot: join(runRoot, 'computers'),
      openbotCheckout: OPENBOT_CHECKOUT,
      reasoning: fallback,
      reviewer: fallback,
      recorder,
      missionId,
      projectDir: '',
      gates: true,
      extraChecks: benchmarkExtraChecks,
      ...(planner === undefined ? {} : { planner }),
      maxWorkerSteps: MAX_WORKER_STEPS,
      missionTimeoutMs: MISSION_TIMEOUT_MS,
      costSource: () => ({ usd: 0, tokens: 0 }),
      providerCallsSource: () => fallback.currentUsage().calls,
    });
    recorder.close();
    status = run.result.status;
    summary = run.result.summary;
    wallMs = run.result.cost.wallMs;
    await run.runtime.close();
  } catch (e) {
    recorder.close();
    error = (e as Error).stack ?? String(e);
  }

  // ---- freeze this arm's evidence ----
  const flight = readFlight(missionId);
  const byType = (type: string): FlightLine[] => flight.filter((l) => l.type === type);
  const finished = byType('mission-finished')[0] as
    | {
        worker_reasoning_calls?: number;
        reviewer_calls?: number;
        handoff_calls?: number;
        total_provider_calls?: number;
      }
    | undefined;
  const usage = fallback.currentUsage();

  const result = {
    arm: ARM,
    missionId,
    runRoot,
    baseCommit: BASE_COMMIT,
    status,
    summary,
    wallMs,
    error,
    planner:
      ARM === 'A'
        ? 'StrongSingleAgentPlanner'
        : ARM === 'B'
          ? 'StaticTeamPlanner'
          : 'real OrganizationPlanner (adaptive chain)',
    goal: BENCHMARK_GOAL,
    fallback: {
      actor: 'GLM_FRESH_ISOLATED_SESSION',
      calls: usage.calls,
      promptChars: usage.promptChars,
      completionChars: usage.completionChars,
      timeouts: usage.timeouts,
    },
    missionFinished: finished ?? null,
    plan: byType('plan-created')[0] ?? null,
    requirements: byType('requirements-compiled')[0] ?? null,
    genomes: byType('genomes-compiled')[0] ?? null,
    workers: byType('worker-finished').map((w) => ({
      workerId: w.workerId,
      result: w.result,
    })),
    toolActions: byType('worker-step').length,
    workerRetries: byType('worker-retry').length,
    verifications: byType('verification').map((v) => ({
      ok: v.ok,
      passed: v.passed,
      failed: v.failed,
      failures: v.failures,
    })),
    fallbackEvents: byType('reasoning-fallback').length,
    flightRecord: join(FLIGHT_DIR, `${missionId}.jsonl`),
  };

  writeFileSync(join(runRoot, 'ARM-RESULT.json'), JSON.stringify(result, null, 2), 'utf8');
  writeFileSync(
    join(runRoot, 'EXIT-CODE'),
    `${status === 'success' ? 0 : 1}\n`,
    'utf8',
  );

  console.log(`[arm ${ARM}] status: ${status.toUpperCase()}`);
  console.log(`[arm ${ARM}] summary: ${summary.slice(0, 300)}`);
  console.log(`[arm ${ARM}] wall: ${Math.round(wallMs / 1000)}s, fallback calls: ${usage.calls}, tool actions: ${result.toolActions}`);
  console.log(`[arm ${ARM}] evidence frozen at: ${runRoot}`);
  process.exit(0);
}

await main();
