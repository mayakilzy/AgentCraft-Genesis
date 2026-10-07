import { describe, expect, it } from 'vitest';

/**
 * G5-04A — Semantic Integrity Regression Tests.
 *
 * These tests verify the fix for the Cohort 001 incident where two experiences
 * from different Academy families (research-evidence-synthesis vs document-
 * comparison) both classified as domain 'research' and accidentally aggregated
 * support=2 for a context-specific pattern.
 *
 * The fix: the StatisticalCandidateGenerator now groups by an EVIDENCE SIGNATURE
 * (domain + sorted capabilityNeeds), not domain alone. Two experiences support
 * the same candidate only when they share the same signature.
 */

import type { Experience } from '../../src/learning/experience.js';
import { StatisticalCandidateGenerator } from '../../src/learning/candidate-generator.js';
import { RuleCandidateEvaluator } from '../../src/learning/evaluation.js';
import { RulePatternRetriever } from '../../src/learning/pattern.js';
import { promoteCandidate } from '../../src/learning/pattern.js';
import type { GoalRequirements, OrganizationPlan } from '../../src/contracts/core.js';

/** Helper: build a minimal Experience with the given domain + capabilityNeeds. */
function makeExperience(
  id: string,
  domain: string,
  capabilityNeeds: readonly string[],
  role: string,
  artifactsCount: number,
  overrides: { verified?: boolean; status?: 'success' | 'failure' } = {},
): Experience {
  const requirements = {
    source: { outcome: 'test' },
    domain,
    capabilityNeeds: [...capabilityNeeds] as never,
    successCriteria: [],
    hardConstraints: [],
    budget: { maxUsd: 10, tier: 'default' as const },
    approvals: [],
  } as unknown as GoalRequirements;

  const plan = {
    rationale: 'test',
    workers: [{ id: 'w1', role, responsibility: 'x', capabilityNeeds: [...capabilityNeeds] as never }],
    collaboration: [],
    capabilityNeeds: [...capabilityNeeds] as never,
  } as unknown as OrganizationPlan;

  // Suppress unused-variable warnings (these are structurally needed for
  // deriveExperience in production, but we construct Experience directly here).
  void requirements;
  void plan;

  const exp: Experience = {
    id,
    recordedAt: '2026-10-07T00:00:00Z',
    schemaVersion: 2,
    goal: { outcome: 'test', domain: domain as never, capabilityNeeds: [...capabilityNeeds] as never },
    organization: { workerCount: 1, roles: [role], collaborationEdges: 0, rationale: 'test' },
    contributions: [
      {
        workerId: 'w1',
        role,
        reasoningCalls: 1,
        artifactsCount,
        status: 'success' as const,
      },
    ],
    outcome: { status: overrides.status ?? 'success', summary: 'test', reasoningCalls: 1, wallMs: 100, retries: 0, humanInterventions: 0 },
    verification: overrides.verified === false ? undefined : { ok: true, passed: 1, failed: 0 },
    evidence: [],
    provenance: { missionId: id, source: 'synthetic' },
  };
  return exp;
}

describe('G5-04A — Adversarial: false support aggregation is prevented', () => {
  it('two experiences with same domain but DIFFERENT capabilityNeeds do NOT aggregate support', () => {
    // C001-01 analog: research domain, document-authoring need only
    const expA = makeExperience('exp-A', 'research', ['document-authoring'], 'Sole Operator', 1);
    // C001-07 analog: research domain, web-research + document-authoring needs
    // (different task context — document comparison, not evidence synthesis)
    const expB = makeExperience('exp-B', 'research', ['web-research', 'document-authoring'], 'Sole Operator', 1);

    const generator = new StatisticalCandidateGenerator();
    const candidates = generator.generate([expA, expB]);

    // There should be NO candidate with support=2 that groups these two
    // experiences together. Each experience is in its own signature bucket.
    const soleOperatorCandidates = candidates.filter(
      (c) => c.proposedEffect.targetRole === 'Sole Operator',
    );

    // Each candidate should have support=1, NOT support=2.
    for (const c of soleOperatorCandidates) {
      expect(c.supportingExperienceIds.length).toBe(1);
    }

    // There should be NO candidate that lists BOTH exp-A and exp-B as support.
    const crossContextCandidate = candidates.find(
      (c) => c.supportingExperienceIds.includes('exp-A') && c.supportingExperienceIds.includes('exp-B'),
    );
    expect(crossContextCandidate).toBeUndefined();
  });

  it('the old contaminated candidate ID is NOT produced under the new semantics', () => {
    // Simulate the exact Cohort 001 experiences.
    const expC00101 = makeExperience('exp-cohort-001-C001-01', 'research', ['document-authoring'], 'Sole Operator', 1);
    const expC00107 = makeExperience('exp-cohort-001-C001-07', 'research', ['web-research', 'document-authoring'], 'Sole Operator', 1);

    const generator = new StatisticalCandidateGenerator();
    const candidates = generator.generate([expC00101, expC00107]);

    // The old candidate ID was 'cand-research-prefer-sole-operator'.
    // Under the new signature-aware semantics, this ID is NOT produced.
    const oldCandidate = candidates.find((c) => c.id === 'cand-research-prefer-sole-operator');
    expect(oldCandidate).toBeUndefined();
  });
});

describe('G5-04A — Positive: valid support aggregation still works', () => {
  it('two experiences with the SAME evidence signature DO aggregate support=2', () => {
    // Two genuinely comparable research-evidence-synthesis missions.
    const expA = makeExperience('exp-syn-1', 'research', ['document-authoring'], 'Sole Operator', 1);
    const expB = makeExperience('exp-syn-2', 'research', ['document-authoring'], 'Sole Operator', 1);

    const generator = new StatisticalCandidateGenerator();
    const candidates = generator.generate([expA, expB]);

    // There should be a prefer-role candidate for Sole Operator with support=2.
    const preferCandidate = candidates.find(
      (c) => c.proposedEffect.kind === 'prefer-role' &&
        c.proposedEffect.targetRole === 'Sole Operator',
    );
    expect(preferCandidate).toBeDefined();
    expect(preferCandidate!.supportingExperienceIds.length).toBe(2);
    expect(preferCandidate!.supportingExperienceIds).toContain('exp-syn-1');
    expect(preferCandidate!.supportingExperienceIds).toContain('exp-syn-2');
  });

  it('a validly supported candidate CAN still be promoted by the evaluator', () => {
    const expA = makeExperience('exp-syn-1', 'research', ['document-authoring'], 'Sole Operator', 1);
    const expB = makeExperience('exp-syn-2', 'research', ['document-authoring'], 'Sole Operator', 1);

    const generator = new StatisticalCandidateGenerator();
    const candidates = generator.generate([expA, expB]);
    const evaluator = new RuleCandidateEvaluator();

    const preferCandidate = candidates.find((c) => c.proposedEffect.kind === 'prefer-role')!;
    const evaluation = evaluator.evaluate(preferCandidate, [expA, expB]);

    expect(evaluation.status).toBe('promoted');
    expect(evaluation.evidence.supportCount).toBe(2);
    expect(evaluation.evidence.contradictionCount).toBe(0);
  });
});

describe('G5-04A — Evaluator signature-aware contradictions', () => {
  it('a contradiction from a DIFFERENT signature does NOT count (not a true contradiction)', () => {
    // Two supporting experiences with signature: research + [document-authoring]
    const expA = makeExperience('exp-syn-1', 'research', ['document-authoring'], 'Sole Operator', 0);
    const expB = makeExperience('exp-syn-2', 'research', ['document-authoring'], 'Sole Operator', 0);

    // A "contradiction" from a DIFFERENT signature: research + [web-research, document-authoring]
    // where the role DID produce artifacts. Under old semantics this would be a
    // contradiction (same domain, opposite behavior). Under new semantics it is NOT
    // a contradiction — it's a different task context.
    const differentContext = makeExperience(
      'exp-doc-compare', 'research', ['web-research', 'document-authoring'],
      'Sole Operator', 2, // produced artifacts — would be contradiction under old semantics
    );

    const generator = new StatisticalCandidateGenerator();
    const candidates = generator.generate([expA, expB, differentContext]);

    // The avoid-role candidate for the [document-authoring] signature should exist.
    const avoidCandidate = candidates.find(
      (c) => c.proposedEffect.kind === 'avoid-role' &&
        c.proposedEffect.targetRole === 'Sole Operator',
    );
    expect(avoidCandidate).toBeDefined();

    const evaluator = new RuleCandidateEvaluator();
    const evaluation = evaluator.evaluate(avoidCandidate!, [expA, expB, differentContext]);

    // The different-context experience should NOT count as a contradiction.
    expect(evaluation.evidence.contradictionCount).toBe(0);
  });
});

describe('G5-04A — Quarantined pattern is not retrievable for G5-05', () => {
  it('the quarantined pattern ID does not match any candidate produced under new semantics', () => {
    // Simulate Cohort 001 experiences.
    const expC00101 = makeExperience('exp-cohort-001-C001-01', 'research', ['document-authoring'], 'Sole Operator', 1);
    const expC00107 = makeExperience('exp-cohort-001-C001-07', 'research', ['web-research', 'document-authoring'], 'Sole Operator', 1);
    const expC00103 = makeExperience('exp-cohort-001-C001-03', 'general', ['document-authoring', 'data-analysis'], 'Sole Operator', 1);
    const expC00105 = makeExperience('exp-cohort-001-C001-05', 'software-engineering', ['code-execution'], 'Software Engineer', 1);

    const generator = new StatisticalCandidateGenerator();
    const candidates = generator.generate([expC00101, expC00103, expC00105, expC00107]);

    // None of the candidates should have the quarantined ID.
    const quarantinedId = 'cand-research-prefer-sole-operator';
    const quarantined = candidates.find((c) => c.id === quarantinedId);
    expect(quarantined).toBeUndefined();

    // None of the candidates should aggregate support from both C001-01 and C001-07.
    const crossContamination = candidates.find(
      (c) => c.supportingExperienceIds.includes('exp-cohort-001-C001-01') &&
        c.supportingExperienceIds.includes('exp-cohort-001-C001-07'),
    );
    expect(crossContamination).toBeUndefined();
  });
});

describe('G5-04A — C001-03 context preserved (general domain, data needs)', () => {
  it('a data mission classified as general still has its capabilityNeeds signature', () => {
    // C001-03 was classified as domain 'general' but has capabilityNeeds
    // [document-authoring, data-analysis]. The signature preserves the task
    // context despite the coarse domain.
    const expC00103 = makeExperience(
      'exp-cohort-001-C001-03', 'general', ['document-authoring', 'data-analysis'],
      'Sole Operator', 1,
    );
    // Another data mission (different dataset, same family) also classified general.
    const expC00103b = makeExperience(
      'exp-data-2', 'general', ['document-authoring', 'data-analysis'],
      'Sole Operator', 1,
    );

    const generator = new StatisticalCandidateGenerator();
    const candidates = generator.generate([expC00103, expC00103b]);

    // These two should aggregate — same signature (general + [data-analysis, document-authoring]).
    const candidate = candidates.find(
      (c) => c.proposedEffect.kind === 'prefer-role' &&
        c.supportingExperienceIds.length === 2,
    );
    expect(candidate).toBeDefined();
    expect(candidate!.supportingExperienceIds).toContain('exp-cohort-001-C001-03');
    expect(candidate!.supportingExperienceIds).toContain('exp-data-2');
  });
});

describe('G5-04A — Cross-context generalization is not architecturally prohibited', () => {
  it('the retriever still matches patterns by domain + capabilityNeeds intersection', () => {
    // A pattern promoted with a specific signature can still be retrieved for
    // a mission that shares the same domain AND has overlapping capabilityNeeds.
    // Cross-family generalization requires the retriever to match — which it does
    // when there is genuine overlap.
    const expA = makeExperience('exp-research-1', 'research', ['document-authoring'], 'Sole Operator', 1);
    const expB = makeExperience('exp-research-2', 'research', ['document-authoring'], 'Sole Operator', 1);

    const generator = new StatisticalCandidateGenerator();
    const candidates = generator.generate([expA, expB]);
    const evaluator = new RuleCandidateEvaluator();
    const preferCandidate = candidates.find((c) => c.proposedEffect.kind === 'prefer-role')!;
    const evaluation = evaluator.evaluate(preferCandidate, [expA, expB]);
    const pattern = promoteCandidate(preferCandidate, evaluation);

    // Retriever should match a future research mission with document-authoring.
    const retriever = new RulePatternRetriever();
    const futureRequirements = {
      domain: 'research',
      capabilityNeeds: ['document-authoring'],
    } as unknown as GoalRequirements;

    const retrieved = retriever.retrieve(futureRequirements, [pattern]);
    expect(retrieved.length).toBe(1);
    expect(retrieved[0].id).toBe(pattern.id);
  });
});
