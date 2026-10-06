/**
 * Learning Evaluation / Promotion (TASK-026).
 *
 * The trust boundary of organizational learning. A candidate is a hypothesis;
 * the evaluator decides whether that hypothesis deserves to influence future
 * organization design.
 *
 * Anti-bloat: this is one small rule-based evaluator, NOT a "scoring DSL" or
 * a "candidate evaluation framework". Three rules:
 *
 *   1. PROMOTE when supportCount ≥ promotionThreshold AND no contradiction
 *      AND verification quality across supporting experiences is success-or-
 *      mixed (at least one verified success).
 *
 *   2. REJECT when there is at least one contradicting experience (a real
 *      structural disconfirmation — for avoid-role, the role contributed in
 *      a same-domain experience; for prefer-role, it did not), OR when every
 *      supporting experience failed verification. Absolute hypotheses
 *      ("role X is always redundant/valuable in domain D") are disproven by
 *      a single counterexample.
 *
 *   3. Otherwise RETAIN as tentative.
 *
 * LLM confidence alone can NEVER promote organizational knowledge. The
 * evaluator reads ONLY the experience evidence. Promotion is auditable: the
 * returned Evaluation cites the counts it used and the rule that fired.
 *
 * Negative learning (TASK-019): 'avoid-role' / 'avoid-shape' candidates are
 * first-class — a candidate that says "do NOT use this pattern under these
 * conditions" is evaluated by the same rules and promoted the same way. No
 * separate failure-learning subsystem.
 */

import type { Experience } from './experience.js';
import type { LearningCandidate } from './candidate.js';

/** The decision the evaluator returns for one candidate. */
export type EvaluationStatus = 'tentative' | 'promoted' | 'rejected';

/** Verification quality across the supporting experiences. */
export type VerificationQuality =
  | 'success'
  | 'mixed'
  | 'failure'
  | 'unknown';

/** The evidence summary the evaluator computed. */
export interface EvaluationEvidence {
  readonly supportCount: number;
  readonly contradictionCount: number;
  readonly verificationQuality: VerificationQuality;
  /** Fraction of supporting experiences with a verified-success outcome. */
  readonly successRate: number;
}

/** The auditable evaluation record. */
export interface Evaluation {
  readonly candidateId: string;
  readonly status: EvaluationStatus;
  /** Why this status was chosen — cites the rule that fired. */
  readonly reason: string;
  readonly evidence: EvaluationEvidence;
  readonly evaluatedAt: string;
  readonly evaluator: string;
}

/** The port the learning loop asks for evaluations through. */
export interface CandidateEvaluator {
  readonly name: string;
  /**
   * Evaluate one candidate against the full experience set. The full set is
   * passed (not just the supporting ones) so the evaluator can find
   * contradicting evidence the generator may not have known about.
   */
  evaluate(
    candidate: LearningCandidate,
    allExperiences: readonly Experience[],
  ): Evaluation;
}

export interface RuleCandidateEvaluatorOptions {
  /** Minimum supporting experiences required for promotion (default 2). */
  readonly promotionThreshold?: number;
  /** Override the evaluated-at timestamp (tests / deterministic runs). */
  readonly now?: () => string;
}

/**
 * Deterministic rule-based evaluator. The smallest evaluation mechanism that
 * works: count support and contradiction, look at verification quality, fire
 * one of three rules. No scoring DSL, no model confidence.
 */
export class RuleCandidateEvaluator implements CandidateEvaluator {
  readonly name = 'rule-candidate-evaluator-v0.1';
  private readonly promotionThreshold: number;
  private readonly now: () => string;

  constructor(options: RuleCandidateEvaluatorOptions = {}) {
    this.promotionThreshold = options.promotionThreshold ?? 2;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  evaluate(
    candidate: LearningCandidate,
    allExperiences: readonly Experience[],
  ): Evaluation {
    // Re-derive supporting and contradicting experiences from the full set.
    // The generator's lists are authoritative for support; for contradiction
    // we scan the full set for experiences in the same context with divergent
    // outcomes.
    const support = allExperiences.filter((exp) =>
      candidate.supportingExperienceIds.includes(exp.id),
    );
    const contradictions = this.findContradictions(candidate, allExperiences);

    const verifiedSuccesses = support.filter(
      (exp) => exp.verification?.ok === true || exp.outcome.status === 'success',
    ).length;
    const verificationFailures = support.filter(
      (exp) => exp.verification?.ok === false,
    ).length;

    let verificationQuality: VerificationQuality;
    if (support.length === 0) {
      verificationQuality = 'unknown';
    } else if (verifiedSuccesses === support.length) {
      verificationQuality = 'success';
    } else if (verificationFailures === support.length) {
      verificationQuality = 'failure';
    } else {
      verificationQuality = 'mixed';
    }
    const successRate = support.length === 0 ? 0 : verifiedSuccesses / support.length;

    const evidence: EvaluationEvidence = {
      supportCount: support.length,
      contradictionCount: contradictions.length,
      verificationQuality,
      successRate,
    };

    // Rule 2: REJECT when there is at least one contradicting experience (a
    // structural disconfirmation — see findContradictions), OR when every
    // supporting experience failed verification. Absolute hypotheses are
    // disproven by a single counterexample.
    const contradictionDisconfirms = contradictions.length > 0;
    const allSupportFailed =
      support.length > 0 && verificationFailures === support.length;

    if (contradictionDisconfirms || allSupportFailed) {
      return {
        candidateId: candidate.id,
        status: 'rejected',
        reason:
          (contradictionDisconfirms
            ? `Rejected: ${contradictions.length} contradicting experience(s) structurally disconfirm the hypothesis.`
            : 'Rejected: every supporting experience failed verification.') +
          ` support=${support.length} contradiction=${contradictions.length} quality=${verificationQuality}.`,
        evidence,
        evaluatedAt: this.now(),
        evaluator: this.name,
      };
    }

    // Rule 1: PROMOTE when support ≥ threshold AND no contradiction AND
    // verification quality is success or mixed (at least one verified
    // success).
    if (
      support.length >= this.promotionThreshold &&
      contradictions.length === 0 &&
      (verificationQuality === 'success' || verificationQuality === 'mixed')
    ) {
      return {
        candidateId: candidate.id,
        status: 'promoted',
        reason:
          `Promoted: ${support.length} supporting experience(s) ` +
          `(≥ threshold ${this.promotionThreshold}), no contradictions, ` +
          `verification quality ${verificationQuality} (success rate ` +
          `${successRate.toFixed(2)}).` +
          ` support=${support.length} contradiction=${contradictions.length} quality=${verificationQuality}.`,
        evidence,
        evaluatedAt: this.now(),
        evaluator: this.name,
      };
    }

    // Rule 3: RETAIN as tentative.
    return {
      candidateId: candidate.id,
      status: 'tentative',
      reason:
        `Tentative: ${support.length} supporting experience(s) ` +
        `(threshold ${this.promotionThreshold}), ${contradictions.length} ` +
        `contradiction(s), verification quality ${verificationQuality}. ` +
        `Insufficient evidence to promote or reject.` +
        ` support=${support.length} contradiction=${contradictions.length} quality=${verificationQuality}.`,
      evidence,
      evaluatedAt: this.now(),
      evaluator: this.name,
    };
  }

  /**
   * Contradictions: experiences in the SAME applicable context (same domain)
   * where the proposed effect's target role behaved OPPOSITE to the
   * hypothesis. For 'avoid-role'/'prefer-role', a contradiction is an
   * experience in the same domain where the target role produced artifacts
   * (for avoid) or zero artifacts (for prefer).
   */
  private findContradictions(
    candidate: LearningCandidate,
    allExperiences: readonly Experience[],
  ): Experience[] {
    const domain = candidate.applicableContext.domain;
    const targetRole = candidate.proposedEffect.targetRole;
    if (domain === undefined || targetRole === undefined) return [];

    return allExperiences.filter((exp) => {
      if (exp.goal.domain !== domain) return false;
      if (candidate.supportingExperienceIds.includes(exp.id)) return false;
      const contrib = exp.contributions.find((c) => c.role === targetRole);
      if (contrib === undefined) return false;
      if (candidate.proposedEffect.kind === 'avoid-role') {
        // Contradiction: the role DID contribute in this experience.
        return contrib.artifactsCount > 0 || contrib.reasoningCalls > 0;
      }
      if (candidate.proposedEffect.kind === 'prefer-role') {
        // Contradiction: the role did NOT contribute in this experience.
        return contrib.artifactsCount === 0 && contrib.reasoningCalls === 0;
      }
      return false;
    });
  }
}
