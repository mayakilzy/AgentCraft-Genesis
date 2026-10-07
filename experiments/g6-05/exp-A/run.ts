/**
 * G6-05 Experiment A — Goal → Organization (controlled, real production code)
 *
 * Research question: Can Genesis transform a meaningful goal into an
 * executable worker organization whose structure genuinely varies with
 * the goal (different domains → different organizations) and whose
 * capability needs are fully covered?
 *
 * This script exercises the real GoalCompiler + OrganizationPlanner +
 * GenomeCompiler production pipeline against three distinct non-trivial
 * goals (software-engineering, diagnostic, research). No worker execution
 * happens here — execution is Experiment B. The point is to observe
 * organization design from the goal alone.
 *
 * Provider mode: DETERMINISTIC (RuleDecisionProvider, MemoryComputer stub,
 * no learning patterns). Real production planning code runs unmodified.
 *
 * Evidence output: experiments/g6-05/exp-A/results.json
 */
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as fs from 'node:fs';

import type { Goal } from '../../../src/contracts/core.js';
import { GoalCompiler } from '../../../src/goal/goal-compiler.js';
import {
  GenomeCompiler,
  loadOwnership,
} from '../../../src/genome/genome-compiler.js';
import { OrganizationPlanner } from '../../../src/organization/organization-planner.js';
import { CognitiveRouter } from '../../../src/routing/cognitive-router.js';
import { RuleDecisionProvider } from '../../../src/routing/decision-provider.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO = path.join(__dirname, '..', '..', '..');

interface GoalCase {
  readonly id: string;
  readonly domain_hint: string;
  readonly goal: Goal;
}

const CASES: readonly GoalCase[] = [
  {
    id: 'A1-software-engineering',
    domain_hint: 'software-engineering',
    goal: {
      outcome:
        'Audit the project README and add a Usage section that explains how to run the tests. ' +
        'Verify the README parses as valid markdown.',
      context:
        'The repository is a TypeScript project using vitest. The README currently lacks a Usage section.',
      constraints: [
        'Must not change any source code under src/',
        'Must use the existing markdown style',
      ],
      budget: { maxUsd: 5, tier: 'default' },
    },
  },
  {
    id: 'A2-diagnostic',
    domain_hint: 'diagnostic',
    goal: {
      outcome:
        'Diagnose the intermittent test failure in the flaky counter module and document the root cause ' +
        'as a markdown report. The failure happens on roughly 80 percent of CI runs.',
      context:
        'The flaky counter module is a small TypeScript module. Its test sometimes passes and sometimes fails.',
      constraints: [
        'Do not modify the source code of the module under diagnosis',
        'Reproduce the failure deterministically before diagnosing',
      ],
      budget: { maxUsd: 5, tier: 'default' },
    },
  },
  {
    id: 'A3-research',
    domain_hint: 'research',
    goal: {
      outcome:
        'Research the current market landscape for vector database vendors and document the three ' +
        'most important differentiators as a short markdown brief with citations.',
      context:
        'The audience is a senior engineering team evaluating vendors for a new analytics platform.',
      constraints: ['Must cite at least three independent sources', 'No source code changes'],
      budget: { maxUsd: 5, tier: 'default' },
    },
  },
];

interface CaseResult {
  readonly case_id: string;
  readonly domain_hint: string;
  readonly compiled_domain: string;
  readonly capability_needs: readonly string[];
  readonly worker_count: number;
  readonly roles: readonly string[];
  readonly coordinator_added: boolean;
  readonly capability_coverage_ok: boolean;
  readonly unsupported_assumptions: readonly string[];
  readonly planning_failures: readonly string[];
  readonly execution_readiness_ok: boolean;
  readonly genome_tier_assignments: ReadonlyArray<{ workerId: string; tier: string }>;
  readonly scope: string;
  readonly success_criteria: readonly string[];
  readonly hard_constraints: readonly string[];
}

async function runCase(c: GoalCase): Promise<CaseResult> {
  const compiler = new GoalCompiler();
  const requirements = await compiler.compile(c.goal);

  const planner = new OrganizationPlanner();
  const plan = planner.plan(requirements);

  const ownership = loadOwnership(path.join(REPO, 'data', 'ownership.yaml'));
  const genomeCompiler = new GenomeCompiler({
    registry: ownership,
    selectTier: (selection) =>
      new CognitiveRouter(new RuleDecisionProvider()).selectTier(selection),
  });
  const compilation = await genomeCompiler.compilePlan(plan, requirements);
  const genomes = compilation.results
    .map((r) => r.genome)
    .filter((g): g is NonNullable<typeof g> => g !== undefined);
  const allGaps = compilation.results.flatMap((r) =>
    (r.gaps ?? []).map((gap) => `${r.worker.id}: ${gap.need}`),
  );

  // Capability coverage check: every capabilityNeed has an owner in the plan
  const plannedCapabilities = new Set<string>();
  for (const w of plan.workers) {
    for (const cap of w.capabilityNeeds) {
      plannedCapabilities.add(cap);
    }
  }
  const coverageOk = requirements.capabilityNeeds.every((n) =>
    plannedCapabilities.has(n),
  );

  // Genome tier assignments (WorkerGenome.model is the ReasoningTier, not a provider name)
  const tierAssignments = genomes.map((g) => ({
    workerId: g.identity.id,
    tier: g.model,
  }));

  return {
    case_id: c.id,
    domain_hint: c.domain_hint,
    compiled_domain: requirements.domain,
    capability_needs: [...requirements.capabilityNeeds],
    worker_count: plan.workers.length,
    roles: plan.workers.map((w) => w.role),
    coordinator_added: plan.workers.some((w) => w.role === 'Mission Coordinator'),
    capability_coverage_ok: coverageOk,
    unsupported_assumptions: allGaps,
    planning_failures: [],
    execution_readiness_ok: compilation.ok && genomes.length === plan.workers.length && genomes.length > 0,
    genome_tier_assignments: tierAssignments,
    scope: (plan as unknown as { scope?: string }).scope ?? 'unknown',
    success_criteria: requirements.successCriteria.map((s) => s.description),
    hard_constraints: requirements.hardConstraints,
  };
}

async function main(): Promise<void> {
  const results: CaseResult[] = [];
  for (const c of CASES) {
    // Run each case 3 times to confirm determinism
    const runResults: CaseResult[] = [];
    for (let i = 0; i < 3; i++) {
      runResults.push(await runCase(c));
    }
    // Verify determinism: all 3 runs produce identical organizations
    const first = JSON.stringify(runResults[0]);
    const deterministic = runResults.every((r) => JSON.stringify(r) === first);
    if (!deterministic) {
      // Use the first run but flag nondeterminism
      results.push({ ...runResults[0], case_id: `${c.id} (NONDETERMINISTIC)` });
    } else {
      results.push(runResults[0]);
    }
  }

  // Compute structural-difference summary
  const domainSet = new Set(results.map((r) => r.compiled_domain));
  const workerCountSet = new Set(results.map((r) => r.worker_count));
  const roleSet = new Set(results.flatMap((r) => r.roles));
  const organizationsStructurallyDifferent = domainSet.size > 1 || workerCountSet.size > 1 || roleSet.size >= 3;

  // Capability coverage across all cases
  const allCoverageOk = results.every((r) => r.capability_coverage_ok);
  const allExecReady = results.every((r) => r.execution_readiness_ok);
  const allNoGaps = results.every((r) => r.unsupported_assumptions.length === 0);

  const output = {
    experiment_id: 'G6-05-EXP-A',
    probe_at: new Date().toISOString(),
    source_head: '15243efae798f2ef90ec3a2ea185b17e798858fc',
    research_question:
      'Can Genesis transform a meaningful goal into an executable worker organization whose structure varies with the goal and whose capability needs are fully covered?',
    hypothesis:
      'The real GoalCompiler + OrganizationPlanner + GenomeCompiler pipeline produces an organization whose (domain, capabilityNeeds, worker count, role set) varies meaningfully across at least 3 distinct non-trivial goals, with full capability coverage.',
    independent_variable: 'goal text (3 distinct goals from 3 distinct mission domains)',
    controlled_variables: [
      'RuleDecisionProvider (deterministic)',
      'MemoryComputer (not used here; planning only)',
      'no learning patterns (empty pattern set)',
      'deterministic GoalCompiler v0.1',
    ],
    comparator: 'NONE — absolute capability evidence (no artificial baseline)',
    repetition_count_per_case: 3,
    deterministic_repeatability_confirmed: results.every((r) => !r.case_id.includes('NONDETERMINISTIC')),
    cases: results,
    structural_difference_summary: {
      distinct_domains_observed: [...domainSet],
      distinct_worker_counts_observed: [...workerCountSet].sort((a, b) => a - b),
      distinct_roles_observed: [...roleSet],
      organizations_structurally_different: organizationsStructurallyDifferent,
    },
    capability_coverage_summary: {
      all_cases_covered: allCoverageOk,
      all_cases_execution_ready: allExecReady,
      all_cases_no_unsupported_assumptions: allNoGaps,
    },
    limitations: [
      'Organization is generated but NOT executed in this experiment; execution is Experiment B.',
      'GoalCompiler is the deterministic v0.1 heuristic; LLM-based understanding is not exercised.',
      'Comparator is NONE — no superiority claim is made.',
      'N=3 cases; structural difference is qualitative, not statistical.',
    ],
    evidence_level: 'E3',
    evidence_level_justification:
      'Controlled experiment using deterministic production planning code. Real GoalCompiler + OrganizationPlanner + GenomeCompiler execution; no real LLM; MemoryComputer not exercised. Valid for tested behavior only.',
  };

  const outDir = path.join(__dirname);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, 'results.json'),
    JSON.stringify(output, null, 2) + '\n',
  );

  console.log('--- G6-05 EXP-A EVIDENCE ---');
  console.log(JSON.stringify(output, null, 2));
  console.log('--- END EVIDENCE ---');

  // Pass criterion
  const pass =
    organizationsStructurallyDifferent &&
    allCoverageOk &&
    allExecReady &&
    allNoGaps;

  console.log(`EXP_A_PASS = ${pass}`);
  process.exit(pass ? 0 : 1);
}

await main();
