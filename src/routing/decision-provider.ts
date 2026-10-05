import type {
  Decision,
  DecisionOutcome,
  DecisionProvider,
  ReasoningProvider,
} from '../contracts/core.js';

/**
 * Decision Providers v0.1 (TASK-009).
 *
 * Two implementations only — what GROUP 1 actually consumes:
 *   - RuleDecisionProvider: deterministic budget-aware rules;
 *   - LLMDecisionProvider: delegates a bounded decision to any
 *     ReasoningProvider and falls back to rules when the LLM fails or
 *     answers outside the option set.
 *
 * Jev deliberately has NO implementation and NO interface file: official
 * access is unverified (see data/dependency-baseline.json), and a future
 * JevProvider can simply implement DecisionProvider — the contract already
 * accommodates it. No ML scheduler, no autonomous benchmarking.
 */

const TIER_ORDER: Readonly<Record<string, number>> = {
  cheap: 0,
  default: 1,
  frontier: 2,
};

function lowerTier(a: string, b: string): string {
  return TIER_ORDER[a] <= TIER_ORDER[b] ? a : b;
}

function highestTierWithin(options: readonly string[]): string {
  let best: string | undefined;
  for (const option of options) {
    if (TIER_ORDER[option] === undefined) {
      continue;
    }
    if (best === undefined || TIER_ORDER[option] > TIER_ORDER[best]) {
      best = option;
    }
  }
  if (best === undefined) {
    throw new Error(`no known reasoning tiers among options: ${options.join(', ')}`);
  }
  return best;
}

/**
 * Deterministic, budget-aware decision provider. Currently serves the
 * 'reasoning-tier' decision kind used by the Cognitive Router:
 *
 *   routine         → cheap
 *   important       → default
 *   mission-critical→ frontier
 *
 * …always clamped by the mission budget ceiling when one is provided.
 * Unknown decision kinds fail loudly instead of guessing.
 */
export class RuleDecisionProvider implements DecisionProvider {
  readonly name = 'rule-v0.1';

  async decide<T extends string>(request: Decision<T>): Promise<DecisionOutcome<T>> {
    if (request.kind !== 'reasoning-tier') {
      throw new Error(
        `RuleDecisionProvider has no rule for decision kind "${request.kind}"`,
      );
    }
    const { criticality, budgetCeiling } = request.facts;
    if (typeof criticality !== 'string') {
      throw new Error('reasoning-tier decisions require a criticality fact');
    }

    let tier: string;
    switch (criticality) {
      case 'routine':
        tier = 'cheap';
        break;
      case 'important':
        tier = 'default';
        break;
      case 'mission-critical':
        tier = 'frontier';
        break;
      default:
        throw new Error(`unknown criticality: ${String(criticality)}`);
    }

    let reason = `criticality ${criticality} maps to ${tier}`;

    if (
      typeof budgetCeiling === 'string' &&
      budgetCeiling !== 'none' &&
      TIER_ORDER[budgetCeiling] !== undefined
    ) {
      const clamped = lowerTier(tier, budgetCeiling);
      if (clamped !== tier) {
        reason += `, clamped to ${clamped} by the mission budget ceiling`;
        tier = clamped;
      }
    }

    if (!request.options.includes(tier as T)) {
      // The caller restricted the option set: pick the highest allowed tier.
      const within = highestTierWithin(request.options);
      reason += `; ${tier} not offered, using highest available tier ${within}`;
      tier = within;
    }

    return {
      choice: tier as T,
      reason,
      provider: this.name,
    };
  }
}

const DECISION_SYSTEM_PROMPT =
  'You are a bounded decision provider. Reply with exactly one of the listed ' +
  'options and nothing else.';

function renderDecisionPrompt<T extends string>(request: Decision<T>): string {
  return [
    `Decision kind: ${request.kind}`,
    `Question: ${request.question}`,
    `Options: ${request.options.join(', ')}`,
    `Facts: ${JSON.stringify(request.facts)}`,
    '',
    'Reply with exactly one option.',
  ].join('\n');
}

function parseChoice<T extends string>(
  text: string,
  options: readonly T[],
): T | undefined {
  const cleaned = text
    .trim()
    .toLowerCase()
    .replace(/^(answer|choice|option)\s*:\s*/i, '')
    .replace(/^["'`]+|["'`]+$/g, '')
    .trim();
  const exact = options.find((option) => option.toLowerCase() === cleaned);
  if (exact !== undefined) {
    return exact;
  }
  return options.find((option) => cleaned.includes(option.toLowerCase()));
}

/**
 * LLM-backed bounded decisions with a guaranteed fallback: if the reasoning
 * provider throws, or answers outside the option set, the decision degrades
 * to the fallback provider (typically the deterministic rules) — Genesis
 * never stalls on a flaky model.
 */
export class LLMDecisionProvider implements DecisionProvider {
  readonly name = 'llm';

  constructor(
    private readonly reasoning: ReasoningProvider,
    private readonly fallback: DecisionProvider,
  ) {}

  async decide<T extends string>(request: Decision<T>): Promise<DecisionOutcome<T>> {
    try {
      const output = await this.reasoning.reason({
        system: DECISION_SYSTEM_PROMPT,
        prompt: renderDecisionPrompt(request),
        tier: 'default',
      });
      const choice = parseChoice(output.text, request.options);
      if (choice === undefined) {
        throw new Error(`unparseable decision output: ${output.text.slice(0, 80)}`);
      }
      return {
        choice,
        reason: `llm provider "${this.reasoning.name}" selected the option`,
        provider: this.name,
      };
    } catch {
      return this.fallback.decide(request);
    }
  }
}
