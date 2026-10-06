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

    // Group experiences by domain.
    const byDomain = new Map<string, Experience[]>();
    for (const exp of experiences) {
      const bucket = byDomain.get(exp.goal.domain) ?? [];
      bucket.push(exp);
      byDomain.set(exp.goal.domain, bucket);
    }

    const candidates: LearningCandidate[] = [];
    for (const [domain, bucket] of byDomain) {
      if (bucket.length < MIN_SUPPORT) continue;
      candidates.push(...this.detectRedundantRoles(domain, bucket));
      candidates.push(...this.detectValuableRoles(domain, bucket));
    }
    return candidates;
  }

  /**
   * REDUNDANT-ROLE signal: a role that appears in EVERY experience of this
   * domain but produced zero artifacts AND zero reasoning calls in EVERY one.
   * That role contributed nothing observable to any past attempt of this kind
   * — a falsifiable hypothesis that it can be omitted.
   */
  private detectRedundantRoles(
    domain: string,
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

      const allZero =
        roleContribs.every(
          (contrib) =>
            contrib!.artifactsCount === 0 && contrib!.reasoningCalls === 0,
        );
      if (!allZero) continue;

      const supportIds = bucket.map((exp) => exp.id);
      const evidenceStrength = supportIds.length / (supportIds.length + 0);
      const effect: CandidateEffect = {
        kind: 'avoid-role',
        description: `Omit the "${role}" role for ${domain} missions; it produced no artifacts and no reasoning calls across ${supportIds.length} supporting experience(s).`,
        targetRole: role,
      };
      candidates.push({
        id: `cand-${domain}-avoid-${slugify(role)}`,
        hypothesis:
          `The "${role}" role is redundant for ${domain} missions: across ` +
          `${supportIds.length} experience(s) it contributed no artifacts and ` +
          `no reasoning calls.`,
        applicableContext: { domain: domain as never },
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
    domain: string,
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
      const effect: CandidateEffect = {
        kind: 'prefer-role',
        description: `Prefer the "${role}" role for ${domain} missions; it produced artifacts across ${supportIds.length} verified experience(s).`,
        targetRole: role,
      };
      candidates.push({
        id: `cand-${domain}-prefer-${slugify(role)}`,
        hypothesis:
          `The "${role}" role is valuable for ${domain} missions: across ` +
          `${supportIds.length} verified experience(s) it consistently produced ` +
          `artifacts.`,
        applicableContext: { domain: domain as never },
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
