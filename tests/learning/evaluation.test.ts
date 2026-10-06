import { describe, expect, it } from 'vitest';

import type { Experience } from '../../src/learning/experience.js';
import type { LearningCandidate } from '../../src/learning/candidate.js';
import { RuleCandidateEvaluator } from '../../src/learning/evaluation.js';
import { promoteCandidate } from '../../src/learning/pattern.js';

/**
 * TASK-026 — Learning Evaluation / Promotion.
 *
 * The trust boundary: candidates are hypotheses; the evaluator decides
 * whether they deserve to influence future organization design. Promotion is
 * auditable; LLM confidence alone can NEVER promote organizational knowledge.
 */

function exp(overrides: Partial<Experience> = {}): Experience {
  return {
    id: 'exp-1',
    recordedAt: '2026-10-07T00:00:00Z',
    schemaVersion: 2,
    goal: { outcome: 'x', domain: 'diagnostic', capabilityNeeds: ['data-analysis'] },
    organization: { workerCount: 4, roles: ['Diagnostic Analyst', 'Reproduction Engineer', 'Report Writer', 'Mission Coordinator'], collaborationEdges: 3, rationale: 'x' },
    contributions: [
      { workerId: 'analyst', role: 'Diagnostic Analyst', reasoningCalls: 3, artifactsCount: 1, status: 'success' },
      { workerId: 'engineer', role: 'Reproduction Engineer', reasoningCalls: 0, artifactsCount: 0, status: 'success' },
      { workerId: 'writer', role: 'Report Writer', reasoningCalls: 2, artifactsCount: 1, status: 'success' },
      { workerId: 'coordinator', role: 'Mission Coordinator', reasoningCalls: 1, artifactsCount: 0, status: 'success' },
    ],
    outcome: { status: 'success', summary: 'ok', reasoningCalls: 6, wallMs: 100, retries: 0, humanInterventions: 0 },
    verification: { ok: true, passed: 2, failed: 0 },
    evidence: [],
    provenance: { missionId: 'm1', source: 'real-mission' },
    ...overrides,
  };
}

function candidate(overrides: Partial<LearningCandidate> = {}): LearningCandidate {
  return {
    id: 'cand-diagnostic-avoid-reproduction-engineer',
    hypothesis: 'The Reproduction Engineer role is redundant for diagnostic missions.',
    applicableContext: { domain: 'diagnostic' },
    proposedEffect: { kind: 'avoid-role', description: 'omit', targetRole: 'Reproduction Engineer' },
    supportingExperienceIds: ['exp-1', 'exp-2'],
    contradictingExperienceIds: [],
    evidenceStrength: 1,
    status: 'tentative',
    generatedAt: '2026-10-07T00:00:00Z',
    generator: 'test',
    ...overrides,
  };
}

describe('TASK-026 — Learning Evaluation / Promotion', () => {
  it('promotes a candidate with enough supporting evidence and no contradictions', () => {
    const exp1 = exp({ id: 'exp-1' });
    const exp2 = exp({ id: 'exp-2', provenance: { missionId: 'm2', source: 'real-mission' } });
    const evaluator = new RuleCandidateEvaluator({ now: () => '2026-10-07T00:00:00Z' });

    const evaluation = evaluator.evaluate(candidate(), [exp1, exp2]);

    expect(evaluation.status).toBe('promoted');
    expect(evaluation.evidence.supportCount).toBe(2);
    expect(evaluation.evidence.contradictionCount).toBe(0);
    expect(evaluation.evidence.verificationQuality).toBe('success');
    expect(evaluation.reason).toContain('Promoted');
    expect(evaluation.evaluator).toBe('rule-candidate-evaluator-v0.1');
  });

  it('retains as tentative when support is below the promotion threshold', () => {
    const exp1 = exp({ id: 'exp-1' });
    const evaluator = new RuleCandidateEvaluator({ promotionThreshold: 2, now: () => '2026-10-07T00:00:00Z' });
    const single = candidate({ supportingExperienceIds: ['exp-1'] });

    const evaluation = evaluator.evaluate(single, [exp1]);

    expect(evaluation.status).toBe('tentative');
    expect(evaluation.evidence.supportCount).toBe(1);
    expect(evaluation.reason).toContain('Tentative');
  });

  it('rejects a candidate when a contradicting experience disconfirms it', () => {
    const exp1 = exp({ id: 'exp-1' }); // Reproduction Engineer idle
    const exp2 = exp({ id: 'exp-2', provenance: { missionId: 'm2', source: 'real-mission' } }); // idle
    // Contradiction: a diagnostic experience where the Reproduction Engineer
    // DID produce artifacts.
    const contradiction = exp({
      id: 'exp-3',
      provenance: { missionId: 'm3', source: 'real-mission' },
      contributions: [
        { workerId: 'analyst', role: 'Diagnostic Analyst', reasoningCalls: 3, artifactsCount: 1, status: 'success' },
        { workerId: 'engineer', role: 'Reproduction Engineer', reasoningCalls: 4, artifactsCount: 2, status: 'success' },
        { workerId: 'writer', role: 'Report Writer', reasoningCalls: 2, artifactsCount: 1, status: 'success' },
        { workerId: 'coordinator', role: 'Mission Coordinator', reasoningCalls: 1, artifactsCount: 0, status: 'success' },
      ],
    });

    const evaluator = new RuleCandidateEvaluator();
    const evaluation = evaluator.evaluate(candidate(), [exp1, exp2, contradiction]);

    expect(evaluation.status).toBe('rejected');
    expect(evaluation.evidence.contradictionCount).toBe(1);
    expect(evaluation.reason).toContain('Rejected');
  });

  it('rejects a candidate when every supporting experience failed verification', () => {
    const exp1 = exp({ id: 'exp-1', verification: { ok: false, passed: 0, failed: 2 }, outcome: { status: 'failure', summary: 'fail', reasoningCalls: 6, wallMs: 100, retries: 1, humanInterventions: 0 } });
    const exp2 = exp({ id: 'exp-2', verification: { ok: false, passed: 0, failed: 2 }, outcome: { status: 'failure', summary: 'fail', reasoningCalls: 6, wallMs: 100, retries: 1, humanInterventions: 0 }, provenance: { missionId: 'm2', source: 'real-mission' } });

    const evaluator = new RuleCandidateEvaluator();
    const evaluation = evaluator.evaluate(candidate(), [exp1, exp2]);

    expect(evaluation.status).toBe('rejected');
    expect(evaluation.evidence.verificationQuality).toBe('failure');
    expect(evaluation.reason).toContain('verification');
  });

  it('negative learning: an avoid-role candidate is evaluated by the same rules — no separate failure-learning subsystem', () => {
    const exp1 = exp({ id: 'exp-1' });
    const exp2 = exp({ id: 'exp-2', provenance: { missionId: 'm2', source: 'real-mission' } });
    const evaluator = new RuleCandidateEvaluator();
    const evaluation = evaluator.evaluate(candidate(), [exp1, exp2]);

    expect(evaluation.status).toBe('promoted');
    // The promoted candidate is an AVOID-role — Genesis can learn "do NOT use
    // this pattern under these conditions" through the same evaluation path
    // as prefer-role candidates.
  });

  it('promotion is auditable — every evaluation cites the rule that fired and the evidence counts', () => {
    const exp1 = exp({ id: 'exp-1' });
    const exp2 = exp({ id: 'exp-2', provenance: { missionId: 'm2', source: 'real-mission' } });
    const evaluator = new RuleCandidateEvaluator({ promotionThreshold: 2, now: () => '2026-10-07T00:00:00Z' });
    const evaluation = evaluator.evaluate(candidate(), [exp1, exp2]);

    expect(evaluation.candidateId).toBe('cand-diagnostic-avoid-reproduction-engineer');
    expect(evaluation.evaluatedAt).toBe('2026-10-07T00:00:00Z');
    expect(evaluation.reason).toMatch(/support=2 contradiction=0 quality=success/);
  });

  it('promoteCandidate produces an OrganizationalPattern retaining provenance to underlying experiences', () => {
    const exp1 = exp({ id: 'exp-1' });
    const exp2 = exp({ id: 'exp-2', provenance: { missionId: 'm2', source: 'real-mission' } });
    const evaluator = new RuleCandidateEvaluator({ now: () => '2026-10-07T00:00:00Z' });
    const evaluation = evaluator.evaluate(candidate(), [exp1, exp2]);
    expect(evaluation.status).toBe('promoted');

    const pattern = promoteCandidate(candidate(), evaluation, () => '2026-10-07T01:00:00Z');
    expect(pattern.id).toBe(candidate().id);
    expect(pattern.source).toBe('learning-candidate');
    expect(pattern.promotionEvidence.supportingExperienceIds).toEqual(['exp-1', 'exp-2']);
    expect(pattern.promotionEvidence.promotedAt).toBe('2026-10-07T01:00:00Z');
    expect(pattern.proposedEffect.kind).toBe('avoid-role');
    expect(pattern.proposedEffect.targetRole).toBe('Reproduction Engineer');
  });

  it('promoteCandidate throws when the evaluation did not promote — no caller-side promotion', () => {
    const exp1 = exp({ id: 'exp-1' });
    const evaluator = new RuleCandidateEvaluator({ promotionThreshold: 2 });
    const single = candidate({ supportingExperienceIds: ['exp-1'] });
    const evaluation = evaluator.evaluate(single, [exp1]);
    expect(evaluation.status).toBe('tentative');

    expect(() => promoteCandidate(single, evaluation)).toThrow(/Cannot promote/);
  });
});
