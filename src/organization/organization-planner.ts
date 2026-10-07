import type {
  CapabilityNeed,
  CollaborationEdge,
  GoalRequirements,
  LearnedPatternInfluence,
  MissionDomain,
  OrganizationPlan,
  PlannedWorker,
} from '../contracts/core.js';

/**
 * GROUP 4 (TASK-027): an advisory organizational pattern the planner may
 * consult. Defined here (not imported from learning/) so the planner stays
 * decoupled from the learning subsystem — the planner depends only on the
 * contracts it needs. The learning module's `OrganizationalPattern` is
 * structurally compatible.
 */
export interface AdvisoryPattern {
  readonly id: string;
  readonly applicableContext: {
    readonly domain?: MissionDomain;
    readonly capabilityNeeds?: readonly CapabilityNeed[];
  };
  readonly proposedEffect: {
    readonly kind: 'avoid-role' | 'prefer-role' | 'prefer-shape' | 'avoid-shape';
    readonly description: string;
    readonly targetRole?: string;
    readonly targetShape?: { readonly workerCount?: number };
  };
}

/**
 * Organization Planner v0.1 (TASK-007).
 *
 * Turns GoalRequirements into a logical OrganizationPlan: worker roles,
 * responsibilities, collaboration edges and required capabilities — with a
 * shape that genuinely varies by mission (no fixed team template), a small
 * default upper bound to avoid worker explosion, and single-worker plans
 * when one worker is sufficient.
 *
 * The planner knows nothing about providers, models or runtimes: those are
 * Genome Compiler (TASK-008) and Cognitive Router (TASK-009) concerns.
 *
 * GROUP 4 (TASK-027): the planner now OPTIONALLY accepts promoted
 * organizational patterns via the constructor. Patterns are advisory — the
 * planner remains the owner of organization design. A retrieved pattern can
 * shape the specialist build (currently: 'avoid-role' removes a redundant
 * specialist when its capability needs are covered by another specialist),
 * but it can never override hard capability coverage. The plan records which
 * patterns were considered and which were applied (the `learned` field on
 * OrganizationPlan) so the learning loop can observe real influence.
 */

export interface OrganizationPlannerOptions {
  /** Hard upper bound on workers per plan (default 5). */
  readonly maxWorkers?: number;
  /**
   * GROUP 4: promoted organizational patterns the planner may consult.
   * Advisory — the planner remains the owner of organization design.
   */
  readonly patterns?: readonly AdvisoryPattern[];
}

/** v0.1 default upper bound — small by design. */
export const DEFAULT_MAX_WORKERS = 5;

type Scope = 'minimal' | 'standard' | 'complex';

type RoleTemplate = readonly [role: string, responsibility: string];

const COMPLEXITY_SIGNALS: readonly string[] = [
  'comprehensive',
  'end-to-end',
  'production',
  'multi-',
  'several',
  'multiple',
  'full',
];

/** Compact per-domain role templates — deliberately NOT a large catalog. */
const ROLE_TEMPLATES: Readonly<
  Record<MissionDomain, Partial<Record<string, RoleTemplate>>>
> = {
  research: {
    'web-research': [
      'Web Researcher',
      'Gathers online sources and evidence relevant to the outcome',
    ],
    'data-analysis': [
      'Data Analyst',
      'Analyzes collected data and derives quantitative insights',
    ],
    'document-authoring': [
      'Report Writer',
      'Synthesizes findings into the final written deliverable',
    ],
  },
  'software-engineering': {
    'code-execution': [
      'Software Engineer',
      'Implements, runs and fixes the code changes',
    ],
    'browser-verification': [
      'Verification Engineer',
      'Verifies behavior end-to-end in a real browser',
    ],
    'document-authoring': [
      'Documentation Writer',
      'Documents the change and its usage',
    ],
  },
  diagnostic: {
    'data-analysis': [
      'Diagnostic Analyst',
      'Analyzes telemetry and evidence to isolate the fault',
    ],
    'code-execution': [
      'Reproduction Engineer',
      'Reproduces the failure and tests hypotheses hands-on',
    ],
    'web-research': [
      'Technical Researcher',
      'Researches known issues and reference material',
    ],
    'document-authoring': [
      'Report Writer',
      'Writes the diagnosis report with evidence',
    ],
  },
  general: {},
};

/** Fallback for needs a domain has no specific template for. */
const GENERALIST_ROLE: RoleTemplate = [
  'Generalist Worker',
  'Covers a required capability directly',
];

const SOLE_OPERATOR_ROLE: RoleTemplate = [
  'Sole Operator',
  'Executes the entire mission end-to-end across all required capabilities',
];

const COORDINATOR_ROLE: RoleTemplate = [
  'Mission Coordinator',
  'Decomposes the mission, assigns work, integrates results and controls quality',
];

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function assessScope(requirements: GoalRequirements): Scope {
  let score = Math.max(0, requirements.capabilityNeeds.length - 1);
  if (requirements.successCriteria.length > 2) {
    score += 1;
  }
  const outcomeWords = requirements.source.outcome.trim().split(/\s+/).length;
  if (outcomeWords > 25) {
    score += 1;
  }
  const lower = requirements.source.outcome.toLowerCase();
  const complexityHits = COMPLEXITY_SIGNALS.filter((signal) =>
    lower.includes(signal),
  ).length;
  score += Math.min(2, complexityHits);

  if (score <= 1) {
    return 'minimal';
  }
  if (score <= 3) {
    return 'standard';
  }
  return 'complex';
}

function buildSpecialists(
  needs: readonly CapabilityNeed[],
  domain: MissionDomain,
): PlannedWorker[] {
  const specialists: PlannedWorker[] = [];
  for (const need of needs) {
    const template = ROLE_TEMPLATES[domain][need] ?? GENERALIST_ROLE;
    const existing = specialists.find((worker) => worker.role === template[0]);
    if (existing) {
      const index = specialists.indexOf(existing);
      specialists[index] = {
        ...existing,
        capabilityNeeds: [...new Set([...existing.capabilityNeeds, need])],
      };
    } else {
      specialists.push({
        id: `${slugify(template[0])}-${specialists.length + 1}`,
        role: template[0],
        responsibility: template[1],
        capabilityNeeds: [need],
      });
    }
  }
  return specialists;
}

/**
 * Merges the smallest specialists into a Generalist until the plan fits the
 * ceiling. Deterministic (ties broken by id). Returns the clamped workers and
 * how many merges happened (for the rationale).
 */
function clampToMax(
  specialists: PlannedWorker[],
  max: number,
): { workers: PlannedWorker[]; merges: number } {
  if (specialists.length <= max) {
    return { workers: specialists, merges: 0 };
  }
  const workers = [...specialists];
  let merges = 0;
  while (workers.length > max) {
    workers.sort(
      (a, b) =>
        a.capabilityNeeds.length - b.capabilityNeeds.length ||
        a.id.localeCompare(b.id),
    );
    const [first, second] = workers;
    workers.splice(0, 2);
    const mergedNeeds = [
      ...new Set([...first.capabilityNeeds, ...second.capabilityNeeds]),
    ];
    const generalist = workers.find(
      (worker) => worker.role === GENERALIST_ROLE[0],
    );
    if (generalist) {
      const index = workers.indexOf(generalist);
      workers[index] = {
        ...generalist,
        capabilityNeeds: [
          ...new Set([...generalist.capabilityNeeds, ...mergedNeeds]),
        ],
      };
    } else {
      workers.unshift({
        id: 'generalist-worker-1',
        role: GENERALIST_ROLE[0],
        responsibility:
          'Covers multiple capability needs to respect the organization size ceiling',
        capabilityNeeds: mergedNeeds,
      });
    }
    merges += 1;
  }
  return { workers, merges };
}

function buildEdges(workers: readonly PlannedWorker[]): CollaborationEdge[] {
  if (workers.length <= 1) {
    return [];
  }
  const edges: CollaborationEdge[] = [];
  const coordinator = workers.find(
    (worker) => worker.role === COORDINATOR_ROLE[0],
  );
  const writer = workers.find((worker) => worker.role.includes('Writer'));

  if (coordinator) {
    for (const worker of workers) {
      if (worker.id === coordinator.id) {
        continue;
      }
      edges.push({ from: worker.id, to: coordinator.id, kind: 'report' });
    }
    if (writer && writer.id !== coordinator.id) {
      edges.push({ from: coordinator.id, to: writer.id, kind: 'handoff' });
    }
    return edges;
  }

  if (writer) {
    for (const worker of workers) {
      if (worker.id === writer.id) {
        continue;
      }
      edges.push({ from: worker.id, to: writer.id, kind: 'handoff' });
    }
    return edges;
  }

  for (let i = 0; i + 1 < workers.length; i += 1) {
    edges.push({ from: workers[i].id, to: workers[i + 1].id, kind: 'handoff' });
  }
  return edges;
}

/**
 * Plans the logical organization for one mission. Deterministic: identical
 * requirements always produce an identical plan.
 *
 * GROUP 4: when the planner was constructed with promoted patterns, it
 * retrieves those matching the requirements' domain (and capability needs
 * when present) and applies each one as advisory guidance. The plan's
 * `learned` field records which patterns were considered and which were
 * applied — making the learning loop's influence on planning auditable.
 */
export class OrganizationPlanner {
  private readonly maxWorkers: number;
  private readonly patterns: readonly AdvisoryPattern[];

  constructor(options: OrganizationPlannerOptions = {}) {
    this.maxWorkers = options.maxWorkers ?? DEFAULT_MAX_WORKERS;
    if (
      !Number.isInteger(this.maxWorkers) ||
      this.maxWorkers < 1 ||
      this.maxWorkers > 12
    ) {
      throw new Error('maxWorkers must be an integer between 1 and 12');
    }
    this.patterns = options.patterns === undefined ? [] : [...options.patterns];
  }

  plan(requirements: GoalRequirements): OrganizationPlan {
    const needs = [...requirements.capabilityNeeds];
    const scope = assessScope(requirements);

    // GROUP 4: retrieve advisory patterns matching this goal. The retriever
    // is the planner's own deterministic matcher (domain + capability needs);
    // the learning module's RulePatternRetriever is the canonical
    // implementation, but the planner cannot depend on it without creating a
    // cycle, so the matching rule is duplicated here as the smallest seam.
    const considered = this.retrievePatterns(requirements);

    // Conservative shapes: an undifferentiated or minimal mission gets ONE
    // worker — spawning specialists without signal is worker explosion.
    if (requirements.domain === 'general' || scope === 'minimal') {
      // Even the Sole Operator plan records pattern influence: a Sole Operator
      // plan never applies avoid-role/prefer-role effects (there are no
      // specialists to filter), but the considered list is preserved so the
      // learning loop can see the planner did consult its patterns.
      return {
        rationale:
          `Scope "${scope}" in domain "${requirements.domain}" with ` +
          `${needs.length} capability need(s): a single Sole Operator is ` +
          `sufficient; no specialist split is justified.`,
        workers: [
          {
            id: 'sole-operator-1',
            role: SOLE_OPERATOR_ROLE[0],
            responsibility: SOLE_OPERATOR_ROLE[1],
            capabilityNeeds: needs,
          },
        ],
        collaboration: [],
        capabilityNeeds: needs,
        ...(considered.length === 0
          ? {}
          : {
              learned: {
                considered: considered.map((pattern) => pattern.id),
                applied: [],
              } satisfies LearnedPatternInfluence,
            }),
      };
    }

    let specialists = buildSpecialists(needs, requirements.domain);

    // GROUP 4: apply advisory patterns to the specialist build. Each applied
    // pattern is recorded with a one-line effect description. Patterns are
    // advisory: a pattern is applied ONLY when it does not break capability
    // coverage (the role's needs must be covered by another specialist).
    const applied: { patternId: string; effect: string }[] = [];
    for (const pattern of considered) {
      const result = applyAdvisoryPattern(pattern, specialists);
      if (result.applied) {
        specialists = result.specialists;
        applied.push({ patternId: pattern.id, effect: result.effect });
      }
    }

    // The coordinator decision is made AFTER patterns are applied — a pattern
    // that removes a redundant specialist may bring the count below 3, in
    // which case no coordinator is needed. This is the cascading learning
    // effect: omitting a redundant role also removes the need for a
    // coordinator that was only there to integrate it.
    const wantsCoordinator = specialists.length >= 3;
    const ceiling = wantsCoordinator ? this.maxWorkers - 1 : this.maxWorkers;

    const clamped = clampToMax(specialists, ceiling);
    specialists = clamped.workers;

    const coordinator: PlannedWorker | null = wantsCoordinator
      ? {
          id: 'mission-coordinator-1',
          role: COORDINATOR_ROLE[0],
          responsibility: COORDINATOR_ROLE[1],
          capabilityNeeds: [],
        }
      : null;
    const workers = coordinator ? [coordinator, ...specialists] : specialists;
    const collaboration = buildEdges(workers);

    const roleList = specialists
      .map(
        (worker) =>
          `${worker.role} [${worker.capabilityNeeds.join(', ')}]`,
      )
      .join(', ');
    const rationaleParts = [
      `Scope "${scope}" in domain "${requirements.domain}" with ` +
        `${needs.length} capability needs.`,
      `Planned ${specialists.length} specialist role(s): ${roleList}.`,
      wantsCoordinator
        ? 'Mission Coordinator added because 3+ specialists require integration.'
        : 'No coordinator: fewer than 3 specialists.',
    ];
    if (clamped.merges > 0) {
      rationaleParts.push(
        `${clamped.merges} merge(s) applied to respect the worker ceiling of ${this.maxWorkers}.`,
      );
    }
    if (applied.length > 0) {
      rationaleParts.push(
        `Applied ${applied.length} promoted pattern(s): ` +
          applied.map((entry) => `${entry.patternId} (${entry.effect})`).join('; ') +
          '.',
      );
    }

    return {
      rationale: rationaleParts.join(' '),
      workers,
      collaboration,
      capabilityNeeds: needs,
      ...(considered.length === 0
        ? {}
        : {
            learned: {
              considered: considered.map((pattern) => pattern.id),
              applied,
            } satisfies LearnedPatternInfluence,
          }),
    };
  }

  /**
   * Deterministic pattern retrieval: domain match (exact) AND (when the
   * pattern names capability needs) at least one need intersects the
   * requirements' needs. Mirrors RulePatternRetriever — duplicated here as
   * the smallest seam to avoid a learning→planner dependency cycle.
   */
  private retrievePatterns(
    requirements: GoalRequirements,
  ): readonly AdvisoryPattern[] {
    return this.patterns.filter((pattern) => {
      if (
        pattern.applicableContext.domain !== undefined &&
        pattern.applicableContext.domain !== requirements.domain
      ) {
        return false;
      }
      const patternNeeds = pattern.applicableContext.capabilityNeeds ?? [];
      if (patternNeeds.length > 0) {
        const reqNeeds = new Set(requirements.capabilityNeeds as readonly string[]);
        const hasIntersection = patternNeeds.some((need) => reqNeeds.has(need));
        if (!hasIntersection) return false;
      }
      return true;
    });
  }
}

/**
 * Apply one advisory pattern to the specialist build. Returns the (possibly
 * modified) specialists and whether the pattern was applied.
 *
 * Currently supported effects:
 *   - 'avoid-role': remove the target role's specialist and REDISTRIBUTE its
 *     capability needs to the remaining specialists (preserving capability
 *     coverage — the hard constraint). If no specialists remain, the needs
 *     stay with a single Generalist. The pattern is applied whenever the
 *     target role is present; it is NOT applied when the role is absent
 *     (the pattern is trivially satisfied).
 *
 *   - 'prefer-role' (G5-06): when the target role is 'Sole Operator' and the
 *     specialist build has 2+ workers, collapse to a single Sole Operator
 *     carrying all capability needs. This makes learned preference CAUSALLY
 *     visible: the pattern changes a multi-worker plan to a single-worker plan.
 *     Safety: the Sole Operator by definition carries ALL needs, so capability
 *     coverage is always preserved. The pattern does NOT apply when the
 *     specialist build already has 1 worker (trivially satisfied) or when the
 *     target role is not 'Sole Operator' (unimplemented for specialist roles).
 *     Hard mission requirements (obligations, constraints) are checked AFTER
 *     pattern application by the verification loop — learning influences
 *     ambiguity, it does not override truth.
 */
function applyAdvisoryPattern(
  pattern: AdvisoryPattern,
  specialists: PlannedWorker[],
): { applied: boolean; effect: string; specialists: PlannedWorker[] } {
  if (pattern.proposedEffect.kind === 'avoid-role') {
    const targetRole = pattern.proposedEffect.targetRole;
    if (targetRole === undefined) {
      return { applied: false, effect: 'no target role', specialists };
    }
    const target = specialists.find((worker) => worker.role === targetRole);
    if (target === undefined) {
      // The role isn't in the build — pattern is satisfied trivially.
      return { applied: false, effect: 'role not present', specialists };
    }
    // Remove the target specialist and redistribute its capability needs to
    // preserve coverage. The needs go to the first remaining specialist (a
    // deterministic choice); if no specialists remain, a Generalist carries
    // them. This is the same semantics as clampToMax's merge — the role is
    // absorbed by the rest of the organization.
    const remaining = specialists.filter((worker) => worker.id !== target.id);
    const redistributed = redistributeNeeds(remaining, target.capabilityNeeds);
    return {
      applied: true,
      effect:
        `omitted ${targetRole} role per avoid-role pattern; ` +
        `${target.capabilityNeeds.length} capability need(s) redistributed to remaining specialists`,
      specialists: redistributed,
    };
  }

  // G5-06: prefer-role for 'Sole Operator' — collapse multi-worker builds to
  // a single Sole Operator when the pattern applies. This is the minimal
  // implementation that makes learned preference causally observable without
  // overriding capability coverage or hard mission requirements.
  if (pattern.proposedEffect.kind === 'prefer-role') {
    const targetRole = pattern.proposedEffect.targetRole;
    if (targetRole === undefined) {
      return { applied: false, effect: 'no target role', specialists };
    }
    // Only 'Sole Operator' is supported in v0.1. Other prefer-role targets
    // (specialist roles) are recognized but not yet implemented — the seam
    // is open for future planners.
    if (targetRole !== SOLE_OPERATOR_ROLE[0]) {
      return {
        applied: false,
        effect: `prefer-role for "${targetRole}" not implemented in v0.1`,
        specialists,
      };
    }
    // The Sole Operator pattern is trivially satisfied when the build already
    // has exactly 1 worker — no change needed.
    if (specialists.length <= 1) {
      return { applied: false, effect: 'already a single-worker build', specialists };
    }
    // Collapse to a single Sole Operator carrying all capability needs.
    // Safety: the Sole Operator by definition covers all needs. Hard mission
    // requirements (obligations, constraints) are enforced by the verification
    // loop AFTER planning — learning influences the organization shape, it does
    // not override verification truth.
    const allNeeds = [
      ...new Set(specialists.flatMap((worker) => worker.capabilityNeeds)),
    ];
    return {
      applied: true,
      effect:
        `collapsed ${specialists.length} specialists to a single Sole Operator ` +
        `per prefer-role pattern; ${allNeeds.length} capability need(s) consolidated`,
      specialists: [
        {
          id: 'sole-operator-1',
          role: SOLE_OPERATOR_ROLE[0],
          responsibility: SOLE_OPERATOR_ROLE[1],
          capabilityNeeds: allNeeds,
        },
      ],
    };
  }

  // Other effects (prefer-shape, avoid-shape) are recognized but not yet
  // implemented in v0.1.
  return {
    applied: false,
    effect: `${pattern.proposedEffect.kind} effect not implemented in v0.1`,
    specialists,
  };
}

/**
 * Redistribute capability needs across specialists, preserving coverage. Any
 * need not already covered by a remaining specialist is added to the first
 * specialist (deterministic); when no specialists remain, a Generalist is
 * created to carry the needs. This mirrors clampToMax's merge semantics.
 */
function redistributeNeeds(
  specialists: PlannedWorker[],
  needsToAdd: readonly CapabilityNeed[],
): PlannedWorker[] {
  if (needsToAdd.length === 0) return specialists;
  if (specialists.length === 0) {
    return [
      {
        id: 'generalist-worker-1',
        role: GENERALIST_ROLE[0],
        responsibility:
          'Covers capability needs absorbed from an omitted role per a promoted pattern',
        capabilityNeeds: [...needsToAdd],
      },
    ];
  }
  const covered = new Set(
    specialists.flatMap((worker) => worker.capabilityNeeds as readonly string[]),
  );
  const uncovered = needsToAdd.filter((need) => !covered.has(need));
  if (uncovered.length === 0) {
    // All needs already covered by remaining specialists — nothing to add.
    return specialists;
  }
  const [first, ...rest] = specialists;
  return [
    {
      ...first,
      capabilityNeeds: [...new Set([...first.capabilityNeeds, ...uncovered])],
    },
    ...rest,
  ];
}
