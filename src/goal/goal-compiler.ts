import type {
  Budget,
  CapabilityNeed,
  Goal,
  GoalRequirements,
  MissionDomain,
  ReasoningTier,
  SuccessCriterion,
} from '../contracts/core.js';

/**
 * Goal Compiler v0.1 (TASK-006).
 *
 * Compiles a human Goal into structured GoalRequirements — and nothing else:
 * no worker planning, no learning, no organization decisions happen here.
 *
 * The understanding step is a provider abstraction: v0.1 ships a deterministic
 * heuristic implementation (below); an LLM-backed provider can be injected
 * later without touching the compiler or its callers.
 */

/** Thrown when a goal fails validation or a provider returns invalid requirements. */
export class GoalValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GoalValidationError';
  }
}

/**
 * Understands a raw Goal into structured requirements. Implementations may be
 * deterministic (v0.1 default) or LLM-backed (future); the compiler treats
 * them uniformly and enforces invariants on whatever comes back.
 */
export interface GoalUnderstandingProvider {
  readonly name: string;
  understand(goal: Goal): Promise<GoalRequirements>;
}

export interface GoalCompilerOptions {
  /** Custom understanding provider; defaults to the deterministic v0.1 analysis. */
  readonly understanding?: GoalUnderstandingProvider;
}

export const MAX_OUTCOME_LENGTH = 2000;

/** v0.1 default mission budget when the goal carries no hint. */
export const DEFAULT_MISSION_BUDGET_USD = 25;

/** v0.1 default cognitive tier ceiling. */
export const DEFAULT_MISSION_TIER: ReasoningTier = 'default';

const TIERS: readonly ReasoningTier[] = ['cheap', 'default', 'frontier'];

const DOMAINS: readonly MissionDomain[] = [
  'research',
  'software-engineering',
  'diagnostic',
  'general',
];

/** More specific domains win ties in classification. */
const DOMAIN_PRIORITY: readonly Exclude<MissionDomain, 'general'>[] = [
  'diagnostic',
  'software-engineering',
  'research',
];

const DOMAIN_SIGNALS: Readonly<
  Record<Exclude<MissionDomain, 'general'>, readonly string[]>
> = {
  'software-engineering': [
    'build', 'implement', 'fix', 'refactor', 'test', 'deploy', 'code', 'app',
    'application', 'service', 'repository', 'repo', 'bug', 'feature', 'api',
    'endpoint', 'library', 'package', 'compile', 'website', 'frontend',
    'backend', 'dashboard',
  ],
  research: [
    'research', 'investigate', 'study', 'survey', 'market', 'competitor',
    'landscape', 'viability', 'viable', 'commercially', 'assess', 'evaluate',
    'compare', 'explore',
  ],
  diagnostic: [
    'diagnose', 'diagnosis', 'incident', 'outage', 'failure', 'root cause',
    'malfunction', 'fault', 'symptom', 'machine', 'sensor', 'breakdown',
    'halt', 'halts', 'error',
  ],
};

interface NeedRule {
  readonly need: CapabilityNeed;
  readonly signals: readonly string[];
}

const NEED_RULES: readonly NeedRule[] = [
  {
    need: 'web-research',
    signals: [
      'research', 'investigate', 'survey', 'study', 'explore', 'market',
      'competitor', 'vendor', 'vendors', 'online', 'pricing', 'landscape',
    ],
  },
  {
    need: 'code-execution',
    signals: [
      'build', 'implement', 'fix', 'refactor', 'test', 'deploy', 'code', 'app',
      'application', 'service', 'repository', 'repo', 'compile', 'run',
      'execute', 'reproduce', 'dashboard', 'website', 'api',
      // TASK-015 integration fix: registry/package maintenance work is shell
      // work — proven by Experiment 001, where its absence made the mission
      // structurally impossible (no worker could query npm).
      'npm', 'registry', 'package', 'packages', 'dependency', 'dependencies',
    ],
  },
  {
    need: 'document-authoring',
    signals: [
      'report', 'document', 'write', 'writing', 'summary', 'summarize',
      'deliverable', 'specification', 'memo', 'recommendation', 'recommend',
      'one-page',
    ],
  },
  {
    need: 'data-analysis',
    signals: [
      'analyze', 'analysis', 'metrics', 'logs', 'log', 'data', 'statistics',
      'benchmark', 'measure', 'telemetry', 'cost', 'costs', 'pricing',
      'financial', 'viability', 'viable', 'fault', 'failure', 'symptom',
      'incident', 'sensor', 'error',
    ],
  },
  {
    need: 'browser-verification',
    // TASK-015 integration fix: 'ui' dropped — it word-boundary matches
    // scoped package names like @ag-ui/core and planned a browser worker for
    // registry queries (Experiment 001 flight record).
    signals: ['browser', 'e2e', 'end-to-end', 'preview', 'smoke', 'screenshot'],
  },
];

const DOMAIN_DEFAULT_NEEDS: Readonly<
  Record<MissionDomain, readonly CapabilityNeed[]>
> = {
  research: ['web-research', 'document-authoring'],
  'software-engineering': ['code-execution'],
  diagnostic: ['data-analysis', 'document-authoring'],
  general: ['document-authoring'],
};

/** Needs inherent to a domain's deliverable, even when no signal matched. */
const INHERENT_NEEDS: Partial<
  Readonly<Record<MissionDomain, readonly CapabilityNeed[]>>
> = {
  research: ['document-authoring'],
  diagnostic: ['document-authoring'],
};

const DOMAIN_CRITERIA: Readonly<
  Record<MissionDomain, readonly SuccessCriterion[]>
> = {
  research: [
    {
      description: 'A written report exists that answers the stated outcome.',
      kind: 'evidence',
    },
    {
      description: 'Findings are backed by sources or data.',
      kind: 'evidence',
    },
  ],
  'software-engineering': [
    {
      description: 'The code change is implemented as described.',
      kind: 'artifact',
    },
    { description: 'Relevant tests pass.', kind: 'tests-pass' },
    { description: 'The build passes.', kind: 'tests-pass' },
  ],
  diagnostic: [
    {
      description: 'A diagnosis is stated with supporting evidence.',
      kind: 'evidence',
    },
    {
      description:
        'The root cause is identified or explicitly ruled out with evidence.',
      kind: 'evidence',
    },
  ],
  general: [
    {
      description: 'A concrete artifact answering the stated outcome exists.',
      kind: 'artifact',
    },
  ],
};

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function containsSignal(haystack: string, signal: string): boolean {
  return new RegExp(`\\b${escapeRegExp(signal)}\\b`, 'i').test(haystack);
}

function classifyDomain(text: string): MissionDomain {
  let best: MissionDomain = 'general';
  let bestScore = 0;
  for (const domain of DOMAIN_PRIORITY) {
    const score = DOMAIN_SIGNALS[domain].filter((signal) =>
      containsSignal(text, signal),
    ).length;
    if (score > bestScore) {
      best = domain;
      bestScore = score;
    }
  }
  return best;
}

function extractNeeds(text: string, domain: MissionDomain): CapabilityNeed[] {
  const matched = NEED_RULES.filter((rule) =>
    rule.signals.some((signal) => containsSignal(text, signal)),
  ).map((rule) => rule.need);
  const base =
    matched.length > 0 ? matched : ([...DOMAIN_DEFAULT_NEEDS[domain]] as CapabilityNeed[]);
  const inherent = INHERENT_NEEDS[domain] ?? [];
  return [...new Set([...base, ...inherent])];
}

function resolveBudget(goal: Goal): Budget {
  return {
    maxUsd: goal.budget?.maxUsd ?? DEFAULT_MISSION_BUDGET_USD,
    tier: goal.budget?.tier ?? DEFAULT_MISSION_TIER,
  };
}

/** Goal text the heuristics read: outcome + context + constraints. */
function goalText(goal: Goal): string {
  return [goal.outcome, goal.context ?? '', ...(goal.constraints ?? [])].join(
    '\n',
  );
}

/**
 * The deterministic v0.1 understanding provider: word-signal heuristics for
 * domain classification and capability-need extraction, domain-inherent
 * success criteria, and budget defaulting. Fully replaceable.
 */
export function createDeterministicUnderstanding(): GoalUnderstandingProvider {
  return {
    name: 'deterministic-v0.1',
    async understand(goal: Goal): Promise<GoalRequirements> {
      const text = goalText(goal);
      const domain = classifyDomain(text);
      return {
        source: goal,
        domain,
        successCriteria: DOMAIN_CRITERIA[domain],
        hardConstraints: [...(goal.constraints ?? [])],
        capabilityNeeds: extractNeeds(text, domain),
        budget: resolveBudget(goal),
        approvals: [...(goal.approvals ?? [])],
      };
    },
  };
}

/**
 * Compiles Goals into GoalRequirements. Validates input, delegates to the
 * understanding provider, and enforces output invariants — the compiler
 * itself contains no domain heuristics and never mentions workers.
 */
export class GoalCompiler {
  private readonly understanding: GoalUnderstandingProvider;

  constructor(options: GoalCompilerOptions = {}) {
    this.understanding =
      options.understanding ?? createDeterministicUnderstanding();
  }

  async compile(goal: Goal): Promise<GoalRequirements> {
    validateGoal(goal);
    const requirements = await this.understanding.understand(goal);
    assertRequirementsInvariants(requirements);
    return requirements;
  }
}

function validateStringArray(
  values: readonly string[] | undefined,
  label: string,
): void {
  if (values === undefined) {
    return;
  }
  if (!Array.isArray(values)) {
    throw new GoalValidationError(`${label} must be an array of strings`);
  }
  for (const value of values) {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new GoalValidationError(
        `${label} entries must be non-empty strings`,
      );
    }
  }
}

function validateGoal(goal: Goal): void {
  if (
    goal === null ||
    typeof goal !== 'object' ||
    typeof goal.outcome !== 'string' ||
    goal.outcome.trim().length === 0
  ) {
    throw new GoalValidationError('goal.outcome must be a non-empty string');
  }
  if (goal.outcome.length > MAX_OUTCOME_LENGTH) {
    throw new GoalValidationError(
      `goal.outcome must be at most ${MAX_OUTCOME_LENGTH} characters`,
    );
  }
  if (goal.context !== undefined && typeof goal.context !== 'string') {
    throw new GoalValidationError(
      'goal.context must be a string when provided',
    );
  }
  validateStringArray(goal.constraints, 'goal.constraints');
  validateStringArray(goal.approvals, 'goal.approvals');
  if (goal.budget !== undefined) {
    const { maxUsd, tier } = goal.budget;
    if (maxUsd !== undefined) {
      if (
        typeof maxUsd !== 'number' ||
        !Number.isFinite(maxUsd) ||
        maxUsd <= 0
      ) {
        throw new GoalValidationError(
          'goal.budget.maxUsd must be a positive finite number',
        );
      }
    }
    if (tier !== undefined && !TIERS.includes(tier)) {
      throw new GoalValidationError(
        `goal.budget.tier must be one of: ${TIERS.join(', ')}`,
      );
    }
  }
}

function assertRequirementsInvariants(r: GoalRequirements): void {
  if (!DOMAINS.includes(r.domain)) {
    throw new GoalValidationError(
      `understanding provider returned an invalid domain: ${String(r.domain)}`,
    );
  }
  if (r.successCriteria.length === 0) {
    throw new GoalValidationError(
      'requirements must contain at least one success criterion',
    );
  }
  for (const criterion of r.successCriteria) {
    if (
      !criterion.description ||
      !['artifact', 'tests-pass', 'evidence'].includes(criterion.kind)
    ) {
      throw new GoalValidationError('invalid success criterion');
    }
  }
  if (r.capabilityNeeds.length === 0) {
    throw new GoalValidationError(
      'requirements must contain at least one capability need',
    );
  }
  if (
    !(typeof r.budget.maxUsd === 'number' && r.budget.maxUsd > 0) ||
    !TIERS.includes(r.budget.tier)
  ) {
    throw new GoalValidationError('invalid resolved budget');
  }
}
