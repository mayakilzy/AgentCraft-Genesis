import type {
  CapabilityNeed,
  Goal,
  GoalRequirements,
  MissionDomain,
  ReasoningProvider,
  SuccessCriterion,
} from '../contracts/core.js';
import {
  createDeterministicUnderstanding,
  type GoalUnderstandingProvider,
} from './goal-compiler.js';

/**
 * LLM-backed goal understanding (TASK-015) — the designed extension point of
 * the Goal Compiler: "an LLM-backed provider can be injected later without
 * touching the compiler or its callers."
 *
 * The heuristic v0.1 understanding is word-signal based; a maintenance-audit
 * goal like Experiment 001's reads as "software-engineering + browser
 * verification" to it, which would plan a browser worker for shell work.
 * Real understanding reads it as data analysis plus report writing. Same
 * guarantee as the LLMDecisionProvider: if the LLM fails or returns invalid
 * requirements, the deterministic provider answers — the compiler's
 * invariants hold either way, and Genesis never stalls on a flaky model.
 */

const UNDERSTANDING_SYSTEM = [
  'You translate a human goal into structured mission requirements.',
  'Reply with ONE JSON object only, no prose, no code fences:',
  '{"domain":"research|software-engineering|diagnostic|general",',
  ' "capabilityNeeds":["web-research"|"code-execution"|"document-authoring"|"data-analysis"|"browser-verification", ...],',
  ' "successCriteria":[{"description":"...","kind":"artifact"|"tests-pass"|"evidence"}, ...],',
  ' "hardConstraints":["...", ...]}',
  'Rules:',
  '- capabilityNeeds must list every distinct capability the work truly',
  '  requires to produce the outcome — reading live data is data-analysis;',
  '  running code or commands is code-execution; writing a deliverable',
  '  document is document-authoring; browsing websites is web-research;',
  '  verifying in a real browser is browser-verification.',
  '- successCriteria describe how the OUTCOME is checkably achieved.',
  '- hardConstraints carry the goal constraints that limit how work may run.',
].join('\n');

const DOMAINS: readonly MissionDomain[] = [
  'research',
  'software-engineering',
  'diagnostic',
  'general',
];
const CRITERIA_KINDS: readonly SuccessCriterion['kind'][] = [
  'artifact',
  'tests-pass',
  'evidence',
];

interface ParsedUnderstanding {
  domain?: unknown;
  capabilityNeeds?: unknown;
  successCriteria?: unknown;
  hardConstraints?: unknown;
}

function parseRequirements(
  goal: Goal,
  text: string,
  budget: GoalRequirements['budget'],
): GoalRequirements {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) {
    throw new Error('no JSON object in the understanding reply');
  }
  const parsed = JSON.parse(text.slice(start, end + 1)) as ParsedUnderstanding;
  if (!DOMAINS.includes(parsed.domain as MissionDomain)) {
    throw new Error(`invalid domain: ${String(parsed.domain)}`);
  }
  if (
    !Array.isArray(parsed.capabilityNeeds) ||
    parsed.capabilityNeeds.length === 0 ||
    parsed.capabilityNeeds.some(
      (need) => typeof need !== 'string' || need.trim().length === 0,
    )
  ) {
    throw new Error('invalid capabilityNeeds');
  }
  if (
    !Array.isArray(parsed.successCriteria) ||
    parsed.successCriteria.length === 0
  ) {
    throw new Error('invalid successCriteria');
  }
  const criteria = parsed.successCriteria.map((raw) => {
    const criterion = raw as { description?: unknown; kind?: unknown };
    if (
      typeof criterion.description !== 'string' ||
      criterion.description.trim().length === 0 ||
      !CRITERIA_KINDS.includes(criterion.kind as SuccessCriterion['kind'])
    ) {
      throw new Error('invalid success criterion');
    }
    return {
      description: criterion.description,
      kind: criterion.kind as SuccessCriterion['kind'],
    };
  });
  const constraints =
    Array.isArray(parsed.hardConstraints) &&
    parsed.hardConstraints.every(
      (constraint) => typeof constraint === 'string',
    )
      ? (parsed.hardConstraints as string[])
      : [];

  return {
    source: goal,
    domain: parsed.domain as MissionDomain,
    successCriteria: criteria,
    hardConstraints: [...new Set([...(goal.constraints ?? []), ...constraints])],
    capabilityNeeds: [
      ...new Set(parsed.capabilityNeeds as CapabilityNeed[]),
    ],
    budget,
    approvals: [...(goal.approvals ?? [])],
  };
}

export class LLMGoalUnderstanding implements GoalUnderstandingProvider {
  readonly name = 'llm-understanding';

  constructor(
    private readonly reasoning: ReasoningProvider,
    private readonly fallback: GoalUnderstandingProvider = createDeterministicUnderstanding(),
  ) {}

  async understand(goal: Goal): Promise<GoalRequirements> {
    // Budget and approvals are facts of the goal, not judgements — resolved
    // deterministically and attached to whichever understanding succeeds.
    const budget = {
      maxUsd: goal.budget?.maxUsd ?? 25,
      tier: goal.budget?.tier ?? 'default',
    } satisfies GoalRequirements['budget'];

    try {
      const output = await this.reasoning.reason({
        system: UNDERSTANDING_SYSTEM,
        prompt: [
          `GOAL: ${goal.outcome}`,
          goal.context === undefined ? '' : `CONTEXT: ${goal.context}`,
          (goal.constraints ?? []).length === 0
            ? ''
            : `CONSTRAINTS: ${(goal.constraints ?? []).join('; ')}`,
          '',
          'Translate this goal into the required JSON object.',
        ]
          .filter((line) => line !== '')
          .join('\n'),
        tier: 'default',
      });
      return parseRequirements(goal, output.text, budget);
    } catch {
      const fallback = await this.fallback.understand(goal);
      // Deterministic budget resolution keeps the goal's own hint even on
      // the fallback path (the heuristic already resolves it identically).
      return fallback;
    }
  }
}
