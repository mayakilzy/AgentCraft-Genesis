/**
 * G6-04 — Deterministic Clean-Room Smoke Mission
 *
 * This is the smallest meaningful Genesis mission that exercises the FULL
 * production causal chain from a clean checkout, using only deterministic
 * local capabilities (no external services, no paid providers, no network).
 *
 * Chain exercised:
 *   Goal → GoalCompiler → OrganizationPlanner → GenomeCompiler (with
 *   CognitiveRouter(RuleDecisionProvider) as TierSelector) →
 *   MissionOrchestrator → WorkerAgent (with MemoryComputer + scripted
 *   reasoning) → VerificationLoop (clean-room file check) →
 *   MissionResult + FlightRecorder evidence.
 *
 * Per G6-04 Section 12 ("Real behavior, not terminal theater"):
 *   - Goal compiled into requirements ✓ (GoalCompiler real)
 *   - Organization created ✓ (OrganizationPlanner real)
 *   - Worker genome(s) compiled ✓ (GenomeCompiler real)
 *   - At least one worker executed ✓ (WorkerAgent real, MemoryComputer stub)
 *   - Observable output/artifact exists ✓ (worker ACTUALLY writes hello.md
 *     via write_file action → MemoryComputer.writeFile)
 *   - Verification evaluated the result ✓ (VerificationLoop real,
 *     clean-room copy of hello.md → file check passes)
 *   - Mission completion based on evidence ✓ (mission-finished event)
 *   - FlightRecorder recorded the lifecycle ✓ (MemoryFlightRecorder)
 *
 * The deterministic providers used (MemoryComputer, ScriptedReasoningProvider)
 * are stubs for the EXTERNAL surfaces only — they are downstream of the
 * bounded decision point. Genesis production code (GoalCompiler,
 * OrganizationPlanner, GenomeCompiler, CognitiveRouter, MissionOrchestrator,
 * WorkerAgent, VerificationLoop) runs unmodified.
 *
 * Usage (clean-room):
 *   npx tsx experiments/g6-04/smoke-mission.ts
 *
 * Exit code: 0 on PASS, non-zero on FAIL. Prints structured evidence to
 * stdout for capture by the clean-room runner.
 */
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import type {
  Goal,
  MissionResult,
  ReasoningProvider,
} from '../../src/contracts/core.js';
import { GoalCompiler } from '../../src/goal/goal-compiler.js';
import {
  GenomeCompiler,
  loadOwnership,
} from '../../src/genome/genome-compiler.js';
import { MemoryFlightRecorder } from '../../src/mission/flight-recorder.js';
import { MissionOrchestrator } from '../../src/mission/orchestrator.js';
import {
  cleanRoomPath,
  type AcceptanceCheck,
  type ArtifactSource,
} from '../../src/mission/verification.js';
import { OrganizationPlanner } from '../../src/organization/organization-planner.js';
import { CognitiveRouter } from '../../src/routing/cognitive-router.js';
import { RuleDecisionProvider } from '../../src/routing/decision-provider.js';
import { MemoryComputer } from '../../tests/helpers/memory-runtime.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPO = path.join(__dirname, '..', '..');
const EXPECTED_FILE = 'hello.md';
const EXPECTED_CONTENT = '# Hello from Genesis\n';

function buildGoal(): Goal {
  return {
    outcome:
      `Create a markdown file named ${EXPECTED_FILE} at the workspace root ` +
      'with the content "# Hello from Genesis" as the sole body. The file ' +
      'must be a valid markdown file with a single H1 heading.',
    context:
      'This is a minimal deterministic smoke mission. The worker has ' +
      'access to a MemoryComputer (in-memory filesystem) and a scripted ' +
      'reasoning provider that emits the write_file action followed by ' +
      'the finish action.',
    constraints: [
      `The deliverable must be a markdown file named ${EXPECTED_FILE}`,
      'The file must contain exactly one H1 heading: # Hello from Genesis',
    ],
    budget: { maxUsd: 1, tier: 'default' },
  };
}

/**
 * ScriptedReasoningProvider: returns a deterministic sequence of worker
 * actions that writes the file and finishes. The Genesis WorkerAgent
 * production code processes these actions through the real action-parsing,
 * grant-checking, anti-degenerate-loop, and success-verification pipeline —
 * only the LLM backend is stubbed.
 *
 * Per G6-04 Section 11: "Development reasoning fallback may be used ONLY
 * if already supported and must be labelled: DEVELOPMENT_REASONING_FALLBACK.
 * It must never be reported as production-provider evidence."
 *
 * This script is labelled DEVELOPMENT_REASONING_FALLBACK.
 */
function makeScriptedReasoning(): ReasoningProvider {
  let step = 0;
  return {
    name: 'DEVELOPMENT_REASONING_FALLBACK',
    async reason() {
      step += 1;
      if (step === 1) {
        return {
          text: JSON.stringify({
            action: 'write_file',
            path: EXPECTED_FILE,
            contents: EXPECTED_CONTENT,
          }),
        };
      }
      return {
        text: JSON.stringify({
          action: 'finish',
          summary: `wrote ${EXPECTED_FILE} with the required H1 heading`,
          artifacts: [EXPECTED_FILE],
        }),
      };
    },
  };
}

/**
 * Verification: the file must exist in the verifier's clean-room copy of
 * the worker's workspace (the orchestrator's VerificationLoop copies
 * artifacts from the worker's computer to the verifier's computer before
 * running checks). We use cleanRoomPath() to compute the verifier's path,
 * matching experiment-001's pattern.
 */
function buildChecks(context: {
  artifacts: ReadonlyArray<ArtifactSource>;
}): readonly AcceptanceCheck[] {
  const found = context.artifacts
    .flatMap((source) => source.paths.map((p) => ({ source, p })))
    .find(({ p }) => p.endsWith(EXPECTED_FILE));
  if (found === undefined) {
    return [
      {
        kind: 'file',
        label: `${EXPECTED_FILE} was produced`,
        path: `artifacts/missing/${EXPECTED_FILE}`,
      },
    ];
  }
  const inCleanRoom = cleanRoomPath(found.source, found.p);
  return [
    {
      kind: 'file',
      label: `${EXPECTED_FILE} exists in clean-room copy and contains the expected H1 heading`,
      path: inCleanRoom,
      expectIncludes: '# Hello from Genesis',
    },
  ];
}

type ChecksContext = Parameters<
  NonNullable<ConstructorParameters<typeof MissionOrchestrator>[0]['checks']>
>[0];

async function main(): Promise<void> {
  const startedAt = Date.now();
  const recorder = new MemoryFlightRecorder();
  const ownership = loadOwnership(path.join(REPO, 'data', 'ownership.yaml'));

  const orchestrator = new MissionOrchestrator({
    goalCompiler: new GoalCompiler(),
    planner: new OrganizationPlanner(),
    genomeCompiler: new GenomeCompiler({
      registry: ownership,
      selectTier: (selection) =>
        new CognitiveRouter(new RuleDecisionProvider()).selectTier(selection),
    }),
    runtime: (() => {
      // Cache one MemoryComputer per worker ID so that the worker's
      // write_file action and the orchestrator's artifact collection
      // see the SAME computer instance. (A naive `surfaces()` that
      // returns `new MemoryComputer()` each call would create a fresh
      // empty computer for the orchestrator's read, hiding the worker's
      // write — a real bug we encountered and fixed in G6-04.)
      const computers = new Map<string, MemoryComputer>();
      return {
        name: 'g6-04-memory-runtime',
        async ensureWorker(genome: { identity: { id: string } }) {
          if (!computers.has(genome.identity.id)) {
            computers.set(genome.identity.id, new MemoryComputer());
          }
          return { workerId: genome.identity.id, ref: 'memory' };
        },
        async stopWorker() { /* no-op */ },
        surfaces(handle: { workerId: string }) {
          const computer = computers.get(handle.workerId) ?? new MemoryComputer();
          computers.set(handle.workerId, computer);
          return { computer };
        },
      } as unknown as import('../../src/contracts/core.js').RuntimeAdapter;
    })(),
    reasoning: makeScriptedReasoning(),
    reviewer: makeScriptedReasoning(),
    recorder,
    missionId: 'g6-04-smoke-mission',
    costSource: () => ({ usd: 0, tokens: 0 }),
    maxWorkerSteps: 5,
    missionTimeoutMs: 30_000,
    checks: (ctx: ChecksContext) => buildChecks(ctx),
  });

  let result: MissionResult | null = null;
  let thrownError: unknown = null;
  try {
    result = await orchestrator.run(buildGoal());
  } catch (e) {
    thrownError = e;
  }

  const elapsedMs = Date.now() - startedAt;
  const events = recorder.events as Array<{ type: string; [k: string]: unknown }>;
  const eventTypes = events.map((e) => e.type);

  const requirementsCompiled = events.find((e) => e.type === 'requirements-compiled') !== undefined;
  const planCreated = events.find((e) => e.type === 'plan-created') !== undefined;
  const genomesCompiled = events.find((e) => e.type === 'genomes-compiled') !== undefined;
  const workerStarted = events.find((e) => e.type === 'worker-started') !== undefined;
  const workerFinished = events.find((e) => e.type === 'worker-finished') !== undefined;
  const verificationEvent = events.find((e) => e.type === 'verification') as
    | { ok: boolean; passed: number; failed: number; failures: readonly string[] }
    | undefined;
  const missionFinished = events.find((e) => e.type === 'mission-finished') !== undefined;

  const missionSuccess = result?.status === 'success';
  const verificationPass = verificationEvent?.ok === true;
  const workerExecuted = workerStarted && workerFinished;
  const artifactVerified = verificationEvent?.failed === 0 && verificationEvent?.passed >= 1;

  const pass = missionSuccess && verificationPass && workerExecuted
    && requirementsCompiled && planCreated && genomesCompiled && missionFinished
    && artifactVerified
    && thrownError === null;

  const evidence = {
    probe_at: new Date().toISOString(),
    mission_id: 'g6-04-smoke-mission',
    elapsed_ms: elapsedMs,
    decision_provider: 'rule-v0.1 (RuleDecisionProvider)',
    reasoning_provider: 'DEVELOPMENT_REASONING_FALLBACK',
    runtime: 'MemoryComputer (in-memory filesystem stub)',
    goal: buildGoal().outcome,
    requirements_compiled: requirementsCompiled,
    organization_created: planCreated,
    genomes_compiled: genomesCompiled,
    workers_executed: workerExecuted,
    worker_started: workerStarted,
    worker_finished: workerFinished,
    verification_ok: verificationPass,
    verification_passed: verificationEvent?.passed ?? 0,
    verification_failed: verificationEvent?.failed ?? 0,
    mission_status: result?.status ?? 'threw',
    mission_finished_event: missionFinished,
    artifact_verified: artifactVerified,
    artifact_path: EXPECTED_FILE,
    artifact_content_excerpt: EXPECTED_CONTENT,
    thrown_error_class: thrownError instanceof Error ? thrownError.name : null,
    thrown_error_message_excerpt: thrownError instanceof Error
      ? String(thrownError.message).slice(0, 300)
      : null,
    flight_event_types_in_order: eventTypes,
    flight_event_count: events.length,
    mission_summary_excerpt: result?.summary ? result.summary.slice(0, 300) : null,
    mission_cost_usd: result?.cost.usd ?? 0,
    mission_cost_tokens: result?.cost.tokens ?? 0,
    mission_cost_wall_ms: result?.cost.wallMs ?? 0,
    mission_cost_human_interventions: result?.cost.humanInterventions ?? 0,
    pass,
  };

  console.log('--- G6-04 SMOKE MISSION EVIDENCE ---');
  console.log(JSON.stringify(evidence, null, 2));
  console.log('--- END EVIDENCE ---');

  process.exit(pass ? 0 : 1);
}

await main();
