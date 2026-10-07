/**
 * G6-05 Experiment E — Failure Truthfulness
 *
 * Research question: Does Genesis avoid declaring success when required
 * work has not been verified, across 5 failure modes that the deterministic
 * core can exercise without external providers?
 *
 * For each scenario, we inject a failure and verify that:
 *   - mission_status != 'success'
 *   - verification.ok = false
 *   - false_success_observed = 0
 *   - flight records remain complete
 *
 * Evidence output: experiments/g6-05/exp-E/results.json
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

const EXPECTED_FILE = 'output.md';
const EXPECTED_CONTENT = '# Genesis failure-truthfulness probe\n';

function buildGoal(): Goal {
  return {
    outcome:
      `Write a markdown file named ${EXPECTED_FILE} at the workspace root with ` +
      `content "${EXPECTED_CONTENT.trim()}" as the sole body.`,
    context: 'Failure-truthfulness probe.',
    constraints: [`File must be named ${EXPECTED_FILE}`, 'Must contain a single H1 heading'],
    budget: { maxUsd: 1, tier: 'default' },
  };
}

type FailureMode =
  | 'E1-unknown-action'
  | 'E2-missing-artifact'
  | 'E3-wrong-content'
  | 'E4-hash-mismatch'
  | 'E5-verification-gate-fails';

interface FailureScenario {
  readonly id: FailureMode;
  readonly description: string;
  readonly injected_failure: string;
  readonly reasoning_factory: () => ReasoningProvider;
  readonly checks_factory: (
    ctx: { artifacts: ReadonlyArray<ArtifactSource> },
  ) => readonly AcceptanceCheck[];
}

/**
 * E1 — Worker emits an unknown action. WorkerAgent should fail to parse
 * the action; worker should report failure; mission should fail.
 */
function makeE1Reasoning(): ReasoningProvider {
  let step = 0;
  return {
    name: 'DEVELOPMENT_REASONING_FALLBACK',
    async reason() {
      step += 1;
      if (step === 1) {
        // Unknown action — should be rejected by the worker action parser
        return { text: JSON.stringify({ action: 'fly_to_the_moon', destination: 'mars' }) };
      }
      return { text: JSON.stringify({ action: 'finish', summary: 'done', artifacts: [] }) };
    },
  };
}

/**
 * E2 — Worker finishes without writing the artifact. Verification cannot
 * find the artifact; mission fails.
 */
function makeE2Reasoning(): ReasoningProvider {
  return {
    name: 'DEVELOPMENT_REASONING_FALLBACK',
    async reason() {
      return {
        text: JSON.stringify({
          action: 'finish',
          summary: 'claimed to write the file but did not',
          artifacts: [EXPECTED_FILE], // false claim
        }),
      };
    },
  };
}

/**
 * E3 — Worker writes WRONG content. Verification's expectIncludes check
 * fails; mission fails.
 */
function makeE3Reasoning(): ReasoningProvider {
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
            contents: '# Wrong content entirely\n',
          }),
        };
      }
      return {
        text: JSON.stringify({
          action: 'finish',
          summary: 'wrote the file',
          artifacts: [EXPECTED_FILE],
        }),
      };
    },
  };
}

/**
 * E4 — Worker writes content whose SHA-256 differs from expectHash.
 * Hash-match check fails; mission fails.
 */
function makeE4Reasoning(): ReasoningProvider {
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
            contents: '# Plausible but wrong content\n',
          }),
        };
      }
      return {
        text: JSON.stringify({
          action: 'finish',
          summary: 'wrote the file',
          artifacts: [EXPECTED_FILE],
        }),
      };
    },
  };
}

/**
 * E5 — Worker writes content, but verification has a gate that requires
 * an ABSENT substring (proving the gate fails truthfully when content
 * does not match).
 */
function makeE5Reasoning(): ReasoningProvider {
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
          summary: 'wrote the file',
          artifacts: [EXPECTED_FILE],
        }),
      };
    },
  };
}

const SCENARIOS: readonly FailureScenario[] = [
  {
    id: 'E1-unknown-action',
    description: 'Worker emits an unknown action; parser should reject it',
    injected_failure: 'unknown action: fly_to_the_moon',
    reasoning_factory: makeE1Reasoning,
    checks_factory: (ctx) => buildStandardChecks(ctx),
  },
  {
    id: 'E2-missing-artifact',
    description: 'Worker finishes without writing the artifact; verification cannot find it',
    injected_failure: 'no write_file action emitted before finish',
    reasoning_factory: makeE2Reasoning,
    checks_factory: (ctx) => buildStandardChecks(ctx),
  },
  {
    id: 'E3-wrong-content',
    description: 'Worker writes wrong content; expectIncludes check fails',
    injected_failure: 'wrong content written (# Wrong content entirely)',
    reasoning_factory: makeE3Reasoning,
    checks_factory: (ctx) => buildStandardChecks(ctx),
  },
  {
    id: 'E4-hash-mismatch',
    description: 'Worker writes content whose SHA-256 differs from expectHash; hash-match fails',
    injected_failure: 'wrong content (plausible but wrong hash)',
    reasoning_factory: makeE4Reasoning,
    checks_factory: (ctx) => buildHashCheck(ctx),
  },
  {
    id: 'E5-verification-gate-fails',
    description: 'Worker writes correct content but a gate requires an absent substring; gate fails truthfully',
    injected_failure: 'gate requires substring that content does not contain',
    reasoning_factory: makeE5Reasoning,
    checks_factory: (ctx) => buildFailingGateCheck(ctx),
  },
];

function buildStandardChecks(context: {
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
  return [
    {
      kind: 'file',
      label: `${EXPECTED_FILE} exists in clean-room copy and contains the expected H1 heading`,
      path: cleanRoomPath(found.source, found.p),
      expectIncludes: EXPECTED_CONTENT.trim(),
    },
  ];
}

function buildHashCheck(context: {
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
  // Hash of EXPECTED_CONTENT — the worker writes DIFFERENT content, so this will fail
  const expectedHash = 'different-from-actual';
  return [
    {
      kind: 'hash-match',
      label: `${EXPECTED_FILE} hash matches expected SHA-256`,
      path: cleanRoomPath(found.source, found.p),
      expectHash: expectedHash,
    } as unknown as AcceptanceCheck,
  ];
}

function buildFailingGateCheck(context: {
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
  return [
    {
      kind: 'file',
      label: `${EXPECTED_FILE} contains the absent substring (this gate will fail truthfully)`,
      path: cleanRoomPath(found.source, found.p),
      expectIncludes: 'this-substring-is-not-in-the-content',
    },
  ];
}

type ChecksContext = Parameters<
  NonNullable<ConstructorParameters<typeof MissionOrchestrator>[0]['checks']>
>[0];

interface ScenarioResult {
  readonly scenario_id: string;
  readonly description: string;
  readonly injected_failure: string;
  readonly mission_status: string;
  readonly verification_ok: boolean;
  readonly verification_passed: number;
  readonly verification_failed: number;
  readonly false_success_observed: boolean;
  readonly flight_event_count: number;
  readonly flight_events_complete: boolean;
  readonly evidence_preserved: boolean;
  readonly thrown_error: string | null;
}

async function runScenario(s: FailureScenario): Promise<ScenarioResult> {
  const recorder = new MemoryFlightRecorder();
  const ownership = loadOwnership(path.join(REPO, 'data', 'ownership.yaml'));

  const computers = new Map<string, MemoryComputer>();
  const runtime: RuntimeAdapter = {
    name: 'g6-05-exp-E-memory-runtime',
    async ensureWorker(genome) {
      if (!computers.has(genome.identity.id)) {
        computers.set(genome.identity.id, new MemoryComputer());
      }
      return { workerId: genome.identity.id, ref: 'memory' };
    },
    async stopWorker() { /* no-op */ },
    surfaces(handle) {
      const computer = computers.get(handle.workerId) ?? new MemoryComputer();
      computers.set(handle.workerId, computer);
      return { computer };
    },
  } as unknown as RuntimeAdapter;

  const reasoning = s.reasoning_factory();
  const orchestrator = new MissionOrchestrator({
    goalCompiler: new GoalCompiler(),
    planner: new OrganizationPlanner(),
    genomeCompiler: new GenomeCompiler({
      registry: ownership,
      selectTier: (selection) =>
        new CognitiveRouter(new RuleDecisionProvider()).selectTier(selection),
    }),
    runtime,
    reasoning,
    reviewer: reasoning,
    recorder,
    missionId: `g6-05-exp-E-${s.id}`,
    costSource: () => ({ usd: 0, tokens: 0 }),
    maxWorkerSteps: 5,
    missionTimeoutMs: 30_000,
    checks: (ctx: ChecksContext) => s.checks_factory(ctx),
  });

  let result: MissionResult | null = null;
  let thrownError: unknown = null;
  try {
    result = await orchestrator.run(buildGoal());
  } catch (e) {
    thrownError = e;
  }

  const events = recorder.events as Array<{ type: string; [k: string]: unknown }>;
  const verificationEvent = events.find((e) => e.type === 'verification') as
    | { ok: boolean; passed: number; failed: number }
    | undefined;

  const missionSuccess = result?.status === 'success';
  const verificationPass = verificationEvent?.ok === true;
  const falseSuccess = missionSuccess && !verificationPass;

  // Flight events complete: must contain mission-started and mission-finished
  const flightComplete =
    events.some((e) => e.type === 'mission-started') &&
    events.some((e) => e.type === 'mission-finished');

  // Evidence preserved: flight recorder has events even on failure
  const evidencePreserved = events.length >= 3;

  return {
    scenario_id: s.id,
    description: s.description,
    injected_failure: s.injected_failure,
    mission_status: result?.status ?? 'threw',
    verification_ok: verificationPass ?? false,
    verification_passed: verificationEvent?.passed ?? 0,
    verification_failed: verificationEvent?.failed ?? 0,
    false_success_observed: falseSuccess,
    flight_event_count: events.length,
    flight_events_complete: flightComplete,
    evidence_preserved: evidencePreserved,
    thrown_error:
      thrownError instanceof Error
        ? `${thrownError.name}: ${thrownError.message}`
        : null,
  };
}

async function main(): Promise<void> {
  const results: ScenarioResult[] = [];
  for (const s of SCENARIOS) {
    results.push(await runScenario(s));
  }

  // Pass criterion: EVERY scenario must report failure truthfully
  // (mission_status != 'success' AND verification_ok = false AND no false_success)
  const allFailTruthfully = results.every(
    (r) =>
      r.mission_status !== 'success' &&
      r.verification_ok === false &&
      r.false_success_observed === false,
  );
  const allEvidencePreserved = results.every((r) => r.evidence_preserved);
  const pass = allFailTruthfully && allEvidencePreserved;

  const output = {
    experiment_id: 'G6-05-EXP-E',
    probe_at: new Date().toISOString(),
    source_head: '15243efae798f2ef90ec3a2ea185b17e798858fc',
    research_question:
      'Does Genesis avoid declaring success when required work has not been verified, across 5 failure modes?',
    hypothesis:
      'Across 5 failure-injection scenarios, Genesis reports mission_status != success AND verification.ok = false AND false_success_observed = 0 for every scenario.',
    independent_variable: 'injected failure mode (5 scenarios)',
    controlled_variables: [
      'RuleDecisionProvider (deterministic)',
      'MemoryComputer (in-memory filesystem)',
      'DEVELOPMENT_REASONING_FALLBACK (clearly labeled)',
      'MemoryFlightRecorder',
      'identical mission goal across scenarios (only failure injection differs)',
    ],
    comparator: 'NONE — truth criterion (failure must not become success)',
    scenarios: results,
    aggregate: {
      total_scenarios: results.length,
      scenarios_failed_truthfully: results.filter(
        (r) => r.mission_status !== 'success' && !r.false_success_observed,
      ).length,
      false_success_count: results.filter((r) => r.false_success_observed).length,
      evidence_preserved_count: results.filter((r) => r.evidence_preserved).length,
      flight_records_complete_count: results.filter((r) => r.flight_events_complete).length,
    },
    limitations: [
      'Deterministic failure injection — the worker\'s failure behavior is scripted. This is real Genesis production behavior on a controlled failure stub.',
      'Does NOT exercise the optional-provider-unavailable case (Jev) directly — that case is covered by G6-03A\'s persisted evidence (7 failure-truthfulness probes all PASS).',
      'Does NOT exercise external-provider failures (OpenBot disconnect, OpenMuse queue failure) — covered by G6-01 hardening evidence.',
      'N=5 scenarios; not exhaustive of all failure modes.',
    ],
    evidence_level: 'E3',
    evidence_level_justification:
      'Controlled experiment using deterministic production code. Failure injection is real Genesis production behavior (WorkerAgent action parsing, VerificationLoop clean-room copy, hash-match check); reasoning is scripted. Valid for tested failure modes only.',
    pass,
  };

  fs.writeFileSync(
    path.join(__dirname, 'results.json'),
    JSON.stringify(output, null, 2) + '\n',
  );

  console.log('--- G6-05 EXP-E EVIDENCE ---');
  console.log(JSON.stringify(output, null, 2));
  console.log('--- END EVIDENCE ---');
  console.log(`EXP_E_PASS = ${pass}`);
  process.exit(pass ? 0 : 1);
}

await main();
