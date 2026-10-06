import { describe, expect, it } from 'vitest';

import type { Experience } from '../../src/learning/experience.js';
import { StatisticalCandidateGenerator } from '../../src/learning/candidate-generator.js';

/**
 * TASK-025 — Learning Candidate Generator.
 *
 * Stored experience is not automatically knowledge. The generator produces
 * falsifiable, evidence-linked hypotheses from experiences — without
 * automatically changing Genesis behavior. Every candidate MUST reference
 * the experiences that produced it.
 */

function syntheticExperience(overrides: Partial<Experience> = {}): Experience {
  return {
    id: 'exp-syn-1',
    recordedAt: '2026-10-07T00:00:00Z',
    schemaVersion: 1,
    goal: { outcome: 'synthetic', domain: 'diagnostic', capabilityNeeds: ['data-analysis'] },
    organization: { workerCount: 4, roles: ['Diagnostic Analyst', 'Reproduction Engineer', 'Report Writer', 'Mission Coordinator'], collaborationEdges: 3, rationale: 'synthetic' },
    contributions: [
      { workerId: 'analyst', role: 'Diagnostic Analyst', reasoningCalls: 3, artifactsCount: 1, status: 'success' },
      { workerId: 'engineer', role: 'Reproduction Engineer', reasoningCalls: 0, artifactsCount: 0, status: 'success' },
      { workerId: 'writer', role: 'Report Writer', reasoningCalls: 2, artifactsCount: 1, status: 'success' },
      { workerId: 'coordinator', role: 'Mission Coordinator', reasoningCalls: 1, artifactsCount: 0, status: 'success' },
    ],
    outcome: { status: 'success', summary: 'ok', reasoningCalls: 6, wallMs: 100, retries: 0, humanInterventions: 0 },
    verification: { ok: true, passed: 2, failed: 0 },
    evidence: [],
    provenance: { missionId: 'syn-1', source: 'synthetic' },
    ...overrides,
  };
}

describe('TASK-025 — Learning Candidate Generator', () => {
  it('produces no candidates from an empty experience set', () => {
    const generator = new StatisticalCandidateGenerator();
    expect(generator.generate([])).toEqual([]);
  });

  it('detects a redundant role and produces an avoid-role candidate', () => {
    // Two diagnostic experiences where the Reproduction Engineer contributed
    // nothing (0 artifacts, 0 reasoning calls) — the canonical redundancy
    // signal.
    const exp1 = syntheticExperience({ id: 'exp-1', provenance: { missionId: 'm1', source: 'real-mission' } });
    const exp2 = syntheticExperience({
      id: 'exp-2',
      provenance: { missionId: 'm2', source: 'real-mission' },
    });

    const generator = new StatisticalCandidateGenerator({ now: () => '2026-10-07T00:00:00Z' });
    const candidates = generator.generate([exp1, exp2]);

    const avoid = candidates.find((c) => c.proposedEffect.kind === 'avoid-role' && c.proposedEffect.targetRole === 'Reproduction Engineer');
    expect(avoid).toBeDefined();
    expect(avoid!.hypothesis).toContain('Reproduction Engineer');
    expect(avoid!.hypothesis).toContain('diagnostic');
    expect(avoid!.supportingExperienceIds).toEqual(['exp-1', 'exp-2']);
    expect(avoid!.contradictingExperienceIds).toEqual([]);
    expect(avoid!.status).toBe('tentative');
    expect(avoid!.evidenceStrength).toBe(1);
    expect(avoid!.applicableContext.domain).toBe('diagnostic');
  });

  it('detects a valuable role and produces a prefer-role candidate', () => {
    // Two diagnostic experiences where the Report Writer consistently produced
    // artifacts and verification passed.
    const exp1 = syntheticExperience({ id: 'exp-1' });
    const exp2 = syntheticExperience({ id: 'exp-2' });

    const generator = new StatisticalCandidateGenerator({ now: () => '2026-10-07T00:00:00Z' });
    const candidates = generator.generate([exp1, exp2]);

    const prefer = candidates.find((c) => c.proposedEffect.kind === 'prefer-role' && c.proposedEffect.targetRole === 'Report Writer');
    expect(prefer).toBeDefined();
    expect(prefer!.hypothesis).toContain('Report Writer');
    expect(prefer!.supportingExperienceIds).toEqual(['exp-1', 'exp-2']);
  });

  it('does NOT flag a role as redundant when it produced artifacts in any experience', () => {
    // The Reproduction Engineer produced artifacts in exp2 — no avoid-role candidate.
    const exp1 = syntheticExperience({ id: 'exp-1' });
    const exp2 = syntheticExperience({
      id: 'exp-2',
      contributions: [
        { workerId: 'analyst', role: 'Diagnostic Analyst', reasoningCalls: 3, artifactsCount: 1, status: 'success' },
        { workerId: 'engineer', role: 'Reproduction Engineer', reasoningCalls: 2, artifactsCount: 1, status: 'success' },
        { workerId: 'writer', role: 'Report Writer', reasoningCalls: 2, artifactsCount: 1, status: 'success' },
        { workerId: 'coordinator', role: 'Mission Coordinator', reasoningCalls: 1, artifactsCount: 0, status: 'success' },
      ],
    });

    const generator = new StatisticalCandidateGenerator();
    const candidates = generator.generate([exp1, exp2]);

    const avoid = candidates.find((c) => c.proposedEffect.targetRole === 'Reproduction Engineer');
    expect(avoid).toBeUndefined();
  });

  it('every candidate references the experience evidence that produced it', () => {
    const exp1 = syntheticExperience({ id: 'exp-1' });
    const exp2 = syntheticExperience({ id: 'exp-2' });

    const generator = new StatisticalCandidateGenerator();
    const candidates = generator.generate([exp1, exp2]);

    for (const candidate of candidates) {
      expect(candidate.supportingExperienceIds.length).toBeGreaterThan(0);
      for (const id of candidate.supportingExperienceIds) {
        expect(['exp-1', 'exp-2']).toContain(id);
      }
    }
  });

  it('is deterministic: identical experiences produce identical candidates', () => {
    const exp1 = syntheticExperience({ id: 'exp-1' });
    const exp2 = syntheticExperience({ id: 'exp-2' });

    const generator1 = new StatisticalCandidateGenerator({ now: () => '2026-10-07T00:00:00Z' });
    const generator2 = new StatisticalCandidateGenerator({ now: () => '2026-10-07T00:00:00Z' });

    const c1 = generator1.generate([exp1, exp2]);
    const c2 = generator2.generate([exp1, exp2]);
    expect(JSON.stringify(c1)).toBe(JSON.stringify(c2));
  });

  it('does not automatically change Genesis behavior — candidates are tentative', () => {
    const exp1 = syntheticExperience({ id: 'exp-1' });
    const generator = new StatisticalCandidateGenerator();
    const candidates = generator.generate([exp1]);
    for (const candidate of candidates) {
      expect(candidate.status).toBe('tentative');
    }
  });

  it('separates candidates by domain — research experiences do not produce diagnostic candidates', () => {
    const diagnosticExp = syntheticExperience({ id: 'exp-d', goal: { outcome: 'd', domain: 'diagnostic', capabilityNeeds: ['data-analysis'] } });
    const researchExp = syntheticExperience({
      id: 'exp-r',
      goal: { outcome: 'r', domain: 'research', capabilityNeeds: ['web-research'] },
      organization: { workerCount: 4, roles: ['Web Researcher', 'Data Analyst', 'Report Writer', 'Mission Coordinator'], collaborationEdges: 3, rationale: 'r' },
      contributions: [
        { workerId: 'researcher', role: 'Web Researcher', reasoningCalls: 3, artifactsCount: 1, status: 'success' },
        { workerId: 'analyst', role: 'Data Analyst', reasoningCalls: 0, artifactsCount: 0, status: 'success' },
        { workerId: 'writer', role: 'Report Writer', reasoningCalls: 2, artifactsCount: 1, status: 'success' },
        { workerId: 'coordinator', role: 'Mission Coordinator', reasoningCalls: 1, artifactsCount: 0, status: 'success' },
      ],
    });

    const generator = new StatisticalCandidateGenerator();
    const candidates = generator.generate([diagnosticExp, researchExp]);

    const diagnosticAvoids = candidates.filter((c) => c.applicableContext.domain === 'diagnostic');
    const researchAvoids = candidates.filter((c) => c.applicableContext.domain === 'research');
    expect(diagnosticAvoids.length).toBeGreaterThan(0);
    expect(researchAvoids.length).toBeGreaterThan(0);
    // The diagnostic candidate targets Reproduction Engineer (only in diagnostic plan).
    expect(diagnosticAvoids.some((c) => c.proposedEffect.targetRole === 'Reproduction Engineer')).toBe(true);
    // The research candidate targets Data Analyst (only in research plan).
    expect(researchAvoids.some((c) => c.proposedEffect.targetRole === 'Data Analyst')).toBe(true);
  });
});
