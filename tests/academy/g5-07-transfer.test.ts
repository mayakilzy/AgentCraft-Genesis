/**
 * G5-07 — Sealed Blind Transfer tests.
 *
 * Validates the structural integrity of the G5-07 transfer experiment:
 *   - The four transfer missions are executed under both arms.
 *   - The trusted pattern set is frozen (3 patterns, no quarantined).
 *   - The quarantined pattern does NOT participate.
 *   - All four missions preserve correctness and verification across arms.
 *   - The aggregate classification matches the recorded evidence.
 *
 * This test reads the persisted evidence package and asserts its invariants.
 * It does NOT re-execute the missions — that would couple the test to the
 * runtime. Re-execution is the harness's responsibility
 * (experiments/academy/g5-07/run-transfer.ts).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const G5_07_DIR = join(__dirname, '..', '..', 'experiments', 'academy', 'g5-07');

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

interface AggregateResults {
  phase: string;
  missionsSelected: number;
  missionsExecuted: number;
  missionsVerifiedBaseline: number;
  missionsVerifiedLearned: number;
  classificationCounts: Record<string, number>;
  organizationsChanged: number;
  baselineTotalWorkers: number;
  learnedTotalWorkers: number;
  workerDelta: number;
  baselineTotalReasoning: number;
  learnedTotalReasoning: number;
  reasoningDelta: number;
  falseSuccesses: number;
  evidenceSignatureCollisions: number;
  integrity: {
    missionTextsModified: string;
    transferSetContaminated: boolean;
    patternStateChangedDuringTransfer: string;
    newPatternsPromotedDuringTransfer: string;
    quarantinedPatternUsed: string;
    evaluatorLeakage: string;
    passChasingDetected: string;
  };
}

interface TransferReport {
  overallOutcome: string;
  strongestSupportedClaim: string;
  safeToBeginG5_08: boolean;
  knownLimitations: string[];
}

interface PatternTrace {
  missionId: string;
  missionFamily: string;
  missionTextModified: 'NO';
  previouslyExecuted: 'NO';
  goalDomain: string;
  capabilityNeeds: string[];
  evidenceSignature: string;
  patternsRetrieved: string[];
  patternApplied: boolean;
  patternOverridden: boolean;
  baselineOrganization: { workerCount: number; roles: string[] };
  learnedOrganization: { workerCount: number; roles: string[] };
  organizationChanged: boolean;
  causalAttribution: boolean;
  baselineVerification: { ok: boolean; passed: number; failed: number };
  learnedVerification: { ok: boolean; passed: number; failed: number };
  transferClassification: string;
  interpretation: string;
}

interface FrozenPatternState {
  frozenTrustedPatterns: { id: string; scientificStatus: string }[];
  quarantinedPatterns: { id: string; mustNotParticipate: boolean }[];
  g5_07MutationPolicy: Record<string, string>;
}

interface SealedSetIntegrity {
  checks: Record<string, { result: string; status: string }>;
  quarantineCheck: { retrievableForG5_07: boolean };
  transferSetIntegrity: string;
  contaminated: boolean;
}

describe('G5-07 — Sealed Blind Transfer evidence package', () => {
  it('persists the four required evidence artifacts', () => {
    expect(existsSync(join(G5_07_DIR, 'pre-registration.json'))).toBe(true);
    expect(existsSync(join(G5_07_DIR, 'frozen-pattern-state.json'))).toBe(true);
    expect(existsSync(join(G5_07_DIR, 'sealed-set-integrity.json'))).toBe(true);
    expect(existsSync(join(G5_07_DIR, 'aggregate-results.json'))).toBe(true);
    expect(existsSync(join(G5_07_DIR, 'transfer-report.json'))).toBe(true);
    expect(existsSync(join(G5_07_DIR, 'per-mission-traces.json'))).toBe(true);
  });

  it('persists per-mission evidence for all four sealed missions × 2 arms', () => {
    const missions = ['C001-02', 'C001-04', 'C001-06', 'C001-08'];
    const arms = ['baseline', 'learned'];
    for (const mission of missions) {
      expect(existsSync(join(G5_07_DIR, 'missions', mission, 'pattern-trace.json'))).toBe(true);
      for (const arm of arms) {
        const armDir = join(G5_07_DIR, 'missions', mission, arm);
        expect(existsSync(join(armDir, 'flight-events.jsonl'))).toBe(true);
        expect(existsSync(join(armDir, 'verification.json'))).toBe(true);
        expect(existsSync(join(armDir, 'plan.json'))).toBe(true);
      }
    }
  });

  it('freezes exactly 3 trusted patterns and 1 quarantined pattern', () => {
    const frozen = readJson<FrozenPatternState>(join(G5_07_DIR, 'frozen-pattern-state.json'));
    expect(frozen.frozenTrustedPatterns.length).toBe(3);
    expect(frozen.quarantinedPatterns.length).toBe(1);
    expect(frozen.quarantinedPatterns[0].id).toBe('cand-research-prefer-sole-operator');
    expect(frozen.quarantinedPatterns[0].mustNotParticipate).toBe(true);
  });

  it('marks the pattern state as frozen with no mutations during transfer', () => {
    const frozen = readJson<FrozenPatternState>(join(G5_07_DIR, 'frozen-pattern-state.json'));
    expect(frozen.g5_07MutationPolicy.transferPatternStateFrozen).toBe('YES');
    expect(frozen.g5_07MutationPolicy.newPatternsPromotedDuringTransfer).toBe('NO');
    expect(frozen.g5_07MutationPolicy.supportCountsModifiedDuringTransfer).toBe('NO');
    expect(frozen.g5_07MutationPolicy.patternApplicabilityModifiedDuringTransfer).toBe('NO');
    expect(frozen.g5_07MutationPolicy.patternStateChangedDuringTransfer).toBe('NO');
    expect(frozen.g5_07MutationPolicy.quarantinedPatternUsed).toBe('NO');
  });

  it('verifies sealed set integrity: all four missions previously unexecuted', () => {
    const ssi = readJson<SealedSetIntegrity>(join(G5_07_DIR, 'sealed-set-integrity.json'));
    for (const id of ['C001-02_PREVIOUSLY_EXECUTED', 'C001-04_PREVIOUSLY_EXECUTED', 'C001-06_PREVIOUSLY_EXECUTED', 'C001-08_PREVIOUSLY_EXECUTED']) {
      expect(ssi.checks[id].result).toBe('NO');
      expect(ssi.checks[id].status).toBe('INTACT');
    }
    expect(ssi.transferSetIntegrity).toBe('INTACT');
    expect(ssi.contaminated).toBe(false);
    expect(ssi.quarantineCheck.retrievableForG5_07).toBe(false);
  });

  it('executed all four missions × 2 arms = 8 runs, all verified', () => {
    const agg = readJson<AggregateResults>(join(G5_07_DIR, 'aggregate-results.json'));
    expect(agg.missionsSelected).toBe(4);
    expect(agg.missionsExecuted).toBe(8);
    expect(agg.missionsVerifiedBaseline).toBe(4);
    expect(agg.missionsVerifiedLearned).toBe(4);
  });

  it('records ZERO false successes, harmful transfers, false transfers, or contamination', () => {
    const agg = readJson<AggregateResults>(join(G5_07_DIR, 'aggregate-results.json'));
    expect(agg.falseSuccesses).toBe(0);
    expect(agg.classificationCounts.HARMFUL_TRANSFER).toBe(0);
    expect(agg.classificationCounts.FALSE_TRANSFER).toBe(0);
    expect(agg.classificationCounts.INCONCLUSIVE).toBe(0);
    expect(agg.integrity.transferSetContaminated).toBe(false);
    expect(agg.integrity.quarantinedPatternUsed).toBe('NO');
    expect(agg.integrity.evaluatorLeakage).toBe('NO');
    expect(agg.integrity.passChasingDetected).toBe('NO');
    expect(agg.integrity.missionTextsModified).toBe('NO');
    expect(agg.integrity.patternStateChangedDuringTransfer).toBe('NO');
    expect(agg.integrity.newPatternsPromotedDuringTransfer).toBe('NO');
  });

  it('classifies all four missions into the recorded taxonomy', () => {
    const traces = readJson<PatternTrace[]>(join(G5_07_DIR, 'per-mission-traces.json'));
    expect(traces.length).toBe(4);

    const classifications = traces.map((t) => t.transferClassification);
    expect(classifications).toContain('CONFIRMATORY_TRANSFER');
    expect(classifications).toContain('NON_APPLICABLE');

    // Every trace's mission text is unmodified and previously unexecuted.
    for (const trace of traces) {
      expect(trace.missionTextModified).toBe('NO');
      expect(trace.previouslyExecuted).toBe('NO');
    }

    // Every trace's verification passed in both arms.
    for (const trace of traces) {
      expect(trace.baselineVerification.ok).toBe(true);
      expect(trace.learnedVerification.ok).toBe(true);
      expect(trace.baselineVerification.failed).toBe(0);
      expect(trace.learnedVerification.failed).toBe(0);
    }
  });

  it('does NOT record ACTIVE_TRANSFER for any mission (minimal-scope early return)', () => {
    const traces = readJson<PatternTrace[]>(join(G5_07_DIR, 'per-mission-traces.json'));
    for (const trace of traces) {
      expect(trace.transferClassification).not.toBe('ACTIVE_TRANSFER');
      expect(trace.organizationChanged).toBe(false);
      expect(trace.causalAttribution).toBe(false);
    }
  });

  it('records the quarantined pattern as NOT retrieved for any mission', () => {
    const traces = readJson<PatternTrace[]>(join(G5_07_DIR, 'per-mission-traces.json'));
    const QUARANTINED_ID = 'cand-research-prefer-sole-operator';
    for (const trace of traces) {
      expect(trace.patternsRetrieved).not.toContain(QUARANTINED_ID);
    }
  });

  it('marks C001-06 as NON_APPLICABLE (no trusted pattern matches software-engineering)', () => {
    const traces = readJson<PatternTrace[]>(join(G5_07_DIR, 'per-mission-traces.json'));
    const c00106 = traces.find((t) => t.missionId === 'C001-06');
    expect(c00106).toBeDefined();
    expect(c00106!.transferClassification).toBe('NON_APPLICABLE');
    expect(c00106!.patternsRetrieved.length).toBe(0);
  });

  it('marks C001-02/04/08 as CONFIRMATORY_TRANSFER (pattern retrieved but not applied)', () => {
    const traces = readJson<PatternTrace[]>(join(G5_07_DIR, 'per-mission-traces.json'));
    for (const id of ['C001-02', 'C001-04', 'C001-08']) {
      const trace = traces.find((t) => t.missionId === id);
      expect(trace).toBeDefined();
      expect(trace!.transferClassification).toBe('CONFIRMATORY_TRANSFER');
      expect(trace!.patternsRetrieved.length).toBeGreaterThan(0);
      expect(trace!.patternApplied).toBe(false);
    }
  });

  it('preserves worker count and reasoning across arms (workerDelta=0, reasoningDelta=0)', () => {
    const agg = readJson<AggregateResults>(join(G5_07_DIR, 'aggregate-results.json'));
    expect(agg.workerDelta).toBe(0);
    expect(agg.reasoningDelta).toBe(0);
    expect(agg.organizationsChanged).toBe(0);
  });

  it('records the overall outcome as BLIND_TRANSFER_PASS_WITH_LIMITATION', () => {
    const report = readJson<TransferReport>(join(G5_07_DIR, 'transfer-report.json'));
    expect(report.overallOutcome).toBe('BLIND_TRANSFER_PASS_WITH_LIMITATION');
    expect(report.safeToBeginG5_08).toBe(true);
    expect(report.strongestSupportedClaim).toContain('scripted reasoning conditions');
    // The claim must NOT overstate what was demonstrated.
    expect(report.strongestSupportedClaim).not.toContain('cross-family');
    expect(report.strongestSupportedClaim).not.toContain('universal');
    expect(report.strongestSupportedClaim).not.toContain('production-scale');
  });

  it('records the scripted-reasoning limitation honestly', () => {
    const report = readJson<TransferReport>(join(G5_07_DIR, 'transfer-report.json'));
    const limitations = report.knownLimitations.join('\n');
    expect(limitations).toContain('Scripted reasoning');
    expect(limitations).toContain('minimal-scope');
    expect(limitations).toContain('organizational requirements');
    expect(limitations).toContain('cross-family');
  });
});
