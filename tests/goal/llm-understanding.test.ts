import { describe, expect, it } from 'vitest';

import type {
  Goal,
  ReasoningOutput,
  ReasoningProvider,
} from '../../src/contracts/core.js';
import { GoalCompiler } from '../../src/goal/goal-compiler.js';
import { LLMGoalUnderstanding } from '../../src/goal/llm-understanding.js';
import { loadOwnership } from '../../src/genome/genome-compiler.js';
import { OrganizationPlanner } from '../../src/organization/organization-planner.js';
import { GenomeCompiler } from '../../src/genome/genome-compiler.js';
import { CognitiveRouter } from '../../src/routing/cognitive-router.js';
import { RuleDecisionProvider } from '../../src/routing/decision-provider.js';

/**
 * TASK-015 support: the LLM understanding provider produces REAL
 * requirements from a real goal text (word-signal heuristics misread it),
 * falls back to the deterministic provider when the LLM misbehaves, and the
 * compiler's invariants hold on both paths.
 */

class CannedReasoning implements ReasoningProvider {
  readonly name = 'canned';
  constructor(private readonly reply: string | Error) {}

  async reason(): Promise<ReasoningOutput> {
    if (this.reply instanceof Error) throw this.reply;
    return { text: this.reply };
  }
}

const AUDIT_GOAL: Goal = {
  outcome:
    'Audit the first-party dependencies of the AgentCraft-Genesis project ' +
    'against the live npm registry and deliver a dependency health report ' +
    'that states, for every dependency, the pinned version, the latest ' +
    'published version, whether it is current, and a recommendation for ' +
    'each outdated one.',
  constraints: [
    'Query the live npm registry from inside your workspace',
    'The report must be a single markdown file named dependency-health-report.md',
  ],
  budget: { maxUsd: 3, tier: 'default' },
};

const GOOD_REPLY = JSON.stringify({
  domain: 'software-engineering',
  capabilityNeeds: ['data-analysis', 'document-authoring'],
  successCriteria: [
    {
      description:
        'A dependency-health-report.md exists with one row per dependency showing pinned and latest versions',
      kind: 'artifact',
    },
    {
      description:
        'Latest versions in the report match the live npm registry at run time',
      kind: 'evidence',
    },
  ],
  hardConstraints: ['Do not guess versions; query the registry'],
});

describe('LLMGoalUnderstanding — real understanding with a safe fallback', () => {
  it('understands a maintenance-audit goal the heuristics misclassify', async () => {
    const understanding = new LLMGoalUnderstanding(new CannedReasoning(GOOD_REPLY));
    const requirements = await new GoalCompiler({ understanding }).compile(AUDIT_GOAL);

    expect(requirements.domain).toBe('software-engineering');
    expect(requirements.capabilityNeeds).toEqual([
      'data-analysis',
      'document-authoring',
    ]);
    expect(requirements.successCriteria).toHaveLength(2);
    // Goal constraints are preserved and merged with understood ones.
    expect(requirements.hardConstraints).toContain(
      'The report must be a single markdown file named dependency-health-report.md',
    );
    expect(requirements.hardConstraints).toContain('Do not guess versions; query the registry');
    // Budget comes from the goal, not the model.
    expect(requirements.budget).toEqual({ maxUsd: 3, tier: 'default' });

    // And the ORGANIZATION now fits the work: analysts and writers with
    // shell+file grants — no browser worker for registry queries.
    const plan = new OrganizationPlanner().plan(requirements);
    const roles = plan.workers.map((worker) => worker.role);
    expect(roles).not.toContain('Verification Engineer');
    const router = new CognitiveRouter(new RuleDecisionProvider());
    const compilation = await new GenomeCompiler({
      registry: loadOwnership('data/ownership.yaml'),
      selectTier: (selection) => router.selectTier(selection),
    }).compilePlan(plan, requirements);
    const tools = new Set(
      compilation.results.flatMap((r) => r.genome?.tools ?? []),
    );
    expect(tools.has('openbot:shell-execution')).toBe(true);
    expect(tools.has('openbot:workspace-files')).toBe(true);
    expect(tools.has('openbot:browser-chromium')).toBe(false);
  });

  it('falls back to the deterministic provider when the LLM returns garbage', async () => {
    const understanding = new LLMGoalUnderstanding(
      new CannedReasoning('Sure! This goal is about auditing things. Let me explain...'),
    );
    const requirements = await new GoalCompiler({ understanding }).compile(AUDIT_GOAL);
    // Deterministic fallback output — valid requirements either way.
    expect(requirements.capabilityNeeds.length).toBeGreaterThan(0);
    expect(requirements.successCriteria.length).toBeGreaterThan(0);
    expect(requirements.budget).toEqual({ maxUsd: 3, tier: 'default' });
  });

  it('falls back when the LLM throws', async () => {
    const understanding = new LLMGoalUnderstanding(
      new CannedReasoning(new Error('provider outage')),
    );
    const requirements = await new GoalCompiler({ understanding }).compile(AUDIT_GOAL);
    expect(requirements.domain).toMatch(
      /^(research|software-engineering|diagnostic|general)$/,
    );
  });

  it('rejects structurally invalid LLM output by falling back (invariants hold)', async () => {
    for (const bad of [
      JSON.stringify({ domain: 'nonsense-domain', capabilityNeeds: [], successCriteria: [] }),
      'no json here at all',
      JSON.stringify({ domain: 'research', capabilityNeeds: ['x'], successCriteria: [{ description: 'd', kind: 'bogus' }] }),
    ]) {
      const understanding = new LLMGoalUnderstanding(new CannedReasoning(bad));
      const requirements = await new GoalCompiler({ understanding }).compile(AUDIT_GOAL);
      expect(requirements.successCriteria.length).toBeGreaterThan(0);
    }
  });
});
