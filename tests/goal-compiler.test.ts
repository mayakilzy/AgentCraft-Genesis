import { describe, expect, it } from 'vitest';

import type { Goal, GoalRequirements } from '../src/contracts/core.js';
import {
  DEFAULT_MISSION_BUDGET_USD,
  GoalCompiler,
  GoalValidationError,
} from '../src/goal/goal-compiler.js';
import {
  ALL_FIXTURE_GOALS,
  CONSTRAINED_GOAL,
  DIAGNOSTIC_GOAL,
  RESEARCH_GOAL,
  SIMPLE_GOAL,
  SOFTWARE_ENGINEERING_GOAL,
} from './fixtures/goals.js';

describe('GoalCompiler v0.1 (TASK-006)', () => {
  it('compiles the research goal into research requirements', async () => {
    const requirements = await new GoalCompiler().compile(RESEARCH_GOAL);

    expect(requirements.domain).toBe('research');
    expect(requirements.capabilityNeeds).toContain('web-research');
    expect(requirements.capabilityNeeds).toContain('data-analysis');
    expect(requirements.capabilityNeeds).toContain('document-authoring');
    expect(requirements.successCriteria.length).toBeGreaterThanOrEqual(2);
    expect(requirements.budget.maxUsd).toBe(DEFAULT_MISSION_BUDGET_USD);
    expect(requirements.budget.tier).toBe('default');
  });

  it('compiles the software-engineering goal', async () => {
    const requirements = await new GoalCompiler().compile(
      SOFTWARE_ENGINEERING_GOAL,
    );

    expect(requirements.domain).toBe('software-engineering');
    expect(requirements.capabilityNeeds).toContain('code-execution');
    expect(requirements.capabilityNeeds).toContain('browser-verification');
    expect(
      requirements.successCriteria.some((c) => c.kind === 'tests-pass'),
    ).toBe(true);
  });

  it('compiles the diagnostic goal', async () => {
    const requirements = await new GoalCompiler().compile(DIAGNOSTIC_GOAL);

    expect(requirements.domain).toBe('diagnostic');
    expect(requirements.capabilityNeeds).toContain('data-analysis');
    expect(requirements.capabilityNeeds).toContain('code-execution');
    expect(requirements.capabilityNeeds).toContain('document-authoring');
  });

  it('compiles a simple goal into general requirements with a single need', async () => {
    const requirements = await new GoalCompiler().compile(SIMPLE_GOAL);

    expect(requirements.domain).toBe('general');
    expect(requirements.capabilityNeeds).toEqual(['document-authoring']);
  });

  it('echoes constraints, approvals and budget hints unchanged', async () => {
    const requirements = await new GoalCompiler().compile(CONSTRAINED_GOAL);

    expect(requirements.hardConstraints).toContain(
      'The recommendation must include a pricing comparison',
    );
    expect(requirements.approvals).toEqual(['Sending emails to vendors']);
    expect(requirements.budget.maxUsd).toBe(15);
    expect(requirements.source).toBe(CONSTRAINED_GOAL);
  });

  it('rejects invalid goals with GoalValidationError', async () => {
    const compiler = new GoalCompiler();

    await expect(compiler.compile({ outcome: '' })).rejects.toThrow(
      GoalValidationError,
    );
    await expect(
      compiler.compile({ outcome: 'x'.repeat(2001) }),
    ).rejects.toThrow(GoalValidationError);
    await expect(
      compiler.compile({ outcome: 'valid', budget: { maxUsd: -5 } }),
    ).rejects.toThrow(GoalValidationError);
    await expect(
      compiler.compile({
        outcome: 'valid',
        budget: { tier: 'ultra' },
      } as unknown as Goal),
    ).rejects.toThrow(GoalValidationError);
    await expect(
      compiler.compile({ outcome: 'valid', approvals: [''] }),
    ).rejects.toThrow(GoalValidationError);
  });

  it('accepts an injected understanding provider (provider abstraction)', async () => {
    const stub = {
      name: 'stub-understanding',
      understand: async (): Promise<GoalRequirements> => ({
        source: RESEARCH_GOAL,
        domain: 'general',
        successCriteria: [
          { description: 'stub criterion', kind: 'artifact' as const },
        ],
        hardConstraints: [],
        capabilityNeeds: ['document-authoring'],
        budget: { maxUsd: 10, tier: 'cheap' as const },
        approvals: [],
      }),
    };

    const requirements = await new GoalCompiler({
      understanding: stub,
    }).compile(RESEARCH_GOAL);

    expect(requirements.domain).toBe('general');
    expect(requirements.budget.maxUsd).toBe(10);
  });

  it('enforces invariants on provider output', async () => {
    const broken = {
      name: 'broken-understanding',
      understand: async (): Promise<GoalRequirements> =>
        ({
          source: SIMPLE_GOAL,
          domain: 'general',
          successCriteria: [],
          hardConstraints: [],
          capabilityNeeds: [],
          budget: { maxUsd: 0, tier: 'default' },
          approvals: [],
        }) as unknown as GoalRequirements,
    };

    await expect(
      new GoalCompiler({ understanding: broken }).compile(SIMPLE_GOAL),
    ).rejects.toThrow(GoalValidationError);
  });

  it('never leaks worker names or team shapes into requirements', async () => {
    for (const goal of ALL_FIXTURE_GOALS) {
      const requirements = await new GoalCompiler().compile(goal);
      const serialized = JSON.stringify(requirements);
      expect(serialized).not.toMatch(
        /"worker|"team|\bresearcher\b|\bengineer\b|\bwriter\b|\banalyst\b|\bcoordinator\b|\bmanager\b/i,
      );
    }
  });
});
