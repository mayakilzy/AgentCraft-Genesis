/**
 * G6-05 Experiment D — Transfer & Non-Applicability
 *
 * Research question: Does Genesis apply learned patterns to relevant unseen
 * tasks WITHOUT blindly applying them to unrelated tasks?
 *
 * Two unseen missions (never used to create the patterns):
 *   D1 — research domain (applicable): the trusted research/general pattern
 *        is legitimately applicable.
 *   D2 — software-engineering domain (non-applicable): no trusted pattern
 *        legitimately matches.
 *
 * For each mission, we run TWO arms:
 *   - BASELINE:   patterns: [] (no learned knowledge available)
 *   - LEARNED:    patterns: TRUSTED_PATTERNS (3 frozen trusted patterns)
 *
 * Held-out verification: D1 and D2 use NEW mission wordings distinct from
 * any mission that participated in Cohort 001 or 002 training.
 *
 * Evidence output: experiments/g6-05/exp-D/results.json
 */
import * as path from 'node:path';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { Goal, RuntimeAdapter } from '../../../src/contracts/core.js';
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

/**
 * Three trusted patterns frozen at G5-07 (support=3, support=2, support=2).
 * Source: experiments/academy/g5-07/frozen-pattern-state.json
 */
const TRUSTED_PATTERNS: readonly AdvisoryPattern[] = [
  {
    id: 'cand-research-document-authoring-prefer-sole-operator',
    applicableContext: {
      domain: 'research',
      capabilityNeeds: ['document-authoring', 'web-research'],
    },
    proposedEffect: {
      kind: 'prefer-role',
      description: 'Prefer Sole Operator for research+document-authoring missions.',
      targetRole: 'Sole Operator',
      targetShape: { workerCount: 1 },
    },
  },
  {
    id: 'cand-research-document-authoring-web-research-prefer-sole-operator',
    applicableContext: {
      domain: 'research',
      capabilityNeeds: ['document-authoring', 'web-research'],
    },
    proposedEffect: {
      kind: 'prefer-role',
      description: 'Prefer Sole Operator for research+document-authoring+web-research missions.',
      targetRole: 'Sole Operator',
      targetShape: { workerCount: 1 },
    },
  },
  {
    id: 'cand-general-data-analysis-document-authoring-prefer-sole-operator',
    applicableContext: {
      domain: 'general',
      capabilityNeeds: ['data-analysis', 'document-authoring'],
    },
    proposedEffect: {
      kind: 'prefer-role',
      description: 'Prefer Sole Operator for general data-analysis+document-authoring missions.',
      targetRole: 'Sole Operator',
      targetShape: { workerCount: 1 },
    },
  },
];

interface MissionCase {
  readonly id: string;
  readonly expected_applicability: 'APPLICABLE' | 'NON_APPLICABLE';
  readonly goal: Goal;
  readonly deliverable: string;
  readonly deliverableContent: string;
  readonly expectIncludes: string;
}

const CASES: readonly MissionCase[] = [
  {
    id: 'D1-research-applicable',
    expected_applicability: 'APPLICABLE',
    goal: {
      outcome:
        'Investigate the most common vector database deployment models and document ' +
        'the three most impactful differences as a markdown brief named d1-brief.md with citations.',
      context:
        'The audience is a senior engineering team evaluating deployment options.',
      constraints: ['Must produce a markdown file named d1-brief.md', 'Must contain a single H1 heading'],
      budget: { maxUsd: 5, tier: 'default' },
    },
    deliverable: 'd1-brief.md',
    deliverableContent: '# Vector DB deployment models\n\nThree deployment models were identified.\n',
    expectIncludes: '# Vector DB deployment models',
  },
  {
    id: 'D2-software-engineering-non-applicable',
    expected_applicability: 'NON_APPLICABLE',
    goal: {
      outcome:
        'Implement a small TypeScript function `sum(a, b)` that returns the sum, ' +
        'and verify it passes a test that asserts sum(2, 3) === 5.',
      context:
        'The function must be added to src/lib/math.ts and a test added to tests/lib/math.test.ts.',
      constraints: ['Must not modify any other source files'],
      budget: { maxUsd: 5, tier: 'default' },
    },
    deliverable: 'math.ts',
    deliverableContent: 'export function sum(a: number, b: number): number { return a + b; }\n',
    expectIncludes: 'export function sum',
  },
];

function makeScriptedReasoning(deliverable: string, content: string) {
  let step = 0;
  return {
    name: 'DEVELOPMENT_REASONING_FALLBACK',
    async reason() {
      step += 1;
      if (step === 1) {
        return {
          text: JSON.stringify({
            action: 'write_file',
            path: deliverable,
            contents: content,
          }),
        };
      }
      return {
        text: JSON.stringify({
          action: 'finish',
          summary: `wrote ${deliverable}`,
          artifacts: [deliverable],
        }),
      };
    },
  };
}

function buildChecks(
  context: { artifacts: ReadonlyArray<ArtifactSource> },
  deliverable: string,
  expectIncludes: string,
): readonly AcceptanceCheck[] {
  const found = context.artifacts
    .flatMap((source) => source.paths.map((p) => ({ source, p })))
    .find(({ p }) => p.endsWith(deliverable));
  if (found === undefined) {
    return [
      {
        kind: 'file',
        label: `${deliverable} was produced`,
        path: `artifacts/missing/${deliverable}`,
      },
    ];
  }
  return [
    {
      kind: 'file',
      label: `${deliverable} exists in clean-room copy and contains the expected content`,
      path: cleanRoomPath(found.source, found.p),
      expectIncludes,
    },
  ];
}

type ChecksContext = Parameters<
  NonNullable<ConstructorParameters<typeof MissionOrchestrator>[0]['checks']>
>[0];

interface ArmResult {
  readonly arm: 'baseline' | 'learned';
  readonly patterns_available: number;
  readonly patterns_retrieved: number;
  readonly pattern_applicable: boolean;
  readonly pattern_applied: boolean;
  readonly organization_changed: boolean;
  readonly worker_count: number;
  readonly roles: readonly string[];
  readonly mission_status: string;
  readonly verification_ok: boolean;
  readonly verification_passed: number;
  readonly verification_failed: number;
  readonly harmful_transfer: boolean;
}

async function runArm(
  c: MissionCase,
  arm: 'baseline' | 'learned',
): Promise<ArmResult> {
  const ownership = loadOwnership(path.join(REPO, 'data', 'ownership.yaml'));
  const compiler = new GoalCompiler();
  const requirements = await compiler.compile(c.goal);

  const patterns = arm === 'learned' ? TRUSTED_PATTERNS : [];
  const planner = new OrganizationPlanner({ patterns });
  const plan = planner.plan(requirements);

  const learned = (plan as unknown as {
    learned?: {
      considered?: readonly string[];
      applied?: readonly { patternId: string; effect: string }[];
    };
  }).learned;
  const patternsRetrieved = learned?.considered?.length ?? 0;
  const patternApplicable = patternsRetrieved > 0;
  const patternApplied = (learned?.applied ?? []).length > 0;

  const computers = new Map<string, MemoryComputer>();
  const runtime: RuntimeAdapter = {
    name: 'g6-05-exp-D-memory-runtime',
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

  const recorder = new MemoryFlightRecorder();
  const orchestrator = new MissionOrchestrator({
    goalCompiler: compiler,
    planner,
    genomeCompiler: new GenomeCompiler({
      registry: ownership,
      selectTier: (selection) =>
        new CognitiveRouter(new RuleDecisionProvider()).selectTier(selection),
    }),
    runtime,
    reasoning: makeScriptedReasoning(c.deliverable, c.deliverableContent),
    reviewer: makeScriptedReasoning(c.deliverable, c.deliverableContent),
    recorder,
    missionId: `g6-05-exp-D-${c.id}-${arm}`,
    costSource: () => ({ usd: 0, tokens: 0 }),
    maxWorkerSteps: 5,
    missionTimeoutMs: 30_000,
    checks: (ctx: ChecksContext) => buildChecks(ctx, c.deliverable, c.expectIncludes),
  });

  let result;
  try {
    result = await orchestrator.run(c.goal);
  } catch {
    /* swallow */
  }

  const events = recorder.events as Array<{ type: string; [k: string]: unknown }>;
  const verificationEvent = events.find((e) => e.type === 'verification') as
    | { ok: boolean; passed: number; failed: number }
    | undefined;

  // Harmful transfer: pattern applied to non-applicable case AND caused failure
  // (or pattern was retrieved for non-applicable case AND would have caused incorrect org)
  const harmfulTransfer =
    c.expected_applicability === 'NON_APPLICABLE' &&
    patternApplied &&
    verificationEvent?.ok === false;

  return {
    arm,
    patterns_available: patterns.length,
    patterns_retrieved: patternsRetrieved,
    pattern_applicable: patternApplicable,
    pattern_applied: patternApplied,
    organization_changed: patternApplied,
    worker_count: plan.workers.length,
    roles: plan.workers.map((w) => w.role),
    mission_status: result?.status ?? 'threw',
    verification_ok: verificationEvent?.ok ?? false,
    verification_passed: verificationEvent?.passed ?? 0,
    verification_failed: verificationEvent?.failed ?? 0,
    harmful_transfer: harmfulTransfer,
  };
}

async function main(): Promise<void> {
  const output: Record<string, unknown> = {
    experiment_id: 'G6-05-EXP-D',
    probe_at: new Date().toISOString(),
    source_head: '15243efae798f2ef90ec3a2ea185b17e798858fc',
    research_question:
      'Does Genesis apply learned patterns to relevant unseen tasks WITHOUT blindly applying them to unrelated tasks?',
    hypothesis:
      'Genesis retrieves and considers an applicable pattern for an unseen research mission AND retrieves no pattern for an unseen software-engineering mission, with mission correctness preserved in both cases.',
    independent_variable: 'mission domain (research vs software-engineering)',
    controlled_variables: [
      'RuleDecisionProvider (deterministic)',
      'MemoryComputer (in-memory filesystem)',
      'DEVELOPMENT_REASONING_FALLBACK (clearly labeled)',
      'frozen trusted pattern state (3 patterns, 0 software-engineering patterns)',
      'identical verification checks across arms for each mission',
    ],
    trusted_patterns_count: TRUSTED_PATTERNS.length,
    held_out_verification: 'D1 and D2 use NEW mission wordings distinct from any Cohort 001/002 training mission.',
    cases: [] as unknown[],
  };

  let allPass = true;
  for (const c of CASES) {
    const baseline = await runArm(c, 'baseline');
    const learned = await runArm(c, 'learned');

    let classification: string;
    if (c.expected_applicability === 'NON_APPLICABLE') {
      // Non-applicable case: pattern should NOT be retrieved/applied
      if (!learned.pattern_applicable && !learned.harmful_transfer) {
        classification = 'NON_APPLICABLE (correct non-application)';
      } else {
        classification = 'HARMFUL_TRANSFER (pattern wrongly applied to non-applicable mission)';
        allPass = false;
      }
    } else {
      // Applicable case: pattern should be retrieved (considered); applied is optional
      if (learned.pattern_applicable && !learned.harmful_transfer) {
        classification = learned.organization_changed
          ? 'ACTIVE_TRANSFER (pattern retrieved, applied, organization changed)'
          : 'CONFIRMATORY_TRANSFER (pattern retrieved, considered; baseline already satisfied preference)';
      } else {
        classification = 'INCONCLUSIVE';
        allPass = false;
      }
    }

    (output.cases as unknown[]).push({
      case_id: c.id,
      expected_applicability: c.expected_applicability,
      mission_outcome: c.goal.outcome,
      baseline_arm: baseline,
      learned_arm: learned,
      transfer_classification: classification,
      mission_correctness_preserved:
        (baseline.verification_ok || learned.verification_ok) && !learned.harmful_transfer,
    });
  }

  (output as Record<string, unknown>).limitations = [
    'The pattern retrieval is structural (intersection rule) — confirmatory retrieval is NOT active causal transfer. This matches the G5-07 finding (0 ACTIVE_TRANSFER, 3 CONFIRMATORY_TRANSFER, 1 NON_APPLICABLE).',
    'Scripted reasoning — the worker actions are scripted identically across arms.',
    'N=2 missions; not statistical evidence of universal transfer.',
  ];
  (output as Record<string, unknown>).evidence_level = 'E3';
  (output as Record<string, unknown>).evidence_level_justification =
    'Controlled experiment using deterministic production code. Pattern retrieval and application are real production behavior; reasoning is scripted. Same limitation class as G5-07.';
  (output as Record<string, unknown>).pass = allPass;

  fs.writeFileSync(
    path.join(__dirname, 'results.json'),
    JSON.stringify(output, null, 2) + '\n',
  );

  console.log('--- G6-05 EXP-D EVIDENCE ---');
  console.log(JSON.stringify(output, null, 2));
  console.log('--- END EVIDENCE ---');
  console.log(`EXP_D_PASS = ${allPass}`);
  process.exit(allPass ? 0 : 1);
}

await main();
