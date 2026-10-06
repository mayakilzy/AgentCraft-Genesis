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
  OrganizationPlan,
} from '../contracts/core.js';
import type { FlightEvent } from '../mission/flight-recorder.js';

// ---------------------------------------------------------------------------
// TASK-024 — Experience unit
// ---------------------------------------------------------------------------

/**
 * Compact per-worker contribution summary. Captured from the flight record so
 * learning can detect redundant or under-utilized roles WITHOUT copying the
 * record's payloads.
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
  readonly schemaVersion: 1;

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
  } = input;

  // Per-worker contributions: read worker-finished events for reasoningCalls
  // and artifacts, falling back to 0 when a worker never finished. The
  // worker-finished event carries a WorkerResult; we read its summary fields
  // without copying its evidence or summary body into the experience.
  const contributions: WorkerContribution[] = plan.workers.map((worker) => {
    const finished = events.find(
      (event): event is Extract<FlightEvent, { type: 'worker-finished' }> =>
        event.type === 'worker-finished' && event.workerId === worker.id,
    );
    return {
      workerId: worker.id,
      role: worker.role,
      reasoningCalls: finished?.result.reasoningCalls ?? 0,
      artifactsCount: finished?.result.artifacts.length ?? 0,
      status: finished?.result.status ?? 'failure',
    };
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
    schemaVersion: 1,
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
  };
}
