/**
 * AgentCraft Genesis — Organizational Learning (GROUP 4, TASK-024..029).
 *
 * The smallest closed learning loop:
 *
 *   Experience → Candidate → Evaluation → Promotion → Pattern Retrieval →
 *   better Organization Planner → measured experiment → safe evolution.
 *
 * Design rules honored (founding principles + Group-4 anti-bloat rule):
 *   - no field without a current consumer;
 *   - no Learning Platform / Experience Platform / Pattern Platform;
 *   - CONFIGURE → REUSE → WRAP → ADAPT → EXTEND → BUILD (BUILD = last resort);
 *   - reuse existing contracts (Goal, GoalRequirements, OrganizationPlan,
 *     WorkerGenome, MissionResult, Evidence) wherever possible;
 *   - storage is durable, inspectable, deterministic, versionable,
 *     provenance-aware — and nothing more (no DB framework, no vector store);
 *   - telemetry is evidence about execution, NOT authoritative state
 *     (TASK-023 lesson): Experience stores REFERENCES to flight records, not
 *     copies of their payloads.
 *
 * Ownership: data/ownership.yaml declares `organizational-learning` as a
 * Genesis-owned domain (decision: DEFER → Phase 3). This module is the
 * canonical owner for that domain.
 */

import type {
  CapabilityNeed,
  Evidence,
  GoalRequirements,
  MissionDomain,
  MissionResult,
  OperationalNeedKind,
  OrganizationPlan,
  ResolvedNeed,
  WorkerGenome,
} from '../contracts/core.js';
import type { FlightEvent } from '../mission/flight-recorder.js';

// ---------------------------------------------------------------------------
// TASK-024 — Experience unit
// ---------------------------------------------------------------------------

/**
 * Compact per-worker contribution summary. Captured from the flight record so
 * learning can detect redundant or under-utilized roles WITHOUT copying the
 * record's payloads.
 *
 * PHASE 4.5: the optional `resolvedNeeds` field records which operational
 * needs were declared for this worker and which provider realized each.
 * Absent on schemaVersion 1 experiences (historical — interpreted as "not
 * explicitly recorded"; consumers may compatibly infer all-OpenBot-computer
 * from the known historical architecture, but the stored record is honest).
 */
export interface WorkerContribution {
  /** Worker id from the plan (e.g. "reproduction-engineer-1"). */
  readonly workerId: string;
  readonly role: string;
  /** The worker's own reasoning calls (from worker-finished events). */
  readonly reasoningCalls: number;
  /** Artifacts the worker declared (from worker-finished event). */
  readonly artifactsCount: number;
  /** The worker's run status (from worker-finished event). */
  readonly status: 'success' | 'failure';
  /**
   * PHASE 4.5. Resolved operational needs: which need was declared and which
   * provider realized it. Optional — absent on schemaVersion 1 experiences
   * and when genomes are not passed to deriveExperience.
   */
  readonly resolvedNeeds?: readonly ResolvedNeed[];
}

/**
 * PHASE 4.6. A record that a provider adapter was actually invoked (not just
 * resolved). This is the INVOKED + OBSERVED layer of the evidence distinction:
 * - RESOLVED: `resolvedNeeds` on WorkerContribution (a need was declared and a
 *   provider was selected).
 * - INVOKED: this `providerInvocations` array (the adapter performed an
 *   operation).
 * - OBSERVED: `observed: true` + `resultRef` on the invocation (a real result
 *   was confirmed).
 *
 * Minimal: one record per provider operation. Not a telemetry warehouse —
 * just enough for learning to distinguish "selected" from "used successfully."
 */
export interface ProviderInvocation {
  /** The provider that was invoked ('openbot', 'opendots', 'openmuse', ...). */
  readonly provider: string;
  /** The operational need kind that drove the invocation. */
  readonly need: OperationalNeedKind;
  /** The operation performed ('create-space', 'append-content', 'exec', ...). */
  readonly operation: string;
  /** The Genesis worker that triggered the invocation. */
  readonly workerId: string;
  /** Whether a real result was observed (vs. the invocation failed/unconfirmed). */
  readonly observed: boolean;
  /** Provider-specific reference to the result (e.g. OpenDots pageId, revision). */
  readonly resultRef?: string;
}

/**
 * A durable, compact representation of "what happened when this organization
 * attempted this kind of goal". Stored once per mission; retrieved many times.
 *
 * Deliberately small: it stores SUMMARIES and REFERENCES, never flight-record
 * payloads or transcript bodies. Authority for execution detail remains the
 * flight record; authority for organization outcome remains the MissionResult
 * and the verified repository/artifact state.
 */
export interface Experience {
  /** Stable id, derived from the mission id (one experience per mission). */
  readonly id: string;
  /** ISO timestamp the experience was recorded. */
  readonly recordedAt: string;
  /** Schema version — bump when the shape changes; never mutate old records. */
  readonly schemaVersion: 2;

  readonly goal: {
    readonly outcome: string;
    readonly domain: MissionDomain;
    readonly capabilityNeeds: readonly CapabilityNeed[];
  };

  readonly organization: {
    readonly workerCount: number;
    readonly roles: readonly string[];
    readonly collaborationEdges: number;
    /** The planner's own rationale for this shape (truncated). */
    readonly rationale: string;
  };

  /** Per-worker contribution summary — the statistical signal source. */
  readonly contributions: readonly WorkerContribution[];

  readonly outcome: {
    readonly status: MissionResult['status'];
    /** Mission result summary (truncated). */
    readonly summary: string;
    /** Workers' own loop reasoning calls (mission-finished event). */
    readonly reasoningCalls: number;
    readonly wallMs: number;
    /** Number of bounded retries that occurred (worker-retry events). */
    readonly retries: number;
    readonly humanInterventions: number;
  };

  /** Verification outcome when one ran; absent if no checks executed. */
  readonly verification?: {
    readonly ok: boolean;
    readonly passed: number;
    readonly failed: number;
  };

  /** Evidence references — points to where the artifacts live, not copies. */
  readonly evidence: readonly {
    readonly kind: Evidence['kind'];
    readonly description: string;
    readonly location: string;
  }[];

  /**
   * PHASE 4.6. Provider invocation evidence — distinguishes RESOLVED (a need
   * was declared and a provider was selected) from INVOKED (the adapter
   * actually performed an operation) from OBSERVED (a real result was
   * observed). Absent on schemaVersion 1 and 2 experiences that don't record
   * invocations.
   *
   * This is the Phase 4.6 honesty gate: it must be impossible for learning to
   * mistake "provider was selected" for "provider was actually used
   * successfully." Each invocation record names the provider, the operation,
   * and whether a result was observed.
   */
  readonly providerInvocations?: readonly ProviderInvocation[];

  /**
   * Provenance: enough to recover the authoritative ground truth for this
   * experience. Never copies flight-record payloads — only references.
   */
  readonly provenance: {
    readonly missionId: string;
    /** Path to the durable flight record JSONL, when persisted. */
    readonly flightRecordPath?: string;
    /** Repository HEAD when the mission ran against a repo, when known. */
    readonly repositorySha?: string;
    /** Whether the experience came from a real mission or a synthetic seed. */
    readonly source: 'real-mission' | 'synthetic';
  };
}

// ---------------------------------------------------------------------------
// Derivation
// ---------------------------------------------------------------------------

/** Maximum length of any single string field captured into an Experience. */
export const EXPERIENCE_MAX_FIELD_LENGTH = 500;

function clip(value: string, max = EXPERIENCE_MAX_FIELD_LENGTH): string {
  return value.length > max ? `${value.slice(0, max)}…[truncated]` : value;
}

/** Input to {@link deriveExperience}. */
export interface DeriveExperienceInput {
  readonly missionId: string;
  readonly requirements: GoalRequirements;
  readonly plan: OrganizationPlan;
  readonly result: MissionResult;
  /**
   * The full flight event stream for the mission. deriveExperience reads only
   * the structured events it needs (worker-finished, verification,
   * worker-retry, mission-finished); it does NOT copy event payloads into the
   * experience.
   */
  readonly events: readonly FlightEvent[];
  /** Optional durable flight-record path (provenance reference). */
  readonly flightRecordPath?: string;
  /** Optional repository HEAD (provenance reference). */
  readonly repositorySha?: string;
  /** Whether this experience came from a real mission or a synthetic seed. */
  readonly source?: 'real-mission' | 'synthetic';
  /** Override the recorded-at timestamp (tests / deterministic runs). */
  readonly recordedAt?: string;
  /**
   * PHASE 4.5. The compiled worker genomes. When provided, each contribution
   * gains `resolvedNeeds` — the provider-neutral needs declared for the
   * worker plus the provider that realized each. When absent, contributions
   * have no `resolvedNeeds` (interpreted as "not explicitly recorded").
   */
  readonly genomes?: readonly WorkerGenome[];
  /**
   * PHASE 4.6. Provider invocation records — the INVOKED + OBSERVED evidence.
   * When provided, the experience gains a `providerInvocations` array that
   * distinguishes "adapter was invoked" from "need was resolved." Absent when
   * no provider invocations were recorded (Phase 4.5 behavior).
   */
  readonly providerInvocations?: readonly ProviderInvocation[];
}

/**
 * Derives a compact Experience from a completed mission's authoritative
 * artifacts. Pure function: identical inputs produce identical experiences.
 */
export function deriveExperience(input: DeriveExperienceInput): Experience {
  const {
    missionId,
    requirements,
    plan,
    result,
    events,
    flightRecordPath,
    repositorySha,
    source = 'real-mission',
    recordedAt = new Date().toISOString(),
    genomes,
    providerInvocations,
  } = input;

  // Build a genome lookup by worker id, when genomes were provided.
  const genomeById = new Map<string, WorkerGenome>();
  if (genomes !== undefined) {
    for (const genome of genomes) {
      genomeById.set(genome.identity.id, genome);
    }
  }

  // Per-worker contributions: read worker-finished events for reasoningCalls
  // and artifacts, falling back to 0 when a worker never finished. The
  // worker-finished event carries a WorkerResult; we read its summary fields
  // without copying its evidence or summary body into the experience.
  // PHASE 4.5: when genomes are available, each contribution gains
  // `resolvedNeeds` — the provider-neutral needs + the provider that
  // realized each (derived from the genome's operationalNeeds + tools).
  const contributions: WorkerContribution[] = plan.workers.map((worker) => {
    const finished = events.find(
      (event): event is Extract<FlightEvent, { type: 'worker-finished' }> =>
        event.type === 'worker-finished' && event.workerId === worker.id,
    );
    const base = {
      workerId: worker.id,
      role: worker.role,
      reasoningCalls: finished?.result.reasoningCalls ?? 0,
      artifactsCount: finished?.result.artifacts.length ?? 0,
      status: finished?.result.status ?? 'failure' as const,
    };
    const genome = genomeById.get(worker.id);
    if (genome === undefined) return base;
    const resolvedNeeds = resolveNeeds(genome);
    if (resolvedNeeds.length === 0) return base;
    return { ...base, resolvedNeeds };
  });

  // Verification outcome: the last verification event in the stream is the
  // authoritative one (a retry replaces the prior verdict).
  const verificationEvents = events.filter(
    (event): event is Extract<FlightEvent, { type: 'verification' }> =>
      event.type === 'verification',
  );
  const lastVerification =
    verificationEvents.length > 0
      ? verificationEvents[verificationEvents.length - 1]
      : undefined;

  // Retries: count worker-retry events (one per retry round).
  const retries = events.filter((event) => event.type === 'worker-retry').length;

  // Mission-finished event carries the authoritative reasoning-call count.
  const finished = events.find(
    (event): event is Extract<FlightEvent, { type: 'mission-finished' }> =>
      event.type === 'mission-finished',
  );

  return {
    id: `exp-${missionId}`,
    recordedAt,
    schemaVersion: 2,
    goal: {
      outcome: clip(requirements.source.outcome),
      domain: requirements.domain,
      capabilityNeeds: [...requirements.capabilityNeeds],
    },
    organization: {
      workerCount: plan.workers.length,
      roles: plan.workers.map((worker) => worker.role),
      collaborationEdges: plan.collaboration.length,
      rationale: clip(plan.rationale),
    },
    contributions,
    outcome: {
      status: result.status,
      summary: clip(result.summary),
      reasoningCalls: finished?.reasoningCalls ?? 0,
      wallMs: result.cost.wallMs,
      retries,
      humanInterventions: result.cost.humanInterventions,
    },
    verification:
      lastVerification === undefined
        ? undefined
        : {
            ok: lastVerification.ok,
            passed: lastVerification.passed,
            failed: lastVerification.failed,
          },
    evidence: result.evidence.map((evidence) => ({
      kind: evidence.kind,
      description: clip(evidence.description, 200),
      location: clip(evidence.location, 200),
    })),
    provenance: {
      missionId,
      ...(flightRecordPath === undefined ? {} : { flightRecordPath }),
      ...(repositorySha === undefined ? {} : { repositorySha }),
      source,
    },
    // PHASE 4.6: include provider invocation evidence when provided. Absent
    // when no invocations were recorded (Phase 4.5 behavior).
    ...(providerInvocations === undefined || providerInvocations.length === 0
      ? {}
      : { providerInvocations }),
  };
}

/**
 * PHASE 4.5. Resolve a genome's operationalNeeds to ResolvedNeed[] by joining
 * each need kind with the provider that realized it (extracted from the
 * genome's `tools` grants, which are `<owner>:<domain>` keys).
 *
 * The join maps each OperationalNeedKind to the ownership-registry domain
 * that satisfies it:
 *   shell-execution      → shell-execution
 *   browser              → browser-chromium
 *   workspace-files      → workspace-files
 *   collaborative-workspace → (Phase 4.6 — no provider yet)
 *   durable-delegation   → (Phase 4.7 — no provider yet)
 *
 * For Phase 4.5, only the first three resolve (provider: 'openbot').
 * Unresolved needs are omitted from the result (not falsely attributed).
 */
const NEED_KIND_TO_DOMAIN: Readonly<Record<string, string>> = {
  'shell-execution': 'shell-execution',
  browser: 'browser-chromium',
  'workspace-files': 'workspace-files',
  'collaborative-workspace': 'collaborative-workspace',
  'durable-delegation': 'durable-delegation',
};

function resolveNeeds(genome: WorkerGenome): ResolvedNeed[] {
  const needs = genome.operationalNeeds;
  if (needs === undefined || needs.length === 0) return [];
  const resolved: ResolvedNeed[] = [];
  for (const need of needs) {
    const domain = NEED_KIND_TO_DOMAIN[need.kind];
    if (domain === undefined) continue; // unresolved need kind (future phase)
    // Find the tool grant matching `<owner>:<domain>`.
    const grant = genome.tools.find((tool) => tool.endsWith(`:${domain}`));
    if (grant === undefined) continue; // no provider realized this need
    const provider = grant.split(':')[0]!;
    resolved.push({ kind: need.kind, provider });
  }
  return resolved;
}
