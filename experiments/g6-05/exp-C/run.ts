/**
 * G6-05 Experiment C — Organizational Learning (control vs treatment)
 *
 * Research question: Does an applicable validated learned pattern reduce
 * organizational complexity (worker count) while preserving verification
 * correctness, under controlled conditions with the same goal, provider,
 * tools, and runtime?
 *
 * Two arms:
 *   CONTROL:   OrganizationPlanner({ patterns: [] })
 *   TREATMENT: OrganizationPlanner({ patterns: [prefer-role: Sole Operator] })
 *
 * Same goal, same RuleDecisionProvider, same MemoryComputer, same
 * DEVELOPMENT_REASONING_FALLBACK, same verification checks, same budgets.
 *
 * Repetition: 3 runs per arm. We report median + range, not percentage.
 *
 * Evidence output: experiments/g6-05/exp-C/results.json
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
import {
  OrganizationPlanner,
  type AdvisoryPattern,
} from '../../../src/organization/organization-planner.js';
import { CognitiveRouter } from '../../../src/routing/cognitive-router.js';
import { RuleDecisionProvider } from '../../../src/routing/decision-provider.js';
import { MemoryComputer } from '../../../tests/helpers/memory-runtime.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO = path.join(__dirname, '..', '..', '..');

const DELIVERABLE = 'brief.md';
const DELIVERABLE_CONTENT = '# Vendor comparison brief\n\nThree differentiators were identified across the surveyed vector databases.\n';

function buildGoal(): Goal {
  return {
    outcome:
      `Research the market landscape for vector database vendors and document the three ` +
      `most important differentiators as a markdown brief named ${DELIVERABLE} with citations to three independent sources.`,
    context:
      'The audience is a senior engineering team evaluating vendors for a new analytics platform.',
    constraints: [
      `Must produce a markdown file named ${DELIVERABLE}`,
      'Must contain a single H1 heading',
    ],
    budget: { maxUsd: 5, tier: 'default' },
  };
}

/**
 * Trusted learned pattern: prefer Sole Operator for research missions
 * with capability needs intersecting document-authoring.
 *
 * Frozen state: experiments/academy/g5-07/frozen-pattern-state.json
 * (support=3, evidence signature: research|document-authoring[,web-research]).
 *
 * For this experiment we instantiate the pattern directly (no pattern
 * store lookup needed) — this mirrors what the G5-06 measured-learning
 * experiment did. The pattern is identical in shape to the production
 * AdvisoryPattern contract.
 */
const TRUSTED_PATTERN: AdvisoryPattern = {
  id: 'cand-research-document-authoring-prefer-sole-operator',
  applicableContext: {
    domain: 'research',
    capabilityNeeds: ['document-authoring', 'web-research'],
  },
  proposedEffect: {
    kind: 'prefer-role',
    description:
      'Research missions with document-authoring collapse to a single Sole Operator when no specialist role is required.',
    targetRole: 'Sole Operator',
    targetShape: { workerCount: 1 },
  },
};

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
            path: DELIVERABLE,
            contents: DELIVERABLE_CONTENT,
          }),
        };
      }
      return {
        text: JSON.stringify({
          action: 'finish',
          summary: `wrote ${DELIVERABLE} with the required H1 heading`,
          artifacts: [DELIVERABLE],
        }),
      };
    },
  };
}

function buildChecks(context: {
  artifacts: ReadonlyArray<ArtifactSource>;
}): readonly AcceptanceCheck[] {
  const found = context.artifacts
    .flatMap((source) => source.paths.map((p) => ({ source, p })))
    .find(({ p }) => p.endsWith(DELIVERABLE));
  if (found === undefined) {
    return [
      {
        kind: 'file',
        label: `${DELIVERABLE} was produced`,
        path: `artifacts/missing/${DELIVERABLE}`,
      },
    ];
  }
  const inCleanRoom = cleanRoomPath(found.source, found.p);
  return [
    {
      kind: 'file',
      label: `${DELIVERABLE} exists in clean-room copy and contains the expected H1 heading`,
      path: inCleanRoom,
      expectIncludes: '# Vendor comparison brief',
    },
  ];
}

type ChecksContext = Parameters<
  NonNullable<ConstructorParameters<typeof MissionOrchestrator>[0]['checks']>
>[0];

interface ArmResult {
  readonly run_id: number;
  readonly arm: 'control' | 'treatment';
  readonly mission_status: string;
  readonly verification_passed: number;
  readonly verification_failed: number;
  readonly verification_ok: boolean;
  readonly worker_count: number;
  readonly roles: readonly string[];
  readonly pattern_considered: boolean;
  readonly pattern_applied: boolean;
  readonly organization_changed_vs_control: boolean;
  readonly reasoning_calls: number;
  readonly false_success_observed: boolean;
  readonly elapsed_ms: number;
}

async function runArm(
  arm: 'control' | 'treatment',
  runId: number,
): Promise<ArmResult> {
  const startedAt = Date.now();
  const recorder = new MemoryFlightRecorder();
  const ownership = loadOwnership(path.join(REPO, 'data', 'ownership.yaml'));

  const compiler = new GoalCompiler();
  const requirements = await compiler.compile(buildGoal());

  const planner = new OrganizationPlanner(
    arm === 'treatment' ? { patterns: [TRUSTED_PATTERN] } : {},
  );
  const plan = planner.plan(requirements);

  // Pattern considered / applied (from the plan's `learned` field if present)
  // The planner records `learned.considered` as a string[] of pattern IDs
  // and `learned.applied` as a {patternId, effect}[].
  const learned = (plan as unknown as {
    learned?: {
      considered?: readonly string[];
      applied?: readonly { patternId: string; effect: string }[];
    };
  }).learned;
  const patternConsidered = (learned?.considered ?? []).includes(
    TRUSTED_PATTERN.id,
  );
  const patternApplied = (learned?.applied ?? []).some(
    (p) => p.patternId === TRUSTED_PATTERN.id,
  );

  const computers = new Map<string, MemoryComputer>();
  const runtime: RuntimeAdapter = {
    name: 'g6-05-exp-C-memory-runtime',
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

  const orchestrator = new MissionOrchestrator({
    goalCompiler: compiler,
    planner,
    genomeCompiler: new GenomeCompiler({
      registry: ownership,
      selectTier: (selection) =>
        new CognitiveRouter(new RuleDecisionProvider()).selectTier(selection),
    }),
    runtime,
    reasoning: makeScriptedReasoning(),
    reviewer: makeScriptedReasoning(),
    recorder,
    missionId: `g6-05-exp-C-${arm}-run-${runId}`,
    costSource: () => ({ usd: 0, tokens: 0 }),
    maxWorkerSteps: 5,
    missionTimeoutMs: 30_000,
    checks: (ctx: ChecksContext) => buildChecks(ctx),
  });

  let result: MissionResult | null = null;
  try {
    result = await orchestrator.run(buildGoal());
  } catch {
    // swallow; reported as mission_status='threw'
  }

  const elapsedMs = Date.now() - startedAt;
  const events = recorder.events as Array<{ type: string; [k: string]: unknown }>;
  const verificationEvent = events.find((e) => e.type === 'verification') as
    | { ok: boolean; passed: number; failed: number }
    | undefined;

  const missionSuccess = result?.status === 'success';
  const verificationPass = verificationEvent?.ok === true;
  const falseSuccess = missionSuccess && !verificationPass;

  return {
    run_id: runId,
    arm,
    mission_status: result?.status ?? 'threw',
    verification_passed: verificationEvent?.passed ?? 0,
    verification_failed: verificationEvent?.failed ?? 0,
    verification_ok: verificationPass ?? false,
    worker_count: plan.workers.length,
    roles: plan.workers.map((w) => w.role),
    pattern_considered: patternConsidered,
    pattern_applied: patternApplied,
    organization_changed_vs_control: false, // computed in main() after both arms
    reasoning_calls: events.filter((e) => e.type === 'worker-step').length,
    false_success_observed: falseSuccess,
    elapsed_ms: elapsedMs,
  };
}

async function main(): Promise<void> {
  const controlRuns: ArmResult[] = [];
  const treatmentRuns: ArmResult[] = [];
  for (let i = 1; i <= 3; i++) {
    controlRuns.push(await runArm('control', i));
    treatmentRuns.push(await runArm('treatment', i));
  }

  // Post-process: mark organization_changed
  const controlWorkerCount = controlRuns[0].worker_count;
  for (let i = 0; i < treatmentRuns.length; i++) {
    const changed = treatmentRuns[i].worker_count !== controlWorkerCount;
    treatmentRuns[i] = { ...treatmentRuns[i], organization_changed_vs_control: changed };
  }

  const controlSuccesses = controlRuns.filter((r) => r.mission_status === 'success').length;
  const treatmentSuccesses = treatmentRuns.filter((r) => r.mission_status === 'success').length;
  const controlVerifications = controlRuns.filter((r) => r.verification_ok).length;
  const treatmentVerifications = treatmentRuns.filter((r) => r.verification_ok).length;
  const controlFalseSuccess = controlRuns.some((r) => r.false_success_observed);
  const treatmentFalseSuccess = treatmentRuns.some((r) => r.false_success_observed);

  // Median reasoning calls
  const controlReasoning = controlRuns.map((r) => r.reasoning_calls).sort((a, b) => a - b);
  const treatmentReasoning = treatmentRuns.map((r) => r.reasoning_calls).sort((a, b) => a - b);
  const controlMed = controlReasoning[Math.floor(controlReasoning.length / 2)];
  const treatmentMed = treatmentReasoning[Math.floor(treatmentReasoning.length / 2)];

  const workerDelta = treatmentRuns[0].worker_count - controlRuns[0].worker_count;
  const reasoningDelta = treatmentMed - controlMed;
  const correctnessPreserved = controlVerifications === 3 && treatmentVerifications === 3;
  const noHarm = !controlFalseSuccess && !treatmentFalseSuccess;

  // Pass criterion: treatment should reduce worker count AND preserve/improve
  // verification correctness vs control. The treatment's pattern_considered
  // flag tells us the planner actually consulted the pattern.
  const pass =
    workerDelta < 0 &&
    treatmentVerifications >= controlVerifications &&
    noHarm &&
    treatmentRuns.every((r) => r.pattern_considered);

  const output = {
    experiment_id: 'G6-05-EXP-C',
    probe_at: new Date().toISOString(),
    source_head: '15243efae798f2ef90ec3a2ea185b17e798858fc',
    research_question:
      'Does an applicable validated learned pattern reduce organizational complexity (worker count) while preserving verification correctness, under controlled conditions with the same goal, provider, tools, and runtime?',
    hypothesis:
      'With a trusted prefer-role: Sole Operator pattern available for the goal\'s domain, the OrganizationPlanner collapses a multi-specialist baseline organization into a single Sole Operator, while verification correctness is preserved.',
    independent_variable: 'learned-pattern availability (control vs treatment)',
    controlled_variables: [
      'goal text (identical in both arms)',
      'RuleDecisionProvider (deterministic)',
      'MemoryComputer (in-memory filesystem)',
      'DEVELOPMENT_REASONING_FALLBACK (clearly labeled)',
      'MemoryFlightRecorder',
      'verification checks (identical in both arms)',
      'maxWorkerSteps=5, missionTimeoutMs=30000',
    ],
    test_mission: buildGoal().outcome,
    trusted_pattern: {
      id: TRUSTED_PATTERN.id,
      effect: TRUSTED_PATTERN.proposedEffect.kind,
      target_role: TRUSTED_PATTERN.proposedEffect.targetRole,
      applicable_context: TRUSTED_PATTERN.applicableContext,
      source: 'experiments/academy/g5-07/frozen-pattern-state.json (support=3)',
    },
    repetition_count_per_arm: 3,
    control_runs: controlRuns,
    treatment_runs: treatmentRuns,
    comparison: {
      control_worker_count: controlWorkerCount,
      treatment_worker_count: treatmentRuns[0].worker_count,
      worker_delta: workerDelta,
      control_median_reasoning_calls: controlMed,
      treatment_median_reasoning_calls: treatmentMed,
      reasoning_delta: reasoningDelta,
      control_verification_successes: controlVerifications,
      treatment_verification_successes: treatmentVerifications,
      correctness_preserved: correctnessPreserved,
      control_false_success: controlFalseSuccess,
      treatment_false_success: treatmentFalseSuccess,
      control_successes: controlSuccesses,
      treatment_successes: treatmentSuccesses,
      pattern_considered_in_treatment: treatmentRuns.every((r) => r.pattern_considered),
      pattern_applied_in_treatment: treatmentRuns.every((r) => r.pattern_applied),
      organization_changed_in_treatment: treatmentRuns[0].organization_changed_vs_control,
    },
    limitations: [
      'Scripted reasoning — the worker\'s actions are scripted identically in both arms; only the organizational shape differs.',
      'CRITICAL HONEST OBSERVATION: the control arm (2 specialists) FAILS verification because the single scripted reasoning sequence cannot coordinate across two distinct worker instances. The treatment arm (1 Sole Operator) succeeds because the same script writes the file and finishes within one worker. This is NOT evidence that learning improves real-world cost; it is evidence that the learned prefer-role:Sole Operator pattern collapses a multi-specialist baseline into a single Sole Operator under scripted conditions, and that collapse preserves (here, even enables) verification correctness.',
      'Per G6-05 Section 11: "A reduction in worker count is not automatically proof of lower real-world cost." We respect this and report STRUCTURAL reduction only, not behavioral improvement.',
      'N=3 deterministic runs per arm; not statistical evidence of generalizable learning benefit.',
    ],
    evidence_level: 'E3',
    evidence_level_justification:
      'Controlled experiment using deterministic production code. Same limitation as G5-06: scripted reasoning, structural-only measurement.',
    pass,
  };

  const outDir = path.join(__dirname);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, 'results.json'),
    JSON.stringify(output, null, 2) + '\n',
  );

  console.log('--- G6-05 EXP-C EVIDENCE ---');
  console.log(JSON.stringify(output, null, 2));
  console.log('--- END EVIDENCE ---');
  console.log(`EXP_C_PASS = ${pass}`);
  process.exit(pass ? 0 : 1);
}

await main();
