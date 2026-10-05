import { beforeAll, describe, expect, it } from 'vitest';

import type { Goal, GoalRequirements, OrganizationPlan } from '../src/contracts/core.js';
import { GoalCompiler } from '../src/goal/goal-compiler.js';
import {
  DEFAULT_MAX_WORKERS,
  OrganizationPlanner,
} from '../src/organization/organization-planner.js';
import {
  CONSTRAINED_GOAL,
  DIAGNOSTIC_GOAL,
  RESEARCH_GOAL,
  SIMPLE_GOAL,
  SOFTWARE_ENGINEERING_GOAL,
} from './fixtures/goals.js';

/**
 * TASK-007 — the anti-template test suite: three distinct experiment-shaped
 * goals must produce distinct, justified organizations, and trivial goals
 * must collapse to a single worker.
 */

let requirements: Map<Goal, GoalRequirements>;

beforeAll(async () => {
  const compiler = new GoalCompiler();
  const goals = [
    RESEARCH_GOAL,
    SOFTWARE_ENGINEERING_GOAL,
    DIAGNOSTIC_GOAL,
    SIMPLE_GOAL,
    CONSTRAINED_GOAL,
  ];
  const compiled = await Promise.all(goals.map((goal) => compiler.compile(goal)));
  requirements = new Map(goals.map((goal, i) => [goal, compiled[i]]));
});

function planFor(goal: Goal, planner = new OrganizationPlanner()): OrganizationPlan {
  return planner.plan(requirements.get(goal)!);
}

function rolesOf(plan: OrganizationPlan): string[] {
  return plan.workers.map((worker) => worker.role).sort();
}

describe('OrganizationPlanner v0.1 (TASK-007)', () => {
  it('designs a distinct, justified organization for each experiment domain', () => {
    const research = planFor(RESEARCH_GOAL);
    const engineering = planFor(SOFTWARE_ENGINEERING_GOAL);
    const diagnostic = planFor(DIAGNOSTIC_GOAL);

    // Research: 3 specialists + coordinator.
    expect(rolesOf(research)).toEqual([
      'Data Analyst',
      'Mission Coordinator',
      'Report Writer',
      'Web Researcher',
    ]);
    // Engineering: 2 specialists, no coordinator.
    expect(rolesOf(engineering)).toEqual([
      'Software Engineer',
      'Verification Engineer',
    ]);
    // Diagnostic: different analyst/engineer roles than research.
    expect(rolesOf(diagnostic)).toEqual([
      'Diagnostic Analyst',
      'Mission Coordinator',
      'Report Writer',
      'Reproduction Engineer',
    ]);

    // The three role sets are pairwise different — no fixed team template.
    const sets = [
      new Set(rolesOf(research)),
      new Set(rolesOf(engineering)),
      new Set(rolesOf(diagnostic)),
    ];
    expect(new Set(sets[0])).not.toEqual(new Set(sets[1]));
    expect(new Set(sets[0])).not.toEqual(new Set(sets[2]));
    expect(new Set(sets[1])).not.toEqual(new Set(sets[2]));

    // Every plan is justified in writing.
    for (const plan of [research, engineering, diagnostic]) {
      expect(plan.rationale).toMatch(/Scope "(minimal|standard|complex)"/);
      expect(plan.rationale.length).toBeGreaterThan(40);
    }
  });

  it('covers every requirement capability need in every plan', () => {
    for (const [goal, reqs] of requirements) {
      const plan = planFor(goal);
      const covered = new Set(
        plan.workers.flatMap((worker) => [...worker.capabilityNeeds]),
      );
      for (const need of reqs.capabilityNeeds) {
        expect(
          covered.has(need),
          `plan for "${reqs.domain}" must cover need "${need}"`,
        ).toBe(true);
      }
    }
  });

  it('allows a single-worker plan when one worker is sufficient', () => {
    const plan = planFor(SIMPLE_GOAL);
    expect(plan.workers).toHaveLength(1);
    expect(plan.workers[0].role).toBe('Sole Operator');
    expect(plan.workers[0].capabilityNeeds).toEqual(['document-authoring']);
    expect(plan.collaboration).toEqual([]);
    expect(plan.rationale).toContain('Sole Operator');
  });

  it('adds a coordinator only when 3+ specialists require integration', () => {
    const withCoordinator = planFor(RESEARCH_GOAL);
    const withoutCoordinator = planFor(SOFTWARE_ENGINEERING_GOAL);

    expect(
      withCoordinator.workers.filter((w) => w.role === 'Mission Coordinator'),
    ).toHaveLength(1);
    expect(
      withoutCoordinator.workers.filter((w) => w.role === 'Mission Coordinator'),
    ).toHaveLength(0);
  });

  it('wires collaboration edges toward the coordinator and the writer', () => {
    const research = planFor(RESEARCH_GOAL);
    // 3 specialists report to the coordinator; the coordinator hands off to the writer.
    expect(research.collaboration).toHaveLength(4);
    expect(
      research.collaboration.filter((edge) => edge.kind === 'report'),
    ).toHaveLength(3);
    expect(
      research.collaboration.filter((edge) => edge.kind === 'handoff'),
    ).toHaveLength(1);
    expect(research.collaboration).toContainEqual({
      from: 'mission-coordinator-1',
      to: 'report-writer-3',
      kind: 'handoff',
    });

    // Without a coordinator and without a writer, work flows in a chain.
    const engineering = planFor(SOFTWARE_ENGINEERING_GOAL);
    expect(engineering.collaboration).toEqual([
      { from: 'software-engineer-1', to: 'verification-engineer-2', kind: 'handoff' },
    ]);
  });

  it('enforces a small default upper bound and clamps when exceeded', () => {
    expect(DEFAULT_MAX_WORKERS).toBeLessThanOrEqual(5);

    const clampedPlanner = new OrganizationPlanner({ maxWorkers: 2 });
    const plan = clampedPlanner.plan(requirements.get(RESEARCH_GOAL)!);

    expect(plan.workers.length).toBeLessThanOrEqual(2);
    // Coverage is preserved after merging.
    const covered = new Set(
      plan.workers.flatMap((worker) => [...worker.capabilityNeeds]),
    );
    for (const need of ['web-research', 'data-analysis', 'document-authoring']) {
      expect(covered.has(need)).toBe(true);
    }
    expect(plan.rationale).toContain('merge');
  });

  it('is deterministic for identical input', () => {
    const first = planFor(CONSTRAINED_GOAL);
    const second = planFor(CONSTRAINED_GOAL);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it('never mentions providers, models or vendors in plans', () => {
    for (const goal of requirements.keys()) {
      const serialized = JSON.stringify(planFor(goal));
      expect(serialized).not.toMatch(
        /openai|anthropic|claude|gemini|gpt-|provider|"model/i,
      );
    }
  });
});
