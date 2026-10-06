import { describe, expect, it } from 'vitest';

import { GoalCompiler } from '../../src/goal/goal-compiler.js';
import {
  OrganizationPlanner,
  type AdvisoryPattern,
} from '../../src/organization/organization-planner.js';
import { RulePatternRetriever } from '../../src/learning/pattern.js';
import type { OrganizationalPattern } from '../../src/learning/pattern.js';
import {
  DIAGNOSTIC_GOAL,
  RESEARCH_GOAL,
  SOFTWARE_ENGINEERING_GOAL,
} from '../fixtures/goals.js';

/**
 * TASK-027 — Organizational Pattern Retrieval.
 *
 * Promoted knowledge must reach the Organization Planner at the right time,
 * as advisory guidance — never as absolute commands. The planner remains the
 * owner of organization design. The plan records whether retrieved patterns
 * actually influenced it.
 */

function promotedPattern(overrides: Partial<OrganizationalPattern> = {}): OrganizationalPattern {
  return {
    id: 'pat-diagnostic-avoid-reproduction-engineer',
    hypothesis: 'The Reproduction Engineer role is redundant for diagnostic missions.',
    applicableContext: { domain: 'diagnostic' },
    proposedEffect: {
      kind: 'avoid-role',
      description: 'Omit Reproduction Engineer for diagnostic missions when its needs are otherwise covered.',
      targetRole: 'Reproduction Engineer',
    },
    promotionEvidence: {
      supportingExperienceIds: ['exp-1', 'exp-2'],
      promotedAt: '2026-10-07T00:00:00Z',
    },
    source: 'learning-candidate',
    ...overrides,
  };
}

describe('TASK-027 — Organizational Pattern Retrieval', () => {
  it('retrieves a domain-matching pattern for a diagnostic goal', async () => {
    const compiler = new GoalCompiler();
    const requirements = await compiler.compile(DIAGNOSTIC_GOAL);
    const retriever = new RulePatternRetriever();
    const patterns = [promotedPattern()];

    const retrieved = retriever.retrieve(requirements, patterns);
    expect(retrieved).toHaveLength(1);
    expect(retrieved[0].id).toBe('pat-diagnostic-avoid-reproduction-engineer');
  });

  it('does NOT retrieve an irrelevant pattern — research goal does not get the diagnostic pattern', async () => {
    const compiler = new GoalCompiler();
    const requirements = await compiler.compile(RESEARCH_GOAL);
    const retriever = new RulePatternRetriever();
    const patterns = [promotedPattern()];

    const retrieved = retriever.retrieve(requirements, patterns);
    expect(retrieved).toHaveLength(0);
  });

  it('does NOT retrieve when capability needs do not intersect', async () => {
    const compiler = new GoalCompiler();
    const requirements = await compiler.compile(DIAGNOSTIC_GOAL);
    const retriever = new RulePatternRetriever();
    const patterns = [
      promotedPattern({
        id: 'pat-research-avoid-data-analyst',
        applicableContext: { domain: 'research', capabilityNeeds: ['web-research'] },
        proposedEffect: { kind: 'avoid-role', description: 'omit', targetRole: 'Data Analyst' },
      }),
    ];

    const retrieved = retriever.retrieve(requirements, patterns);
    expect(retrieved).toHaveLength(0);
  });

  it('Organization Planner receives the pattern and records its influence on the plan', async () => {
    const compiler = new GoalCompiler();
    const requirements = await compiler.compile(DIAGNOSTIC_GOAL);

    // Baseline: without the pattern, the diagnostic plan includes a Reproduction Engineer.
    const baselinePlanner = new OrganizationPlanner();
    const baselinePlan = baselinePlanner.plan(requirements);
    expect(baselinePlan.workers.map((w) => w.role)).toContain('Reproduction Engineer');
    expect(baselinePlan.learned).toBeUndefined();

    // With the pattern: the planner consults it and the role is omitted.
    const pattern: AdvisoryPattern = promotedPattern();
    const planner = new OrganizationPlanner({ patterns: [pattern] });
    const plan = planner.plan(requirements);

    expect(plan.workers.map((w) => w.role)).not.toContain('Reproduction Engineer');
    expect(plan.learned).toBeDefined();
    expect(plan.learned!.considered).toContain('pat-diagnostic-avoid-reproduction-engineer');
    expect(plan.learned!.applied.length).toBe(1);
    expect(plan.learned!.applied[0].patternId).toBe('pat-diagnostic-avoid-reproduction-engineer');
    expect(plan.learned!.applied[0].effect).toContain('omitted');
    expect(plan.learned!.applied[0].effect).toContain('redistributed');
    expect(plan.rationale).toContain('Applied 1 promoted pattern(s)');
  });

  it('the planner applies an avoid-role pattern by redistributing needs — capability coverage is preserved', async () => {
    const compiler = new GoalCompiler();
    const requirements = await compiler.compile(SOFTWARE_ENGINEERING_GOAL);

    // A pattern that targets the Software Engineer (whose code-execution need
    // is NOT covered by the Verification Engineer). The planner MUST still
    // apply the pattern — but it redistributes code-execution to the remaining
    // specialist, preserving coverage. The result is a smaller organization
    // with no uncovered needs.
    const pattern: AdvisoryPattern = {
      id: 'pat-eng-avoid-software-engineer',
      applicableContext: { domain: 'software-engineering' },
      proposedEffect: { kind: 'avoid-role', description: 'omit', targetRole: 'Software Engineer' },
    };
    const planner = new OrganizationPlanner({ patterns: [pattern] });
    const plan = planner.plan(requirements);

    // The Software Engineer is gone; the Verification Engineer absorbed its needs.
    expect(plan.workers.map((w) => w.role)).not.toContain('Software Engineer');
    expect(plan.workers.map((w) => w.role)).toContain('Verification Engineer');
    // Capability coverage preserved: code-execution is still covered.
    const coveredNeeds = new Set(
      plan.workers.flatMap((w) => w.capabilityNeeds as readonly string[]),
    );
    expect(coveredNeeds.has('code-execution')).toBe(true);
    expect(plan.learned!.applied).toHaveLength(1);
    expect(plan.learned!.applied[0].effect).toContain('redistributed');
  });

  it('the planner does NOT blindly inject an irrelevant pattern', async () => {
    const compiler = new GoalCompiler();
    const researchRequirements = await compiler.compile(RESEARCH_GOAL);

    // A diagnostic-only pattern should not even be CONSIDERED for a research goal.
    const pattern: AdvisoryPattern = promotedPattern();
    const planner = new OrganizationPlanner({ patterns: [pattern] });
    const plan = planner.plan(researchRequirements);

    expect(plan.learned).toBeUndefined();
  });

  it('the planner still reasons from the current goal — pattern influence is recorded but the rationale stands', async () => {
    const compiler = new GoalCompiler();
    const requirements = await compiler.compile(DIAGNOSTIC_GOAL);
    const pattern: AdvisoryPattern = promotedPattern();
    const planner = new OrganizationPlanner({ patterns: [pattern] });
    const plan = planner.plan(requirements);

    // The rationale still describes the scope/domain analysis from the goal.
    expect(plan.rationale).toContain('diagnostic');
    expect(plan.rationale).toContain('Scope');
    // The pattern's effect is appended as an additional rationale part.
    expect(plan.rationale).toContain('Applied');
  });

  it('multiple matching patterns are all considered, applied or not per-pattern', async () => {
    const compiler = new GoalCompiler();
    const requirements = await compiler.compile(DIAGNOSTIC_GOAL);
    const patterns: readonly AdvisoryPattern[] = [
      promotedPattern(),
      // A second diagnostic pattern that targets a role not in the plan.
      {
        id: 'pat-diagnostic-avoid-nonexistent',
        applicableContext: { domain: 'diagnostic' },
        proposedEffect: { kind: 'avoid-role', description: 'omit', targetRole: 'Nonexistent Role' },
      },
    ];
    const planner = new OrganizationPlanner({ patterns });
    const plan = planner.plan(requirements);

    expect(plan.learned!.considered).toEqual([
      'pat-diagnostic-avoid-reproduction-engineer',
      'pat-diagnostic-avoid-nonexistent',
    ]);
    // Only the first pattern actually applied (the second targets a missing role).
    expect(plan.learned!.applied).toHaveLength(1);
    expect(plan.learned!.applied[0].patternId).toBe('pat-diagnostic-avoid-reproduction-engineer');
  });
});
