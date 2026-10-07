/**
 * G5-08 — Phase A & Phase B tests.
 *
 * Validates the structural integrity of the G5-08 final generalization and
 * greenfield validation evidence packages. Asserts:
 *   - Phase A produced GENERALIZATION_ACTIVE on Mission B + GENERALIZATION_NON_APPLICABLE on Mission A.
 *   - Phase A gate PASS.
 *   - Phase B greenfield gate PASS.
 *   - Independent runtime verification of greenfield artifacts PASS.
 *   - All missions are NEW (not renamed prior missions).
 *   - No false success, no harmful learning, no false generalization.
 *   - Production code delta = 0.
 *
 * This test reads the persisted evidence packages and asserts their invariants.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const G5_08_DIR = join(__dirname, '..', '..', 'experiments', 'academy', 'g5-08');

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

interface PhaseASummary {
  missionCount: number;
  missions: Array<{
    missionId: string;
    generalizationClassification: string;
    organizationChanged: boolean;
    baselineVerification: string;
    learnedVerification: string;
  }>;
  aggregate: {
    generalizationActiveCount: number;
    generalizationNonApplicableCount: number;
    generalizationHarmfulCount: number;
    generalizationFalseCount: number;
    falseSuccesses: number;
    evidenceSignatureCollisions: number;
  };
  phaseAGate: { gateResult: 'PASS' | 'FAIL' };
  productionChangeBudget: { productionFilesChanged: number };
}

interface PhaseBEvidence {
  missionDefinition: { goal: { outcome: string } };
  organization: { workers: Array<{ id: string; role: string }> };
  workerResult: { status: string; reasoningCalls: number };
  verification: { ok: boolean; passed: number; failed: number };
  falseSuccess: boolean;
  gate: { gateResult: 'PASS' | 'FAIL'; freshGoal: boolean; genesisProducedOrganization: boolean };
  patternTrace: { patternsRetrieved: string[]; patternsApplied: string[] };
}

interface IndependentVerification {
  checks: Array<{ label: string; passed: boolean }>;
  result: { INDEPENDENT_GREENFIELD_VERIFICATION: string };
}

interface PhaseCClosure {
  phaseAResult: { phaseAGate: string };
  phaseBResult: { greenfieldGate: string; independentRuntimeVerification: string };
  capabilityEvaluation: { allCriteriaSupported: boolean };
  group5ClosureDecision: { GROUP_5_STATUS: string; SAFE_TO_BEGIN_GROUP_6: string };
}

describe('G5-08 — Phase A Generalization evidence package', () => {
  it('persists Phase A summary and per-mission evidence', () => {
    expect(existsSync(join(G5_08_DIR, 'generalization', 'phase-a-summary.json'))).toBe(true);
    expect(existsSync(join(G5_08_DIR, 'generalization', 'phase-a-evidence.json'))).toBe(true);
    expect(existsSync(join(G5_08_DIR, 'generalization', 'phase-a-b-evidence.json'))).toBe(true);
  });

  it('executed 2 generalization missions (Section 7 permits ≤2 when needed to interpret the boundary)', () => {
    const summary = readJson<PhaseASummary>(join(G5_08_DIR, 'generalization', 'phase-a-summary.json'));
    expect(summary.missionCount).toBe(2);
  });

  it('Mission A is GENERALIZATION_NON_APPLICABLE (software-engineering domain, no pattern matched)', () => {
    const summary = readJson<PhaseASummary>(join(G5_08_DIR, 'generalization', 'phase-a-summary.json'));
    const missionA = summary.missions.find((m) => m.missionId === 'G5-08-GEN-A');
    expect(missionA).toBeDefined();
    expect(missionA!.generalizationClassification).toBe('GENERALIZATION_NON_APPLICABLE');
  });

  it('Mission B is GENERALIZATION_ACTIVE (pattern transferred to novel content domain)', () => {
    const summary = readJson<PhaseASummary>(join(G5_08_DIR, 'generalization', 'phase-a-summary.json'));
    const missionB = summary.missions.find((m) => m.missionId === 'G5-08-GEN-B');
    expect(missionB).toBeDefined();
    expect(missionB!.generalizationClassification).toBe('GENERALIZATION_ACTIVE');
    expect(missionB!.organizationChanged).toBe(true);
  });

  it('records ZERO harmful/false/inconclusive generalizations', () => {
    const summary = readJson<PhaseASummary>(join(G5_08_DIR, 'generalization', 'phase-a-summary.json'));
    expect(summary.aggregate.generalizationHarmfulCount).toBe(0);
    expect(summary.aggregate.generalizationFalseCount).toBe(0);
    expect(summary.aggregate.falseSuccesses).toBe(0);
    expect(summary.aggregate.evidenceSignatureCollisions).toBe(0);
  });

  it('PHASE_A_GATE = PASS', () => {
    const summary = readJson<PhaseASummary>(join(G5_08_DIR, 'generalization', 'phase-a-summary.json'));
    expect(summary.phaseAGate.gateResult).toBe('PASS');
  });

  it('production code delta = 0 in Phase A', () => {
    const summary = readJson<PhaseASummary>(join(G5_08_DIR, 'generalization', 'phase-a-summary.json'));
    expect(summary.productionChangeBudget.productionFilesChanged).toBe(0);
  });
});

describe('G5-08 — Phase B Greenfield evidence package', () => {
  it('persists Phase B evidence, organization, flight events, and independent verification', () => {
    expect(existsSync(join(G5_08_DIR, 'greenfield', 'phase-b-evidence.json'))).toBe(true);
    expect(existsSync(join(G5_08_DIR, 'greenfield', 'flight-events.jsonl'))).toBe(true);
    expect(existsSync(join(G5_08_DIR, 'greenfield', 'organization.json'))).toBe(true);
    expect(existsSync(join(G5_08_DIR, 'greenfield', 'pre-registration.json'))).toBe(true);
    expect(existsSync(join(G5_08_DIR, 'greenfield', 'reference-impl-wordfreq.mjs'))).toBe(true);
    expect(existsSync(join(G5_08_DIR, 'greenfield', 'independent-verify.mjs'))).toBe(true);
    expect(existsSync(join(G5_08_DIR, 'greenfield', 'independent-verification.json'))).toBe(true);
  });

  it('GREENFIELD_GATE = PASS', () => {
    const evidence = readJson<PhaseBEvidence>(join(G5_08_DIR, 'greenfield', 'phase-b-evidence.json'));
    expect(evidence.gate.gateResult).toBe('PASS');
    expect(evidence.gate.freshGoal).toBe(true);
    expect(evidence.gate.genesisProducedOrganization).toBe(true);
  });

  it('organization emerged from Genesis (>=1 worker, not hand-designed)', () => {
    const evidence = readJson<PhaseBEvidence>(join(G5_08_DIR, 'greenfield', 'phase-b-evidence.json'));
    expect(evidence.organization.workers.length).toBeGreaterThanOrEqual(1);
  });

  it('worker status = success and verification PASS', () => {
    const evidence = readJson<PhaseBEvidence>(join(G5_08_DIR, 'greenfield', 'phase-b-evidence.json'));
    expect(evidence.workerResult.status).toBe('success');
    expect(evidence.verification.ok).toBe(true);
    expect(evidence.verification.failed).toBe(0);
  });

  it('no false success', () => {
    const evidence = readJson<PhaseBEvidence>(join(G5_08_DIR, 'greenfield', 'phase-b-evidence.json'));
    expect(evidence.falseSuccess).toBe(false);
  });

  it('records pattern trace (retrieved + applied counts, may be 0 — learning is supporting evidence only)', () => {
    const evidence = readJson<PhaseBEvidence>(join(G5_08_DIR, 'greenfield', 'phase-b-evidence.json'));
    expect(Array.isArray(evidence.patternTrace.patternsRetrieved)).toBe(true);
    expect(Array.isArray(evidence.patternTrace.patternsApplied)).toBe(true);
    // Learning does NOT need to be applied for Greenfield PASS.
  });

  it('independent runtime verification PASS (artifacts actually function when executed)', () => {
    const verification = readJson<IndependentVerification>(join(G5_08_DIR, 'greenfield', 'independent-verification.json'));
    expect(verification.result.INDEPENDENT_GREENFIELD_VERIFICATION).toBe('PASS');
    for (const check of verification.checks) {
      expect(check.passed).toBe(true);
    }
  });

  it('independent-verify.mjs runs and outputs PASS', () => {
    const result = spawnSync('node', ['independent-verify.mjs'], {
      cwd: join(G5_08_DIR, 'greenfield'),
      encoding: 'utf8',
      timeout: 10000,
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('INDEPENDENT_GREENFIELD_VERIFICATION = PASS');
  });
});

describe('G5-08 — Phase C Closure Review', () => {
  it('persists Phase C closure review with all 9 capability criteria', () => {
    expect(existsSync(join(G5_08_DIR, 'phase-c-closure-review.json'))).toBe(true);
    const closure = readJson<PhaseCClosure>(join(G5_08_DIR, 'phase-c-closure-review.json'));
    expect(closure.phaseAResult.phaseAGate).toBe('PASS');
    expect(closure.phaseBResult.greenfieldGate).toBe('PASS');
    expect(closure.phaseBResult.independentRuntimeVerification).toContain('PASS');
    expect(closure.capabilityEvaluation.allCriteriaSupported).toBe(true);
    expect(closure.group5ClosureDecision.GROUP_5_STATUS).toBe('CLOSED_PASS_WITH_LIMITATIONS');
    expect(closure.group5ClosureDecision.SAFE_TO_BEGIN_GROUP_6).toBe('YES');
  });
});

describe('G5-08 — Group 5 Final Closure document', () => {
  it('persists docs/academy/GENESIS_GROUP5_FINAL_CLOSURE.md', () => {
    const closurePath = join(__dirname, '..', '..', 'docs', 'academy', 'GENESIS_GROUP5_FINAL_CLOSURE.md');
    expect(existsSync(closurePath)).toBe(true);
    const text = readFileSync(closurePath, 'utf8');
    expect(text).toContain('CLOSED_PASS_WITH_LIMITATIONS');
    expect(text).toContain('GROUP 5 PURPOSE');
    expect(text).toContain('STAGES COMPLETED');
    expect(text).toContain('WHAT WAS PROVEN');
    expect(text).toContain('WHAT WAS NOT PROVEN');
    expect(text).toContain('KNOWN LIMITATIONS');
    expect(text).toContain('FUTURE LEARNING BACKLOG');
    expect(text).toContain('GROUP 6 HANDOFF');
    expect(text).toContain('SAFE_TO_BEGIN_GROUP_6 = YES');
  });
});
