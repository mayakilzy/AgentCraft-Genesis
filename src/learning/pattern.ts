/**
 * Organizational Pattern Retrieval (TASK-027).
 *
 * Promoted knowledge is useless unless the Organization Planner can consult
 * it at the right time. This module closes the first half of the learning
 * loop:
 *
 *   past organization → experience → validated pattern → future planning
 *
 * Anti-bloat: the retriever is one small deterministic matcher, NOT a RAG
 * platform. Vector search is NOT mandatory and is NOT used — deterministic
 * domain + capability-need matching is sufficient for the Group-4 experiment.
 *
 * Patterns are GUIDANCE, not absolute commands. The planner remains the
 * owner of organization design: a retrieved pattern can influence a plan,
 * but it must never override current requirements blindly. The planner
 * records whether each retrieved pattern actually influenced the plan
 * (TASK-027 gate).
 */

import type { CapabilityNeed, GoalRequirements, MissionDomain } from '../contracts/core.js';
import type { LearningCandidate } from './candidate.js';
import type { Evaluation } from './evaluation.js';

/**
 * A promoted LearningCandidate becomes an OrganizationalPattern. The pattern
 * carries the same applicable context and proposed effect as the candidate,
 * plus the promotion evidence (which experiences and which evaluation
 * produced it).
 */
export interface OrganizationalPattern {
  /** Same id as the promoted candidate. */
  readonly id: string;
  readonly hypothesis: string;
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
  readonly promotionEvidence: {
    readonly supportingExperienceIds: readonly string[];
    readonly evaluationId?: string;
    readonly promotedAt: string;
  };
  readonly source: 'learning-candidate';
}

/**
 * Promote a candidate into an OrganizationalPattern. The candidate MUST be in
 * 'promoted' status; promotion is the evaluator's decision, not the caller's.
 */
export function promoteCandidate(
  candidate: LearningCandidate,
  evaluation: Evaluation,
  now: () => string = () => new Date().toISOString(),
): OrganizationalPattern {
  if (evaluation.status !== 'promoted') {
    throw new Error(
      `Cannot promote candidate "${candidate.id}": evaluation status is ` +
        `"${evaluation.status}", not "promoted".`,
    );
  }
  return {
    id: candidate.id,
    hypothesis: candidate.hypothesis,
    applicableContext: {
      ...(candidate.applicableContext.domain === undefined
        ? {}
        : { domain: candidate.applicableContext.domain }),
      ...(candidate.applicableContext.capabilityNeeds === undefined
        ? {}
        : { capabilityNeeds: [...candidate.applicableContext.capabilityNeeds] }),
    },
    proposedEffect: {
      kind: candidate.proposedEffect.kind,
      description: candidate.proposedEffect.description,
      ...(candidate.proposedEffect.targetRole === undefined
        ? {}
        : { targetRole: candidate.proposedEffect.targetRole }),
      ...(candidate.proposedEffect.targetShape === undefined
        ? {}
        : { targetShape: { ...candidate.proposedEffect.targetShape } }),
    },
    promotionEvidence: {
      supportingExperienceIds: [...candidate.supportingExperienceIds],
      ...(evaluation.candidateId === candidate.id
        ? { evaluationId: `${evaluation.candidateId}@${evaluation.evaluatedAt}` }
        : {}),
      promotedAt: now(),
    },
    source: 'learning-candidate',
  };
}

/** The port the planner asks for relevant patterns through. */
export interface PatternRetriever {
  readonly name: string;
  /**
   * Retrieve patterns relevant to a new goal's requirements. The retriever
   * MUST NOT return patterns whose applicable context does not match —
   * irrelevant patterns must never be injected.
   */
  retrieve(
    requirements: GoalRequirements,
    patterns: readonly OrganizationalPattern[],
  ): readonly OrganizationalPattern[];
}

/**
 * Deterministic pattern retriever. Matches on domain (exact) and capability
 * needs (intersection). A pattern matches when its domain equals the
 * requirements' domain AND (when the pattern names capability needs) at least
 * one of those needs is in the requirements' needs.
 *
 * The smallest sufficient matcher. Vector retrieval is NOT used — it would
 * add a dependency and a non-determinism source without changing the
 * Group-4 result.
 */
export class RulePatternRetriever implements PatternRetriever {
  readonly name = 'rule-pattern-retriever-v0.1';

  retrieve(
    requirements: GoalRequirements,
    patterns: readonly OrganizationalPattern[],
  ): readonly OrganizationalPattern[] {
    return patterns.filter((pattern) => {
      // Domain must match when the pattern names one.
      if (
        pattern.applicableContext.domain !== undefined &&
        pattern.applicableContext.domain !== requirements.domain
      ) {
        return false;
      }
      // When the pattern names capability needs, at least one must be in the
      // requirements' needs.
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
