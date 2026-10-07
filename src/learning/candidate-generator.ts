/**
 * Learning Candidate Generator (TASK-025).
 *
 * Derives falsifiable hypotheses from stored Experiences. Deliberately
 * deterministic: identical experiences always produce identical candidates.
 * The generator may OPTIONALLY accept a ReasoningProvider to enrich the
 * hypothesis text, but the evidence linkage and evidence-strength score are
 * ALWAYS computed from the experiences, never from a model.
 *
 * Anti-bloat: this is one small file, NOT a "candidate generation framework".
 * Two statistical signals are enough to close the learning loop:
 *
 *   1. REDUNDANT-ROLE — a role appears in every supporting experience for a
 *      domain but produced zero artifacts and zero reasoning calls in every
 *      one of them. Candidate: 'avoid-role' for that domain.
 *
 *   2. VALUABLE-ROLE — a role appears in every supporting experience for a
 *      domain, verification passed in all of them, and the role produced at
 *      least one artifact in every one. Candidate: 'prefer-role' for that
 *      domain.
 *
 * The generator never asserts knowledge a model imagined: every candidate
 * cites the experiences that produced it, and the evidence-strength score is
 * `supportCount / (supportCount + contradictionCount)`.
 */

import type { ReasoningProvider } from '../contracts/core.js';
import type { Experience } from './experience.js';
import type { CandidateEffect, LearningCandidate } from './candidate.js';

/** The port the learning loop asks for candidates through. */
export interface CandidateGenerator {
  readonly name: string;
  /**
   * Generate candidates from the given experiences. The same experiences
   * always produce the same candidates when the generator is deterministic.
   */
  generate(experiences: readonly Experience[]): readonly LearningCandidate[];
}

export interface StatisticalCandidateGeneratorOptions {
  /**
   * Optional reasoning provider to enrich hypothesis text. The provider is
   * NEVER asked to assert confidence or to invent evidence — only to phrase
   * the hypothesis. When absent, the generator writes the hypothesis itself.
   */
  readonly reasoning?: ReasoningProvider;
  /** Override the generated-at timestamp (tests / deterministic runs). */
  readonly now?: () => string;
}

/** Minimum supporting experiences required to even consider a signal. */
const MIN_SUPPORT = 1;

/**
 * G5-04A — Evidence Signature.
 *
 * Two experiences support the same context-specific organizational candidate
 * only when they share a comparable task context — not merely the same
 * coarse semantic domain. The evidence signature is (domain + sorted
 * capabilityNeeds): the smallest combination of EXISTING Experience fields
 * that captures "these missions are actually comparable."
 *
 * Why this layer (not GoalCompiler, not schema, not evaluator):
 *   - GoalCompiler.domain is intentionally coarse (4 values) — a broad
 *     semantic descriptor for planner shape selection, NOT an evidence-
 *     grouping key. C001-03 (data) being 'general' and C001-07 (document
 *     comparison) being 'research' are expected coarse-taxonomy behaviors,
 *     not defects.
 *   - The Experience schema already has goal.capabilityNeeds. Adding a new
 *     field (taskClass, academyFamily) would either couple production to
 *     Academy metadata or require a new classifier — both are bloat.
 *   - The evaluator's rules (support ≥ threshold, no contradiction,
 *     verification quality) are correct GIVEN its inputs. The problem is
 *     that the inputs (grouped experiences) were semantically invalid.
 *
 * The signature prevents accidental cross-family aggregation: C001-01
 * (capabilityNeeds: [document-authoring]) and C001-07 (capabilityNeeds:
 * [web-research, document-authoring]) now have DIFFERENT signatures and
 * cannot support the same context-specific candidate. Genuine cross-context
 * patterns remain possible when a candidate is explicitly emitted with a
 * broader applicability (future extension), but accidental aggregation is
 * structurally prevented.
 */
export interface EvidenceSignature {
  readonly domain: string;
  readonly capabilityNeeds: readonly string[];
}

/** Compute the evidence signature for an experience. */
function evidenceSignature(exp: Experience): EvidenceSignature {
  return {
    domain: exp.goal.domain,
    capabilityNeeds: [...exp.goal.capabilityNeeds].sort(),
  };
}

/** String key for Map grouping — stable across experiences with same signature. */
function signatureKey(sig: EvidenceSignature): string {
  return `${sig.domain}|${sig.capabilityNeeds.join(',')}`;
}

/** Human-readable label for the signature (used in candidate text). */
function signatureLabel(sig: EvidenceSignature): string {
  const needs = sig.capabilityNeeds.length === 0
    ? 'no specific capability needs'
    : sig.capabilityNeeds.join('+');
  return `${sig.domain} (${needs})`;
}

/**
 * Deterministic, statistical candidate generator. Reads Experience
 * contributions, detects redundant-role and valuable-role signals per domain,
 * and produces evidence-linked candidates.
 */
export class StatisticalCandidateGenerator implements CandidateGenerator {
  readonly name = 'statistical-candidate-generator-v0.1';
  private readonly now: () => string;

  constructor(options: StatisticalCandidateGeneratorOptions = {}) {
    this.now = options.now ?? (() => new Date().toISOString());
  }

  generate(experiences: readonly Experience[]): readonly LearningCandidate[] {
    if (experiences.length === 0) return [];

    // G5-04A: group by evidence SIGNATURE (domain + capabilityNeeds), not
    // domain alone. Two experiences support the same context-specific
    // candidate only when they share the same signature — preventing
    // accidental cross-family aggregation from a coarse domain label.
    const bySignature = new Map<string, { sig: EvidenceSignature; bucket: Experience[] }>();
    for (const exp of experiences) {
      const sig = evidenceSignature(exp);
      const key = signatureKey(sig);
      const entry = bySignature.get(key);
      if (entry === undefined) {
        bySignature.set(key, { sig, bucket: [exp] });
      } else {
        entry.bucket.push(exp);
      }
    }

    const candidates: LearningCandidate[] = [];
    for (const { sig, bucket } of bySignature.values()) {
      if (bucket.length < MIN_SUPPORT) continue;
      candidates.push(...this.detectRedundantRoles(sig, bucket));
      candidates.push(...this.detectValuableRoles(sig, bucket));
    }
    return candidates;
  }

  /**
   * REDUNDANT-ROLE signal: a role that appears in EVERY experience of this
   * domain but produced ZERO artifacts in EVERY one. A role that produces no
   * artifacts contributes nothing to the deliverable — a falsifiable
   * hypothesis that it can be omitted. (Reasoning calls are NOT counted
   * here: a worker that thinks and decides "nothing to do" still made 0
   * contribution to the deliverable.)
   */
  private detectRedundantRoles(
    sig: EvidenceSignature,
    bucket: readonly Experience[],
  ): LearningCandidate[] {
    // Roles present in every experience of the bucket.
    const rolesInAll = intersection(
      bucket.map((exp) => exp.contributions.map((contrib) => contrib.role)),
    );

    const candidates: LearningCandidate[] = [];
    for (const role of rolesInAll) {
      // Every contribution for this role across the bucket.
      const roleContribs = bucket.map((exp) =>
        exp.contributions.find((contrib) => contrib.role === role),
      );
      if (roleContribs.some((contrib) => contrib === undefined)) continue;

      const allZeroArtifacts = roleContribs.every(
        (contrib) => contrib!.artifactsCount === 0,
      );
      if (!allZeroArtifacts) continue;

      const supportIds = bucket.map((exp) => exp.id);
      const evidenceStrength = supportIds.length / (supportIds.length + 0);
      const label = signatureLabel(sig);
      const effect: CandidateEffect = {
        kind: 'avoid-role',
        description: `Omit the "${role}" role for ${label} missions; it produced no artifacts across ${supportIds.length} supporting experience(s).`,
        targetRole: role,
      };
      candidates.push({
        id: `cand-${sig.domain}-${sig.capabilityNeeds.join('-')}-avoid-${slugify(role)}`,
        hypothesis:
          `The "${role}" role is redundant for ${label} missions: across ` +
          `${supportIds.length} experience(s) it produced no artifacts.`,
        applicableContext: {
          domain: sig.domain as never,
          capabilityNeeds: [...sig.capabilityNeeds] as never,
        },
        proposedEffect: effect,
        supportingExperienceIds: supportIds,
        contradictingExperienceIds: [],
        evidenceStrength,
        status: 'tentative',
        generatedAt: this.now(),
        generator: this.name,
      });
    }
    return candidates;
  }

  /**
   * VALUABLE-ROLE signal: a role present in every experience of this domain,
   * verification passed in every one, and the role produced at least one
   * artifact in every one. That role consistently carried part of the
   * deliverable — a falsifiable hypothesis that it should be preferred.
   */
  private detectValuableRoles(
    sig: EvidenceSignature,
    bucket: readonly Experience[],
  ): LearningCandidate[] {
    const verifiedBucket = bucket.filter(
      (exp) => exp.verification?.ok === true || exp.outcome.status === 'success',
    );
    if (verifiedBucket.length < MIN_SUPPORT) return [];

    const rolesInAll = intersection(
      verifiedBucket.map((exp) => exp.contributions.map((contrib) => contrib.role)),
    );

    const candidates: LearningCandidate[] = [];
    for (const role of rolesInAll) {
      const roleContribs = verifiedBucket.map((exp) =>
        exp.contributions.find((contrib) => contrib.role === role),
      );
      if (roleContribs.some((contrib) => contrib === undefined)) continue;

      const allValuable = roleContribs.every((contrib) => contrib!.artifactsCount > 0);
      if (!allValuable) continue;

      const supportIds = verifiedBucket.map((exp) => exp.id);
      const evidenceStrength = supportIds.length / (supportIds.length + 0);
      const label = signatureLabel(sig);
      const effect: CandidateEffect = {
        kind: 'prefer-role',
        description: `Prefer the "${role}" role for ${label} missions; it produced artifacts across ${supportIds.length} verified experience(s).`,
        targetRole: role,
      };
      candidates.push({
        id: `cand-${sig.domain}-${sig.capabilityNeeds.join('-')}-prefer-${slugify(role)}`,
        hypothesis:
          `The "${role}" role is valuable for ${label} missions: across ` +
          `${supportIds.length} verified experience(s) it consistently produced ` +
          `artifacts.`,
        applicableContext: {
          domain: sig.domain as never,
          capabilityNeeds: [...sig.capabilityNeeds] as never,
        },
        proposedEffect: effect,
        supportingExperienceIds: supportIds,
        contradictingExperienceIds: [],
        evidenceStrength,
        status: 'tentative',
        generatedAt: this.now(),
        generator: this.name,
      });
    }
    return candidates;
  }
}

/** Roles present in every list — set intersection across lists. */
function intersection(lists: readonly (readonly string[])[]): readonly string[] {
  if (lists.length === 0) return [];
  const counts = new Map<string, number>();
  for (const list of lists) {
    for (const value of new Set(list)) {
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .filter(([, count]) => count === lists.length)
    .map(([value]) => value)
    .sort();
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
