import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

import type {
  AutonomyLevel,
  CapabilityGap,
  ComputerSpec,
  GoalRequirements,
  MemorySpec,
  OrganizationPlan,
  PlannedWorker,
  TierSelection,
  TierSelector,
  WorkerBudget,
  WorkerGenome,
} from '../contracts/core.js';

/**
 * Genome Compiler v0.1 (TASK-008).
 *
 * Compiles every planned role into a Minimal WorkerGenome by mapping mission
 * capability needs onto the canonical ownership registry (data/ownership.yaml,
 * TASK-003). Design rules honored:
 *
 *   - workers are never bound to provider names: model selection goes through
 *     the injected TierSelector port (satisfied by the Cognitive Router in
 *     TASK-009);
 *   - a need no canonical owner satisfies becomes a structured CapabilityGap,
 *     never a guess;
 *   - no MuseWorker/DotWorker/BotWorker subclasses: every worker is the same
 *     ten-field WorkerGenome — flavors would be presets, not classes.
 */

export type OwnershipDecision =
  | 'REUSE'
  | 'ADAPT'
  | 'DEFER'
  | 'DROP_DUPLICATE'
  | 'GENESIS-BUILD';

const DECISIONS: readonly OwnershipDecision[] = [
  'REUSE',
  'ADAPT',
  'DEFER',
  'DROP_DUPLICATE',
  'GENESIS-BUILD',
];

export interface OwnershipRegistryEntry {
  readonly domain: string;
  readonly description: string;
  readonly canonical_owner: string;
  readonly decision: OwnershipDecision;
  readonly satisfies: readonly string[];
  readonly notes: string;
}

export interface OwnershipRegistry {
  readonly baseline: string;
  readonly ownership: readonly OwnershipRegistryEntry[];
}

export class OwnershipRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OwnershipRegistryError';
  }
}

/** Parses and validates an ownership registry document (YAML-parsed object). */
export function parseOwnershipRegistry(doc: unknown): OwnershipRegistry {
  if (typeof doc !== 'object' || doc === null) {
    throw new OwnershipRegistryError(
      'registry document must be an object',
    );
  }
  const { baseline, ownership } = doc as {
    baseline?: unknown;
    ownership?: unknown;
  };
  if (typeof baseline !== 'string' || baseline.length === 0) {
    throw new OwnershipRegistryError('registry baseline must be a non-empty string');
  }
  if (!Array.isArray(ownership) || ownership.length === 0) {
    throw new OwnershipRegistryError('registry ownership must be a non-empty array');
  }

  const seenDomains = new Set<string>();
  const entries: OwnershipRegistryEntry[] = [];
  for (const raw of ownership) {
    if (typeof raw !== 'object' || raw === null) {
      throw new OwnershipRegistryError('ownership entries must be objects');
    }
    const entry = raw as Record<string, unknown>;
    if (typeof entry.domain !== 'string' || entry.domain.length === 0) {
      throw new OwnershipRegistryError('each entry needs a non-empty domain');
    }
    if (seenDomains.has(entry.domain)) {
      throw new OwnershipRegistryError(
        `duplicate canonical domain "${entry.domain}" — one owner per domain`,
      );
    }
    seenDomains.add(entry.domain);
    if (
      typeof entry.canonical_owner !== 'string' ||
      entry.canonical_owner.length === 0
    ) {
      throw new OwnershipRegistryError(
        `domain "${entry.domain}" needs a canonical_owner`,
      );
    }
    if (!DECISIONS.includes(entry.decision as OwnershipDecision)) {
      throw new OwnershipRegistryError(
        `domain "${entry.domain}" has an invalid decision "${String(entry.decision)}"`,
      );
    }
    if (
      !Array.isArray(entry.satisfies) ||
      entry.satisfies.some((need) => typeof need !== 'string')
    ) {
      throw new OwnershipRegistryError(
        `domain "${entry.domain}" needs a satisfies array of strings`,
      );
    }
    entries.push({
      domain: entry.domain,
      description: typeof entry.description === 'string' ? entry.description : '',
      canonical_owner: entry.canonical_owner,
      decision: entry.decision as OwnershipDecision,
      satisfies: [...(entry.satisfies as string[])],
      notes: typeof entry.notes === 'string' ? entry.notes : '',
    });
  }
  return { baseline, ownership: entries };
}

/** Loads and validates the ownership registry from a YAML file. */
export function loadOwnership(
  path = 'data/ownership.yaml',
): OwnershipRegistry {
  return parseOwnershipRegistry(parse(readFileSync(path, 'utf8')));
}

export interface GenomeCompilerOptions {
  readonly registry: OwnershipRegistry;
  /** Tier selection port — satisfied by the CognitiveRouter (TASK-009). */
  readonly selectTier: TierSelector;
}

export interface WorkerGenomeResult {
  readonly worker: PlannedWorker;
  /** Present when every need of this worker is satisfied by a canonical owner. */
  readonly genome?: WorkerGenome;
  /** Present instead of a genome when a need has no canonical owner. */
  readonly gaps?: readonly CapabilityGap[];
}

export interface GenomeCompilation {
  /** True when every planned worker received a valid genome. */
  readonly ok: boolean;
  readonly results: readonly WorkerGenomeResult[];
}

/** Computer flag → registry domain (domain keys are Genesis vocabulary, owner-agnostic). */
const COMPUTER_FLAG_DOMAINS: Readonly<Record<'browser' | 'shell' | 'workspace', string>> = {
  browser: 'browser-chromium',
  shell: 'shell-execution',
  workspace: 'workspace-files',
};

function floorToCents(value: number): number {
  return Math.floor(value * 100) / 100;
}

function criticalityOf(
  worker: PlannedWorker,
): TierSelection['criticality'] {
  if (
    worker.role === 'Mission Coordinator' ||
    worker.role === 'Sole Operator'
  ) {
    return 'mission-critical';
  }
  if (worker.capabilityNeeds.length >= 2 || worker.role.includes('Writer')) {
    return 'important';
  }
  return 'routine';
}

/** Compiles planned roles into runnable worker genomes. */
export class GenomeCompiler {
  private readonly activeDomains: readonly OwnershipRegistryEntry[];

  constructor(private readonly options: GenomeCompilerOptions) {
    this.activeDomains = options.registry.ownership.filter(
      (entry) => entry.decision === 'REUSE' || entry.decision === 'ADAPT',
    );
  }

  async compilePlan(
    plan: OrganizationPlan,
    requirements: GoalRequirements,
  ): Promise<GenomeCompilation> {
    const results: WorkerGenomeResult[] = [];
    for (const worker of plan.workers) {
      results.push(await this.compileWorker(worker, plan, requirements));
    }
    return { ok: results.every((result) => result.genome !== undefined), results };
  }

  private async compileWorker(
    worker: PlannedWorker,
    plan: OrganizationPlan,
    requirements: GoalRequirements,
  ): Promise<WorkerGenomeResult> {
    // Map needs onto canonical owners; collect structured gaps for the rest.
    const grants = new Set<string>();
    const grantedDomains = new Set<string>();
    const gaps: CapabilityGap[] = [];
    for (const need of worker.capabilityNeeds) {
      const covering = this.activeDomains.filter((entry) =>
        entry.satisfies.includes(need),
      );
      if (covering.length === 0) {
        gaps.push({
          workerId: worker.id,
          need,
          reason:
            `no canonical owner in the ownership registry satisfies ` +
            `capability need "${need}"`,
        });
        continue;
      }
      for (const entry of covering) {
        grants.add(`${entry.canonical_owner}:${entry.domain}`);
        grantedDomains.add(entry.domain);
      }
    }
    if (gaps.length > 0) {
      return { worker, gaps };
    }

    const computer: ComputerSpec = {
      required: grantedDomains.size > 0,
      browser: grantedDomains.has(COMPUTER_FLAG_DOMAINS.browser),
      shell: grantedDomains.has(COMPUTER_FLAG_DOMAINS.shell),
      workspace: grantedDomains.has(COMPUTER_FLAG_DOMAINS.workspace),
    };

    const tier = await this.options.selectTier({
      roleId: worker.id,
      role: worker.role,
      criticality: criticalityOf(worker),
      missionDomain: requirements.domain,
      budgetCeiling: requirements.budget.tier,
    });

    const memory: MemorySpec = plan.workers.length > 1 ? 'shared-thread' : 'none';
    const linked = plan.collaboration.some(
      (edge) => edge.from === worker.id || edge.to === worker.id,
    );
    const skills = [
      ...worker.capabilityNeeds,
      ...(linked ? ['collaboration'] : []),
    ];
    const budget: WorkerBudget = {
      maxUsd: floorToCents(requirements.budget.maxUsd / plan.workers.length),
      maxTier: requirements.budget.tier,
    };
    const autonomy: AutonomyLevel =
      requirements.approvals.length > 0 ? 'supervised' : 'autonomous';

    const genome: WorkerGenome = {
      identity: { id: worker.id, displayName: worker.role },
      role: worker.role,
      objective:
        `${worker.responsibility} — mission: "${requirements.source.outcome}"`,
      model: tier,
      skills,
      tools: [...grants],
      computer,
      memory,
      budget,
      autonomy,
    };
    return { worker, genome };
  }
}
