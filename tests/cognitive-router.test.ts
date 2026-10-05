import { describe, expect, it } from 'vitest';

import type {
  Decision,
  DecisionOutcome,
  DecisionProvider,
  ReasoningProvider,
  TierSelection,
} from '../src/contracts/core.js';
import { CognitiveRouter } from '../src/routing/cognitive-router.js';
import {
  LLMDecisionProvider,
  RuleDecisionProvider,
} from '../src/routing/decision-provider.js';

/**
 * TASK-009 — routing is deterministic where it must be, the fallback works,
 * and no provider name ever reaches the organization layer.
 */

function tierDecision(
  criticality: TierSelection['criticality'],
  budgetCeiling?: TierSelection['budgetCeiling'],
): Decision<'cheap' | 'default' | 'frontier'> {
  return {
    kind: 'reasoning-tier',
    question: 'probe question',
    options: ['cheap', 'default', 'frontier'],
    facts: {
      criticality,
      missionDomain: 'research',
      budgetCeiling: budgetCeiling ?? 'none',
    },
  };
}

function stubReasoning(behavior: () => Promise<{ text: string }>): ReasoningProvider {
  return { name: 'stub-reasoning', reason: behavior };
}

describe('RuleDecisionProvider (TASK-009)', () => {
  it('maps criticality deterministically to tiers', async () => {
    const provider = new RuleDecisionProvider();

    expect((await provider.decide(tierDecision('routine'))).choice).toBe('cheap');
    expect((await provider.decide(tierDecision('important'))).choice).toBe('default');
    expect((await provider.decide(tierDecision('mission-critical'))).choice).toBe(
      'frontier',
    );
  });

  it('clamps to the mission budget ceiling — intelligence is a resource, not a default', async () => {
    const provider = new RuleDecisionProvider();

    const clamped = await provider.decide(
      tierDecision('mission-critical', 'default'),
    );
    expect(clamped.choice).toBe('default');
    expect(clamped.reason).toContain('budget ceiling');

    // A ceiling never upgrades a cheaper choice.
    const notUpgraded = await provider.decide(tierDecision('routine', 'frontier'));
    expect(notUpgraded.choice).toBe('cheap');
  });

  it('fails loudly on unknown decision kinds and criticalities', async () => {
    const provider = new RuleDecisionProvider();

    await expect(
      provider.decide({
        kind: 'some-future-kind',
        question: '?',
        options: ['a', 'b'],
        facts: {},
      }),
    ).rejects.toThrow(/no rule for decision kind/);

    await expect(
      provider.decide(tierDecision('ultra' as TierSelection['criticality'])),
    ).rejects.toThrow(/unknown criticality/);
  });
});

describe('CognitiveRouter (TASK-009)', () => {
  it('routes tier selection through the decision provider with full facts', async () => {
    const seen: Decision[] = [];
    const spy: DecisionProvider = {
      name: 'spy',
      async decide<T extends string>(request: Decision<T>): Promise<DecisionOutcome<T>> {
        seen.push(request as Decision);
        return { choice: 'default' as T, reason: 'spy', provider: 'spy' };
      },
    };

    const tier = await new CognitiveRouter(spy).selectTier({
      roleId: 'web-researcher-1',
      role: 'Web Researcher',
      criticality: 'routine',
      missionDomain: 'research',
      budgetCeiling: 'default',
    });

    expect(tier).toBe('default');
    expect(seen).toHaveLength(1);
    expect(seen[0].kind).toBe('reasoning-tier');
    expect(seen[0].options).toEqual(['cheap', 'default', 'frontier']);
    expect(seen[0].facts.criticality).toBe('routine');
    expect(seen[0].facts.budgetCeiling).toBe('default');
  });

  it('returns only tiers — never provider or model names', async () => {
    const router = new CognitiveRouter(new RuleDecisionProvider());
    for (const criticality of ['routine', 'important', 'mission-critical'] as const) {
      const tier = await router.selectTier({
        roleId: 'probe',
        role: 'Probe Role',
        criticality,
        missionDomain: 'software-engineering',
      });
      expect(tier).toMatch(/^(cheap|default|frontier)$/);
    }
  });
});

describe('LLMDecisionProvider fallback (TASK-009)', () => {
  it('uses the LLM choice when the answer parses', async () => {
    const llm = new LLMDecisionProvider(
      stubReasoning(async () => ({ text: 'frontier' })),
      new RuleDecisionProvider(),
    );

    const outcome = await llm.decide(tierDecision('routine'));
    expect(outcome.choice).toBe('frontier');
    expect(outcome.provider).toBe('llm');
  });

  it('parses loosely formatted answers', async () => {
    const llm = new LLMDecisionProvider(
      stubReasoning(async () => ({ text: 'Answer: "default"' })),
      new RuleDecisionProvider(),
    );

    expect((await llm.decide(tierDecision('routine'))).choice).toBe('default');
  });

  it('falls back to the rule provider when the LLM throws', async () => {
    const llm = new LLMDecisionProvider(
      stubReasoning(async () => {
        throw new Error('model unavailable');
      }),
      new RuleDecisionProvider(),
    );

    const outcome = await llm.decide(tierDecision('mission-critical'));
    expect(outcome.choice).toBe('frontier');
    expect(outcome.provider).toBe('rule-v0.1');
  });

  it('falls back when the LLM answers outside the option set', async () => {
    const llm = new LLMDecisionProvider(
      stubReasoning(async () => ({ text: 'probably the biggest one?' })),
      new RuleDecisionProvider(),
    );

    const outcome = await llm.decide(tierDecision('important'));
    expect(outcome.choice).toBe('default');
    expect(outcome.provider).toBe('rule-v0.1');
  });
});
