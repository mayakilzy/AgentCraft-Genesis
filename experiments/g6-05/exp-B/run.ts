/**
 * G6-05 Experiment B — End-to-End Execution (real worker actions → artifact → independent verification)
 *
 * Research question: Does the generated organization produce a verified
 * outcome through the full Genesis chain, with real worker actions on
 * the MemoryComputer and independent verification?
 *
 * Test mission (non-trivial but bounded): A multi-file software-engineering
 * mission that requires two file writes (greet.md + farewell.md), both
 * with content correctness verification.
 *
 * Provider mode: DEVELOPMENT_REASONING_FALLBACK (clearly labeled). Real
 * Genesis production code (GoalCompiler, OrganizationPlanner, GenomeCompiler,
 * CognitiveRouter(RuleDecisionProvider), MissionOrchestrator, WorkerAgent
 * action loop, VerificationLoop clean-room copy, hash-match check) runs
 * unmodified.
 *
 * Repetition: 3 runs to confirm determinism.
 *
 * Evidence output: experiments/g6-05/exp-B/results.json
 */
import * as path from 'node:path';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import type {
  Goal,
  MissionResult,
  ReasoningProvider,
  RuntimeAdapter,
} from '../../../src/contracts/core.js';
import { GoalCompiler } from '../../../src/goal/goal-compiler.js';
import {
  GenomeCompiler,
  loadOwnership,
} from '../../../src/genome/genome-compiler.js';
import { MemoryFlightRecorder } from '../../../src/mission/flight-recorder.js';
import { MissionOrchestrator } from '../../../src/mission/orchestrator.js';
import {
  cleanRoomPath,
  type AcceptanceCheck,
  type ArtifactSource,
} from '../../../src/mission/verification.js';
import { OrganizationPlanner } from '../../../src/organization/organization-planner.js';
import { CognitiveRouter } from '../../../src/routing/cognitive-router.js';
import { RuleDecisionProvider } from '../../../src/routing/decision-provider.js';
import { MemoryComputer } from '../../../tests/helpers/memory-runtime.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO = path.join(__dirname, '..', '..', '..');

const FILE_A = 'greet.md';
const FILE_A_CONTENT = '# Greetings from Genesis\n';
const FILE_B = 'farewell.md';
const FILE_B_CONTENT = '# Farewell from Genesis\n';

function buildGoal(): Goal {
  return {
    outcome:
      `Generate two markdown files: ${FILE_A} with content "${FILE_A_CONTENT.trim()}" ` +
      `and ${FILE_B} with content "${FILE_B_CONTENT.trim()}". Both files must have a single H1 heading.`,
    context:
      'Both files must exist at the workspace root after the mission completes.',
    constraints: [
      `${FILE_A} must contain exactly the H1 heading: ${FILE_A_CONTENT.trim()}`,
      `${FILE_B} must contain exactly the H1 heading: ${FILE_B_CONTENT.trim()}`,
    ],
    budget: { maxUsd: 1, tier: 'default' },
  };
}

/**
 * ScriptedReasoningProvider that writes two files and finishes.
 * Label: DEVELOPMENT_REASONING_FALLBACK per G6-04 Section 11.
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
            path: FILE_A,
            contents: FILE_A_CONTENT,
          }),
        };
      }
      if (step === 2) {
        return {
          text: JSON.stringify({
            action: 'write_file',
            path: FILE_B,
            contents: FILE_B_CONTENT,
          }),
        };
      }
      return {
        text: JSON.stringify({
          action: 'finish',
          summary: `wrote ${FILE_A} and ${FILE_B} with the required H1 headings`,
          artifacts: [FILE_A, FILE_B],
        }),
      };
    },
  };
}

/**
 * Verification: BOTH files must exist in the verifier's clean-room copy AND
 * contain the expected H1 heading.
 */
function buildChecks(context: {
  artifacts: ReadonlyArray<ArtifactSource>;
}): readonly AcceptanceCheck[] {
  const checks: AcceptanceCheck[] = [];
  for (const target of [
    { file: FILE_A, expected: FILE_A_CONTENT },
    { file: FILE_B, expected: FILE_B_CONTENT },
  ]) {
    const found = context.artifacts
      .flatMap((source) => source.paths.map((p) => ({ source, p })))
      .find(({ p }) => p.endsWith(target.file));
    if (found === undefined) {
      checks.push({
        kind: 'file',
        label: `${target.file} was produced`,
        path: `artifacts/missing/${target.file}`,
      });
      continue;
    }
    const inCleanRoom = cleanRoomPath(found.source, found.p);
    checks.push({
      kind: 'file',
      label: `${target.file} exists in clean-room copy and contains the expected H1 heading`,
      path: inCleanRoom,
      expectIncludes: target.expected.trim(),
    });
  }
  return checks;
}

type ChecksContext = Parameters<
  NonNullable<ConstructorParameters<typeof MissionOrchestrator>[0]['checks']>
>[0];

interface RunResult {
  readonly run_id: number;
  readonly mission_status: string;
  readonly verification_passed: number;
  readonly verification_failed: number;
  readonly verification_ok: boolean;
  readonly worker_actions_executed: number;
  readonly reasoning_calls: number;
  readonly retries: number;
  readonly flight_event_count: number;
  readonly flight_event_types_in_order: readonly string[];
  readonly false_success_observed: boolean;
  readonly artifact_a_correct: boolean;
  readonly artifact_b_correct: boolean;
  readonly elapsed_ms: number;
  readonly mission_cost_usd: number;
  readonly mission_cost_tokens: number;
  readonly mission_cost_wall_ms: number;
  readonly thrown_error: string | null;
}

async function runOnce(runId: number): Promise<RunResult> {
  const startedAt = Date.now();
  const recorder = new MemoryFlightRecorder();
  const ownership = loadOwnership(path.join(REPO, 'data', 'ownership.yaml'));

  // Cache one MemoryComputer per worker ID so the worker's write_file and
  // the verifier's artifact collection see the SAME computer instance.
  const computers = new Map<string, MemoryComputer>();
  const runtime: RuntimeAdapter = {
    name: 'g6-05-exp-B-memory-runtime',
    async ensureWorker(genome) {
      if (!computers.has(genome.identity.id)) {
        computers.set(genome.identity.id, new MemoryComputer());
      }
      return { workerId: genome.identity.id, ref: 'memory' };
    },
    async stopWorker() {
      /* no-op */
    },
    surfaces(handle) {
      const computer = computers.get(handle.workerId) ?? new MemoryComputer();
      computers.set(handle.workerId, computer);
      return { computer };
    },
  } as unknown as RuntimeAdapter;

  const orchestrator = new MissionOrchestrator({
    goalCompiler: new GoalCompiler(),
    planner: new OrganizationPlanner(),
    genomeCompiler: new GenomeCompiler({
      registry: ownership,
      selectTier: (selection) =>
        new CognitiveRouter(new RuleDecisionProvider()).selectTier(selection),
    }),
    runtime,
    reasoning: makeScriptedReasoning(),
    reviewer: makeScriptedReasoning(),
    recorder,
    missionId: `g6-05-exp-B-run-${runId}`,
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

  const verificationEvent = events.find((e) => e.type === 'verification') as
    | {
        ok: boolean;
        passed: number;
        failed: number;
        failures: readonly string[];
      }
    | undefined;

  // Inspect the captured worker computer for artifacts after the mission.
  let artifactACorrect = false;
  let artifactBCorrect = false;
  for (const c of computers.values()) {
    const a = c.files.get(FILE_A);
    const b = c.files.get(FILE_B);
    if (a === FILE_A_CONTENT) artifactACorrect = true;
    if (b === FILE_B_CONTENT) artifactBCorrect = true;
  }

  const missionSuccess = result?.status === 'success';
  const verificationPass = verificationEvent?.ok === true;
  const falseSuccessObserved = missionSuccess && !verificationPass;

  const workerSteps = events.filter((e) => e.type === 'worker-step').length;
  const verificationEvents = events.filter((e) => e.type === 'verification');
  const retries = Math.max(0, verificationEvents.length - 1);

  return {
    run_id: runId,
    mission_status: result?.status ?? 'threw',
    verification_passed: verificationEvent?.passed ?? 0,
    verification_failed: verificationEvent?.failed ?? 0,
    verification_ok: verificationPass ?? false,
    worker_actions_executed: workerSteps,
    reasoning_calls: workerSteps, // each worker-step is one reasoning call here
    retries,
    flight_event_count: events.length,
    flight_event_types_in_order: eventTypes,
    false_success_observed: falseSuccessObserved,
    artifact_a_correct: artifactACorrect,
    artifact_b_correct: artifactBCorrect,
    elapsed_ms: elapsedMs,
    mission_cost_usd: result?.cost.usd ?? 0,
    mission_cost_tokens: result?.cost.tokens ?? 0,
    mission_cost_wall_ms: result?.cost.wallMs ?? 0,
    thrown_error:
      thrownError instanceof Error
        ? `${thrownError.name}: ${thrownError.message}`
        : null,
  };
}

async function main(): Promise<void> {
  const runs: RunResult[] = [];
  for (let i = 1; i <= 3; i++) {
    runs.push(await runOnce(i));
  }

  // Determinism check
  const missionStatuses = new Set(runs.map((r) => r.mission_status));
  const verificationOk = new Set(runs.map((r) => r.verification_ok));
  const verificationPassed = new Set(runs.map((r) => r.verification_passed));
  const verificationFailed = new Set(runs.map((r) => r.verification_failed));
  const falseSuccess = runs.some((r) => r.false_success_observed);
  const allArtifactsCorrect = runs.every(
    (r) => r.artifact_a_correct && r.artifact_b_correct,
  );

  const semanticMatch =
    missionStatuses.size === 1 &&
    verificationOk.size === 1 &&
    verificationPassed.size === 1 &&
    verificationFailed.size === 1;

  const elapsedSorted = [...runs.map((r) => r.elapsed_ms)].sort((a, b) => a - b);
  const medianElapsed = elapsedSorted[Math.floor(elapsedSorted.length / 2)];

  const pass =
    semanticMatch &&
    runs.every((r) => r.mission_status === 'success') &&
    runs.every((r) => r.verification_ok) &&
    runs.every((r) => r.verification_passed === 2 && r.verification_failed === 0) &&
    !falseSuccess &&
    allArtifactsCorrect;

  const output = {
    experiment_id: 'G6-05-EXP-B',
    probe_at: new Date().toISOString(),
    source_head: '15243efae798f2ef90ec3a2ea185b17e798858fc',
    research_question:
      'Does the generated organization produce a verified outcome through the full Genesis chain, with real worker actions on the MemoryComputer and independent verification?',
    hypothesis:
      'Genesis executes a non-trivial multi-artifact mission end-to-end and the mission succeeds with no false-success path.',
    independent_variable: 'mission type (deterministic core, multi-artifact goal)',
    controlled_variables: [
      'RuleDecisionProvider (deterministic)',
      'MemoryComputer (in-memory filesystem)',
      'DEVELOPMENT_REASONING_FALLBACK (clearly labeled)',
      'MemoryFlightRecorder',
      'maxWorkerSteps=5, missionTimeoutMs=30000',
    ],
    comparator: 'NONE — truth criterion (artifact correctness + verification pass)',
    test_mission: buildGoal().outcome,
    repetition_count: 3,
    runs,
    aggregate: {
      mission_successes: runs.filter((r) => r.mission_status === 'success').length,
      verification_successes: runs.filter((r) => r.verification_ok).length,
      false_successes: runs.filter((r) => r.false_success_observed).length,
      artifact_a_correct_count: runs.filter((r) => r.artifact_a_correct).length,
      artifact_b_correct_count: runs.filter((r) => r.artifact_b_correct).length,
      median_elapsed_ms: medianElapsed,
      elapsed_ms_range: {
        min: elapsedSorted[0],
        max: elapsedSorted[elapsedSorted.length - 1],
      },
      semantic_match_across_runs: semanticMatch,
    },
    limitations: [
      'Deterministic reasoning — worker actions are scripted. This is real Genesis production behavior on a controlled reasoning stub, NOT real-LLM evidence.',
      'Complements (does not replace) Phase 4.8A/E real-LLM evidence for the end-to-end claim.',
      'N=3 deterministic runs; not statistical evidence of production-scale reliability.',
    ],
    evidence_level: 'E3',
    evidence_level_justification:
      'Controlled experiment using deterministic production code. Real full-chain execution (Goal → Requirements → Organization → Genome → Worker → Verification → Outcome) but with scripted reasoning and MemoryComputer. Valid for tested behavior only.',
    pass,
  };

  const outDir = path.join(__dirname);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, 'results.json'),
    JSON.stringify(output, null, 2) + '\n',
  );

  console.log('--- G6-05 EXP-B EVIDENCE ---');
  console.log(JSON.stringify(output, null, 2));
  console.log('--- END EVIDENCE ---');
  console.log(`EXP_B_PASS = ${pass}`);
  process.exit(pass ? 0 : 1);
}

await main();
