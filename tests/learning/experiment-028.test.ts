import { describe, expect, it } from 'vitest';

import { runExperiment, type ExperimentClassification } from '../../experiments/learning-028/run.js';

/**
 * TASK-028 — Measured Learning Experiment test.
 *
 * The experiment runs through the REAL Genesis pipeline (MemoryRuntime +
 * scripted ReasoningProvider, but real GoalCompiler / OrganizationPlanner /
 * GenomeCompiler / MissionOrchestrator / VerificationLoop). This test
 * verifies the experiment RUNS and produces a valid, honest classification.
 *
 * It does NOT assert the classification is PASS — that would be "tuning the
 * script until the experiment becomes green", which the spec forbids. The
 * test asserts:
 *   - the experiment runs to completion;
 *   - all three phases produce real artifacts (runs, experiences, candidates,
 *     evaluations, patterns, after-run);
 *   - the classification is one of the four valid values;
 *   - the classification reason is non-empty;
 *   - the metrics are internally consistent with the runs.
 *
 * The actual classification value is reported in the experiment's REPORT.md.
 */

const VALID_CLASSIFICATIONS: readonly ExperimentClassification[] = [
  'MEASURED_LEARNING_PASS',
  'MEASURED_LEARNING_NO_IMPROVEMENT',
  'MEASURED_LEARNING_REGRESSION',
  'EXPERIMENT_INCONCLUSIVE',
];

describe('TASK-028 — Measured Learning Experiment', () => {
  it('runs to completion and produces a valid honest classification', async () => {
    const result = await runExperiment();

    // The classification must be one of the four valid values.
    expect(VALID_CLASSIFICATIONS).toContain(result.classification);
    expect(result.classificationReason.length).toBeGreaterThan(0);

    // PHASE A — 2 BEFORE missions with real experiences.
    expect(result.before.runs).toHaveLength(2);
    expect(result.before.experiences).toHaveLength(2);
    for (const run of result.before.runs) {
      expect(run.planWorkers).toBeGreaterThan(0);
      expect(run.planRoles).toContain('Reproduction Engineer');
      // The Reproduction Engineer must have contributed nothing — the
      // signal the candidate generator needs.
      expect(run.reproductionEngineerContribution).not.toBeNull();
      expect(run.reproductionEngineerContribution!.artifactsCount).toBe(0);
    }

    // PHASE B — candidates, evaluations, and at least one promoted pattern.
    expect(result.learning.candidateIds.length).toBeGreaterThan(0);
    expect(result.learning.evaluations.length).toBe(result.learning.candidateIds.length);

    const avoidCandidate = result.learning.candidateIds.find((id) =>
      id.includes('avoid-reproduction-engineer'),
    );
    expect(avoidCandidate, 'a redundant-role candidate for Reproduction Engineer must be generated').toBeDefined();

    expect(result.learning.patterns.length).toBeGreaterThanOrEqual(1);
    const promotedPattern = result.learning.patterns.find((p) =>
      p.id.includes('avoid-reproduction-engineer'),
    );
    expect(promotedPattern, 'the Reproduction Engineer avoid-role pattern must be promoted').toBeDefined();
    expect(promotedPattern!.proposedEffect.kind).toBe('avoid-role');
    expect(promotedPattern!.proposedEffect.targetRole).toBe('Reproduction Engineer');
    expect(promotedPattern!.promotionEvidence.supportingExperienceIds.length).toBeGreaterThanOrEqual(2);

    // PHASE C — the AFTER mission must have actually run.
    expect(result.after.run.planWorkers).toBeGreaterThan(0);
    expect(result.after.run.planRoles).not.toContain('Reproduction Engineer');

    // Metrics are internally consistent.
    expect(result.metrics.beforeWorkerCount).toBe(result.before.runs[0].planWorkers);
    expect(result.metrics.afterWorkerCount).toBe(result.after.run.planWorkers);
    expect(result.metrics.workerDelta).toBe(
      result.metrics.afterWorkerCount - result.metrics.beforeWorkerCount,
    );
    expect(result.metrics.patternProvenanceTraces).toBe(true);
    expect(result.metrics.patternApplied).toBe(true);

    // The honest classification: if workers decreased and verification held,
    // it's a PASS. If workers decreased but verification failed, it's a
    // REGRESSION. The test does NOT force either — it asserts the
    // classification matches the evidence.
    if (
      result.metrics.workerDelta < 0 &&
      result.metrics.beforeVerificationOk &&
      result.metrics.afterVerificationOk &&
      result.metrics.reasoningDelta <= 0
    ) {
      expect(result.classification).toBe('MEASURED_LEARNING_PASS');
    } else if (
      result.metrics.workerDelta < 0 &&
      !result.metrics.afterVerificationOk
    ) {
      expect(result.classification).toBe('MEASURED_LEARNING_REGRESSION');
    } else if (result.metrics.workerDelta >= 0) {
      expect(result.classification).toBe('MEASURED_LEARNING_NO_IMPROVEMENT');
    }
  }, 60_000);
});
