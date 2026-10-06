import { describe, expect, it } from 'vitest';

import { runEvolutionExperiment } from '../../experiments/evolution-029/run.js';

/**
 * TASK-029 — Evolution Sandbox Experiment test.
 *
 * Verifies the evolution experiment runs and produces a valid, honest
 * decision. The test does NOT force the decision to be 'promote' — that
 * would be "tuning the script until the experiment becomes green". The test
 * asserts:
 *   - the experiment runs to completion;
 *   - the sandbox evaluated both baseline and variant in isolation;
 *   - production behavior was unchanged during evaluation;
 *   - the decision is one of promote/reject/inconclusive;
 *   - if the decision is 'promote', the variant was added to production;
 *   - if the decision is NOT 'promote', production is unchanged.
 */

describe('TASK-029 — Evolution Sandbox Experiment', () => {
  it('runs to completion with isolation verified and a valid decision', async () => {
    const result = await runEvolutionExperiment();

    // The decision is one of the three valid values.
    expect(['promote', 'reject', 'inconclusive']).toContain(result.decision);
    expect(result.reason.length).toBeGreaterThan(0);

    // Isolation: the sandbox never modified production patterns during eval.
    expect(result.isolationVerified).toBe(true);

    // Both baseline and variant snapshots are real (from actual mission runs).
    expect(result.baselineSnapshot.workerCount).toBeGreaterThan(0);
    expect(result.variantSnapshot.workerCount).toBeGreaterThan(0);

    // Production behavior changes ONLY when the decision is 'promote'.
    if (result.decision === 'promote') {
      expect(result.variantPromotedToProduction).toBe(true);
      expect(result.productionPatternsAfter.length).toBe(
        result.productionPatternsBefore.length + 1,
      );
    } else {
      expect(result.variantPromotedToProduction).toBe(false);
      expect(result.productionPatternsAfter).toBe(result.productionPatternsBefore);
    }

    // The baseline pattern is the TASK-028 validated pattern.
    expect(result.baselinePattern.id).toBe('pat-diagnostic-avoid-reproduction-engineer');
    expect(result.baselinePattern.proposedEffect.targetRole).toBe('Reproduction Engineer');

    // The variant is a more aggressive version: also avoid Mission Coordinator.
    expect(result.variant.pattern.proposedEffect.targetRole).toBe('Mission Coordinator');
    expect(result.variant.baselinePatternId).toBe(result.baselinePattern.id);
  }, 60_000);
});
