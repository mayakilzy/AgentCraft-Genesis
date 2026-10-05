import type {
  CapabilityNeed,
  CollaborationEdge,
  GoalRequirements,
  MissionDomain,
  OrganizationPlan,
  PlannedWorker,
} from '../contracts/core.js';

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
 */

export interface OrganizationPlannerOptions {
  /** Hard upper bound on workers per plan (default 5). */
  readonly maxWorkers?: number;
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
 */
export class OrganizationPlanner {
  private readonly maxWorkers: number;

  constructor(options: OrganizationPlannerOptions = {}) {
    this.maxWorkers = options.maxWorkers ?? DEFAULT_MAX_WORKERS;
    if (
      !Number.isInteger(this.maxWorkers) ||
      this.maxWorkers < 1 ||
      this.maxWorkers > 12
    ) {
      throw new Error('maxWorkers must be an integer between 1 and 12');
    }
  }

  plan(requirements: GoalRequirements): OrganizationPlan {
    const needs = [...requirements.capabilityNeeds];
    const scope = assessScope(requirements);

    // Conservative shapes: an undifferentiated or minimal mission gets ONE
    // worker — spawning specialists without signal is worker explosion.
    if (requirements.domain === 'general' || scope === 'minimal') {
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
      };
    }

    let specialists = buildSpecialists(needs, requirements.domain);
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

    return {
      rationale: rationaleParts.join(' '),
      workers,
      collaboration,
      capabilityNeeds: needs,
    };
  }
}
