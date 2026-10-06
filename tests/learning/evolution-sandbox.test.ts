import { describe, expect, it } from 'vitest';

import {
  EvolutionSandbox,
  promoteVariant,
  verifyIsolation,
  type EvolutionRunSnapshot,
  type EvolutionVariant,
} from '../../src/learning/evolution.js';
import type { AdvisoryPattern } from '../../src/organization/organization-planner.js';

/**
 * TASK-029 — Evolution Sandbox.
 *
 * A safe place where Genesis can propose changes to organizational strategies
 * without silently changing production behavior. The sandbox evaluates a
 * variant in ISOLATION; production behavior is unchanged until the caller
 * explicitly promotes the variant.
 */

function snapshot(overrides: Partial<EvolutionRunSnapshot> = {}): EvolutionRunSnapshot {
  return {
    workerCount: 4,
    reasoningCalls: 6,
    verificationOk: true,
    verificationPassed: 2,
    verificationFailed: 0,
    status: 'success',
    ...overrides,
  };
}

function baselinePattern(): AdvisoryPattern {
  return {
    id: 'pat-diagnostic-avoid-reproduction-engineer',
    applicableContext: { domain: 'diagnostic' },
    proposedEffect: { kind: 'avoid-role', description: 'omit', targetRole: 'Reproduction Engineer' },
  };
}

function variantPattern(): AdvisoryPattern {
  return {
    id: 'pat-diagnostic-avoid-mission-coordinator-variant',
    applicableContext: { domain: 'diagnostic' },
    proposedEffect: { kind: 'avoid-role', description: 'omit coordinator too', targetRole: 'Mission Coordinator' },
  };
}

function variant(): EvolutionVariant {
  return {
    id: 'variant-avoid-coordinator',
    baselinePatternId: 'pat-diagnostic-avoid-reproduction-engineer',
    description: 'Also omit the Mission Coordinator for diagnostic missions.',
    pattern: variantPattern(),
  };
}

describe('TASK-029 — Evolution Sandbox', () => {
  it('promotes a variant that produces a smaller organization with equivalent verification', async () => {
    const sandbox = new EvolutionSandbox();
    const productionPatterns: readonly AdvisoryPattern[] = [baselinePattern()];

    let callCount = 0;
    const runner = async (patterns: readonly AdvisoryPattern[]): Promise<EvolutionRunSnapshot> => {
      callCount += 1;
      // Baseline call (1 pattern): 2 workers. Variant call (2 patterns): 1 worker.
      return patterns.length === 1
        ? snapshot({ workerCount: 2, reasoningCalls: 4 })
        : snapshot({ workerCount: 1, reasoningCalls: 2 });
    };

    const result = await sandbox.evaluate(variant(), productionPatterns, runner);

    expect(result.decision).toBe('promote');
    expect(result.comparison.workerDelta).toBe(-1);
    expect(result.comparison.reasoningDelta).toBe(-2);
    expect(result.comparison.verificationEquivalent).toBe(true);
    expect(result.comparison.variantBetter).toBe(true);
    expect(result.isolationVerified).toBe(true);
    expect(callCount).toBe(2); // baseline + variant
  });

  it('rejects a variant that regresses verification', async () => {
    const sandbox = new EvolutionSandbox();
    const productionPatterns: readonly AdvisoryPattern[] = [baselinePattern()];

    const runner = async (patterns: readonly AdvisoryPattern[]): Promise<EvolutionRunSnapshot> => {
      return patterns.length === 1
        ? snapshot({ workerCount: 2, verificationOk: true })
        : snapshot({ workerCount: 1, verificationOk: false, verificationPassed: 1, verificationFailed: 1 });
    };

    const result = await sandbox.evaluate(variant(), productionPatterns, runner);

    expect(result.decision).toBe('reject');
    expect(result.comparison.variantWorse).toBe(true);
    expect(result.reason).toContain('worse');
  });

  it('returns inconclusive when the variant is neither better nor worse', async () => {
    const sandbox = new EvolutionSandbox();
    const productionPatterns: readonly AdvisoryPattern[] = [baselinePattern()];

    const runner = async (): Promise<EvolutionRunSnapshot> => {
      // Same workers, same reasoning, same verification — no signal.
      return snapshot({ workerCount: 2, reasoningCalls: 4 });
    };

    const result = await sandbox.evaluate(variant(), productionPatterns, runner);

    expect(result.decision).toBe('inconclusive');
    expect(result.comparison.variantBetter).toBe(false);
    expect(result.comparison.variantWorse).toBe(false);
    expect(result.reason).toContain('neither');
  });

  it('does NOT modify the production pattern store during evaluation', async () => {
    const sandbox = new EvolutionSandbox();
    const productionPatterns: readonly AdvisoryPattern[] = [baselinePattern()];
    // Take a snapshot of the production patterns before evaluation.
    const before = [...productionPatterns];

    const runner = async (): Promise<EvolutionRunSnapshot> => snapshot();
    await sandbox.evaluate(variant(), productionPatterns, runner);

    // The production patterns array is unchanged — the sandbox never touched it.
    expect(verifyIsolation(before, productionPatterns)).toBe(true);
  });

  it('promoteVariant throws when the decision was not promote — no caller-side promotion', async () => {
    const sandbox = new EvolutionSandbox();
    const productionPatterns: readonly AdvisoryPattern[] = [baselinePattern()];

    const runner = async (patterns: readonly AdvisoryPattern[]): Promise<EvolutionRunSnapshot> => {
      return patterns.length === 1
        ? snapshot({ workerCount: 2, verificationOk: true })
        : snapshot({ workerCount: 1, verificationOk: false });
    };

    const result = await sandbox.evaluate(variant(), productionPatterns, runner);
    expect(result.decision).toBe('reject');

    expect(() => promoteVariant(productionPatterns, result)).toThrow(/Cannot promote/);
  });

  it('promoteVariant returns a NEW array — the input is NOT mutated', async () => {
    const sandbox = new EvolutionSandbox();
    const productionPatterns: readonly AdvisoryPattern[] = [baselinePattern()];

    const runner = async (patterns: readonly AdvisoryPattern[]): Promise<EvolutionRunSnapshot> => {
      return patterns.length === 1
        ? snapshot({ workerCount: 2, reasoningCalls: 4 })
        : snapshot({ workerCount: 1, reasoningCalls: 2 });
    };

    const result = await sandbox.evaluate(variant(), productionPatterns, runner);
    expect(result.decision).toBe('promote');

    const promoted = promoteVariant(productionPatterns, result);
    expect(promoted).toHaveLength(2);
    expect(promoted[0]).toStrictEqual(baselinePattern());
    expect(promoted[1]).toStrictEqual(variantPattern());
    // The ORIGINAL array is unchanged.
    expect(productionPatterns).toHaveLength(1);
    expect(productionPatterns[0]).toStrictEqual(baselinePattern());
  });

  it('verifyIsolation detects when production patterns were mutated', () => {
    const before: AdvisoryPattern[] = [baselinePattern()];
    const after: AdvisoryPattern[] = [baselinePattern(), variantPattern()];
    expect(verifyIsolation(before, after)).toBe(false);
  });

  it('the sandbox evaluates the variant on top of the baseline — not replacing it', async () => {
    const sandbox = new EvolutionSandbox();
    const productionPatterns: readonly AdvisoryPattern[] = [baselinePattern()];

    let baselineCallPatterns: readonly AdvisoryPattern[] | null = null;
    let variantCallPatterns: readonly AdvisoryPattern[] | null = null;

    const runner = async (patterns: readonly AdvisoryPattern[]): Promise<EvolutionRunSnapshot> => {
      if (baselineCallPatterns === null) {
        baselineCallPatterns = patterns;
      } else {
        variantCallPatterns = patterns;
      }
      return snapshot();
    };

    await sandbox.evaluate(variant(), productionPatterns, runner);

    // Baseline call: just the production patterns (no variant).
    expect(baselineCallPatterns).toHaveLength(1);
    expect(baselineCallPatterns![0].id).toBe('pat-diagnostic-avoid-reproduction-engineer');

    // Variant call: production patterns PLUS the variant.
    expect(variantCallPatterns).toHaveLength(2);
    expect(variantCallPatterns![0].id).toBe('pat-diagnostic-avoid-reproduction-engineer');
    expect(variantCallPatterns![1].id).toBe('pat-diagnostic-avoid-mission-coordinator-variant');
  });
});
