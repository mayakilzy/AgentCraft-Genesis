/**
 * Learning Candidate (TASK-025) — a hypothesis derived from Experience.
 *
 * A candidate is NOT promoted knowledge. It is a falsifiable statement that
 * the evaluator (TASK-026) must accept, retain as tentative, or reject based
 * on the evidence — never on a model's self-asserted confidence.
 *
 * Candidate generation preserves the Jev-style separation:
 *   Reasoning proposes. Evaluation decides. Governance enforces.
 *
 * The contract is minimal: a hypothesis, an applicable context, a proposed
 * organizational effect, the experiences that support or contradict it, an
 * evidence-strength score (computed from the experiences, NOT from a model),
 * and a status that starts at 'tentative' and can only change via evaluation.
 */

import type { CapabilityNeed, MissionDomain } from '../contracts/core.js';

/** The kind of organizational effect a candidate proposes. */
export type CandidateEffectKind =
  /**
   * A specific role produced no contribution across supporting experiences
   * for this context — propose to OMIT it from future plans for this context.
   */
  | 'avoid-role'
  /**
   * A specific role repeatedly produced high contribution and verification
   * passed — propose to PREFER including it.
   */
  | 'prefer-role'
  /**
   * A specific plan shape (worker count, role combination) repeatedly led to
   * successful verified outcomes — propose to PREFER that shape.
   */
  | 'prefer-shape'
  /**
   * A specific plan shape repeatedly led to failure — propose to AVOID it.
   */
  | 'avoid-shape';

/** The context in which a candidate's hypothesis applies. */
export interface CandidateContext {
  readonly domain?: MissionDomain;
  readonly capabilityNeeds?: readonly CapabilityNeed[];
  /**
   * Free-text goal keywords the generator matched on (e.g. "diagnose",
   * "incident"). Useful for retrieval when domain alone is too coarse.
   */
  readonly goalKeywords?: readonly string[];
}

/** The proposed organizational effect. */
export interface CandidateEffect {
  readonly kind: CandidateEffectKind;
  /** Human-readable description of the proposed effect. */
  readonly description: string;
  /** Target role for 'avoid-role' / 'prefer-role' effects. */
  readonly targetRole?: string;
  /** Target shape for 'prefer-shape' / 'avoid-shape' effects. */
  readonly targetShape?: { readonly workerCount?: number };
}

/** A candidate's lifecycle status. Only evaluation may change this. */
export type CandidateStatus = 'tentative' | 'promoted' | 'rejected';

/**
 * A falsifiable hypothesis derived from one or more Experiences. Every
 * candidate MUST reference the experience ids that produced it — no model
 * assertion without evidence.
 */
export interface LearningCandidate {
  /** Stable id (generator-assigned, deterministic when the generator is). */
  readonly id: string;
  /** The hypothesis in one sentence. */
  readonly hypothesis: string;
  /** The context in which the hypothesis applies. */
  readonly applicableContext: CandidateContext;
  /** The proposed organizational effect when this candidate is promoted. */
  readonly proposedEffect: CandidateEffect;
  /** Experience ids that support the hypothesis. */
  readonly supportingExperienceIds: readonly string[];
  /** Experience ids that contradict the hypothesis, when known. */
  readonly contradictingExperienceIds: readonly string[];
  /**
   * Evidence strength in [0, 1], computed by the generator from the
   * supporting/contradicting experiences. NOT a model confidence score —
   * a deterministic function of the evidence.
   */
  readonly evidenceStrength: number;
  /** Lifecycle status. Starts at 'tentative'; only evaluation may change it. */
  readonly status: CandidateStatus;
  /** ISO timestamp the candidate was generated. */
  readonly generatedAt: string;
  /** Generator name (for telemetry, never for plan content). */
  readonly generator: string;
}
