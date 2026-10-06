import { describe, expect, it } from 'vitest';

import type { Goal, GoalRequirements, OrganizationPlan } from '../src/contracts/core.js';
import { GoalCompiler } from '../src/goal/goal-compiler.js';
import {
  GenomeCompiler,
  loadOwnership,
  type GenomeCompilation,
} from '../src/genome/genome-compiler.js';
import { OrganizationPlanner } from '../src/organization/organization-planner.js';
import { CognitiveRouter } from '../src/routing/cognitive-router.js';
import { RuleDecisionProvider } from '../src/routing/decision-provider.js';
import {
  ALL_FIXTURE_GOALS,
  CONSTRAINED_GOAL,
  DIAGNOSTIC_GOAL,
  RESEARCH_GOAL,
  SIMPLE_GOAL,
  SOFTWARE_ENGINEERING_GOAL,
} from './fixtures/goals.js';

/**
 * GROUP 1 end-to-end: the Born Core pipeline.
 *
 *   Goal → GoalRequirements → OrganizationPlan → WorkerGenomes → Provider Decisions
 *
 * Everything below runs on the REAL data/ownership.yaml registry and the REAL
 * RuleDecisionProvider behind a REAL CognitiveRouter — no stubs. This is the
 * acceptance proof for the GROUP 1 objective.
 */

describe('GROUP 1 — Born Core pipeline (end-to-end)', () => {
  const compiler = new GoalCompiler();
  const planner = new OrganizationPlanner();
  const router = new CognitiveRouter(new RuleDecisionProvider());
  const genomeCompiler = new GenomeCompiler({
    registry: loadOwnership('data/ownership.yaml'),
    selectTier: (selection) => router.selectTier(selection),
  });

  async function runPipeline(goal: Goal): Promise<{
    requirements: GoalRequirements;
    plan: OrganizationPlan;
    compilation: GenomeCompilation;
  }> {
    const requirements = await compiler.compile(goal);
    const plan = planner.plan(requirements);
    const compilation = await genomeCompiler.compilePlan(plan, requirements);
    return { requirements, plan, compilation };
  }

  it('carries every fixture goal through the full chain without gaps', async () => {
    for (const goal of ALL_FIXTURE_GOALS) {
      const { requirements, plan, compilation } = await runPipeline(goal);

      expect(requirements.capabilityNeeds.length).toBeGreaterThan(0);
      expect(plan.workers.length).toBeGreaterThan(0);
      expect(compilation.ok, `all genomes valid for ${requirements.domain}`).toBe(
        true,
      );

      for (const result of compilation.results) {
        const genome = result.genome!;
        expect(Object.keys(genome).sort()).toEqual([
          'autonomy',
          'budget',
          'computer',
          'identity',
          'memory',
          'model',
          'objective',
          'operationalNeeds',
          'role',
          'skills',
          'tools',
        ]);
        expect(genome.model).toMatch(/^(cheap|default|frontier)$/);
        expect(genome.identity.id).toBe(result.worker.id);
      }
    }
  });

  it('produces genuinely different organizations for the three experiment domains', async () => {
    const research = await runPipeline(RESEARCH_GOAL);
    const engineering = await runPipeline(SOFTWARE_ENGINEERING_GOAL);
    const diagnostic = await runPipeline(DIAGNOSTIC_GOAL);

    const signature = (result: {
      plan: OrganizationPlan;
    }) => JSON.stringify(result.plan.workers.map((w) => w.role).sort());

    const signatures = [
      signature(research),
      signature(engineering),
      signature(diagnostic),
    ];
    expect(new Set(signatures).size).toBe(3);

    // Worker counts differ too: research 4, engineering 2, diagnostic 4.
    expect(research.plan.workers).toHaveLength(4);
    expect(engineering.plan.workers).toHaveLength(2);
    expect(diagnostic.plan.workers).toHaveLength(4);

    // Distinct genome tooling per domain (real differentiation, not labels).
    const toolsOf = (result: { compilation: GenomeCompilation }) =>
      new Set(result.compilation.results.flatMap((r) => r.genome?.tools ?? []));

    expect(toolsOf(research).has('openbot:browser-chromium')).toBe(true);
    expect(toolsOf(engineering).has('openbot:shell-execution')).toBe(true);
    expect(toolsOf(diagnostic).has('openbot:shell-execution')).toBe(true);
  });

  it('routes cognitive resources by need: cheap workers, default writers, ceiling-respected coordinators', async () => {
    const { compilation } = await runPipeline(RESEARCH_GOAL);

    const byRole = new Map(
      compilation.results.map((r) => [r.genome!.role, r.genome!]),
    );

    // Routine specialists are cheap; the deliverable writer is default;
    // the coordinator wants frontier but is clamped by the default budget
    // ceiling — intelligence is a resource, not a default.
    expect(byRole.get('Web Researcher')!.model).toBe('cheap');
    expect(byRole.get('Data Analyst')!.model).toBe('cheap');
    expect(byRole.get('Report Writer')!.model).toBe('default');
    expect(byRole.get('Mission Coordinator')!.model).toBe('default');
  });

  it('conserves the mission budget across the organization', async () => {
    const { requirements, compilation } = await runPipeline(CONSTRAINED_GOAL);
    const total = compilation.results.reduce(
      (sum, r) => sum + (r.genome?.budget.maxUsd ?? 0),
      0,
    );
    expect(total).toBeLessThanOrEqual(requirements.budget.maxUsd);
    expect(requirements.budget.maxUsd).toBe(15);
  });

  it('collapses a trivial goal to one autonomous worker', async () => {
    const { plan, compilation } = await runPipeline(SIMPLE_GOAL);

    expect(plan.workers).toHaveLength(1);
    const genome = compilation.results[0].genome!;
    expect(genome.role).toBe('Sole Operator');
    expect(genome.autonomy).toBe('autonomous');
    expect(genome.memory).toBe('none');
    // The sole operator is mission-critical, but the default budget ceiling
    // clamps frontier ambition down to default — by design.
    expect(genome.model).toBe('default');
  });
});
