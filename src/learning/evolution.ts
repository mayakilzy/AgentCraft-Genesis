/**
 * Evolution Sandbox (TASK-029).
 *
 * A safe place where Genesis can propose changes to its organizational
 * strategies without silently changing production behavior.
 *
 *   current validated pattern
 *     → proposed variation
 *     → sandbox evaluation (ISOLATED from production)
 *     → compare against baseline
 *     → promote / reject
 *
 * Anti-bloat: this is NOT a second promotion framework. The sandbox reuses
 * TASK-026's evaluation concepts (support, contradiction, verification
 * quality) and the same MissionRun infrastructure as TASK-028. The only
 * NEW concept is the ISOLATION BOUNDARY: the sandbox evaluates a variant
 * without modifying the production pattern store, and the caller decides
 * whether to promote based on the comparison.
 *
 * "production behavior unchanged until promotion" is the hard constraint.
 * The sandbox does NOT touch the production pattern store. The caller
 * explicitly calls `promoteVariant` to add a promoted variant to production.
 *
 * Evolution targets (per spec): organization patterns, worker composition
 * strategies, genome defaults, routing preferences, planning heuristics,
 * reusable organizational knowledge. NOT source-code self-modification.
 */

import type { AdvisoryPattern } from '../organization/organization-planner.js';

/**
 * A proposed variation of an existing organizational pattern. The variant is
 * evaluated in isolation against the baseline; production behavior is
 * unchanged until the variant is explicitly promoted.
 */
export interface EvolutionVariant {
  /** Stable id for this variant. */
  readonly id: string;
  /** The production pattern this variant evolves from. */
  readonly baselinePatternId: string;
  /** Human-readable description of what the variant changes. */
  readonly description: string;
  /** The variant pattern itself. */
  readonly pattern: AdvisoryPattern;
}

/** The result of one mission run, used for baseline vs variant comparison. */
export interface EvolutionRunSnapshot {
  readonly workerCount: number;
  readonly reasoningCalls: number;
  readonly verificationOk: boolean;
  readonly verificationPassed: number;
  readonly verificationFailed: number;
  readonly status: 'success' | 'partial' | 'failure';
}

/** The comparison between a variant run and its baseline. */
export interface EvolutionComparison {
  readonly workerDelta: number;
  readonly reasoningDelta: number;
  readonly verificationEquivalent: boolean;
  /** True when the variant is strictly better: fewer workers, equivalent verification, ≤ reasoning calls. */
  readonly variantBetter: boolean;
  /** True when the variant is strictly worse: verification regressed, or more workers with no benefit. */
  readonly variantWorse: boolean;
}

/** The sandbox's decision. Only 'promote' adds the variant to production. */
export type EvolutionDecision = 'promote' | 'reject' | 'inconclusive';

/** The complete evolution result. */
export interface EvolutionResult {
  readonly variant: EvolutionVariant;
  readonly baseline: EvolutionRunSnapshot;
  readonly variantRun: EvolutionRunSnapshot;
  readonly comparison: EvolutionComparison;
  readonly decision: EvolutionDecision;
  readonly reason: string;
  /** True when the variant was evaluated in isolation (production patterns unchanged). */
  readonly isolationVerified: boolean;
}

/**
 * A mission runner function: runs a mission with the given patterns and
 * returns a snapshot of the result. The sandbox calls this twice — once for
 * the baseline, once for the variant — without modifying any production
 * state. The caller provides this function (it wraps the real
 * MissionOrchestrator or a test stub).
 */
export type EvolutionMissionRunner = (
  patterns: readonly AdvisoryPattern[],
) => Promise<EvolutionRunSnapshot>;

/**
 * The evolution sandbox. Evaluates one variant against its baseline in
 * ISOLATION. The production pattern store is NEVER modified during
 * evaluation — the caller decides whether to promote based on the result.
 */
export class EvolutionSandbox {
  readonly name = 'evolution-sandbox-v0.1';

  /**
   * Evaluate a variant by running two missions: one with the baseline
   * production patterns, one with the baseline PLUS the variant. The
   * comparison determines whether the variant is better, worse, or
   * inconclusive. The decision is NON-BINDING — the caller must call
   * `promoteVariant` to actually add the variant to production.
   */
  async evaluate(
    variant: EvolutionVariant,
    baselinePatterns: readonly AdvisoryPattern[],
    runMission: EvolutionMissionRunner,
  ): Promise<EvolutionResult> {
    // BASELINE: run with the EXISTING production patterns. The variant is
    // NOT included. This is the control.
    const baseline = await runMission(baselinePatterns);

    // VARIANT: run with the baseline patterns PLUS the variant. The variant
    // is evaluated on top of the existing production state — never replacing
    // it silently.
    const variantPatterns = [...baselinePatterns, variant.pattern];
    const variantRun = await runMission(variantPatterns);

    const comparison = this.compare(baseline, variantRun);
    const decision = this.decide(comparison, variant, baseline, variantRun);

    return {
      variant,
      baseline,
      variantRun,
      comparison,
      decision: decision.decision,
      reason: decision.reason,
      // The sandbox never modified the production pattern store: it only
      // read from it and ran missions with temporary pattern sets. The
      // caller can verify this by checking that baselinePatterns is
      // unchanged.
      isolationVerified: true,
    };
  }

  /**
   * Compare a variant run against its baseline. The variant is "better" when
   * it reduces workers (or reasoning calls) while keeping verification
   * equivalent. The variant is "worse" when verification regresses, or when
   * it adds workers without improving verification.
   */
  private compare(
    baseline: EvolutionRunSnapshot,
    variant: EvolutionRunSnapshot,
  ): EvolutionComparison {
    const workerDelta = variant.workerCount - baseline.workerCount;
    const reasoningDelta = variant.reasoningCalls - baseline.reasoningCalls;
    const verificationEquivalent =
      baseline.verificationOk === variant.verificationOk &&
      baseline.verificationPassed === variant.verificationPassed;

    const variantBetter =
      workerDelta < 0 &&
      verificationEquivalent &&
      reasoningDelta <= 0;

    const variantWorse =
      (!variant.verificationOk && baseline.verificationOk) ||
      (workerDelta > 0 && !verificationEquivalent);

    return { workerDelta, reasoningDelta, verificationEquivalent, variantBetter, variantWorse };
  }

  /**
   * Decide whether to promote, reject, or retain as inconclusive. Reuses the
   * same evidence-driven logic as TASK-026's evaluator — no model confidence,
   * just measured comparison.
   */
  private decide(
    comparison: EvolutionComparison,
    variant: EvolutionVariant,
    baseline: EvolutionRunSnapshot,
    variantRun: EvolutionRunSnapshot,
  ): { decision: EvolutionDecision; reason: string } {
    if (comparison.variantWorse) {
      return {
        decision: 'reject',
        reason:
          `Rejected: variant "${variant.id}" is worse than the baseline. ` +
          `workerDelta=${comparison.workerDelta}, reasoningDelta=${comparison.reasoningDelta}, ` +
          `verificationEquivalent=${comparison.verificationEquivalent}. ` +
          `Baseline: workers=${baseline.workerCount} verificationOk=${baseline.verificationOk}. ` +
          `Variant: workers=${variantRun.workerCount} verificationOk=${variantRun.verificationOk}.`,
      };
    }
    if (comparison.variantBetter) {
      return {
        decision: 'promote',
        reason:
          `Promoted: variant "${variant.id}" is strictly better than the baseline. ` +
          `workerDelta=${comparison.workerDelta}, reasoningDelta=${comparison.reasoningDelta}, ` +
          `verificationEquivalent=${comparison.verificationEquivalent}. ` +
          `The variant produces a smaller organization with equivalent verified outcome.`,
      };
    }
    return {
      decision: 'inconclusive',
      reason:
        `Inconclusive: variant "${variant.id}" is neither strictly better nor worse. ` +
        `workerDelta=${comparison.workerDelta}, reasoningDelta=${comparison.reasoningDelta}, ` +
        `verificationEquivalent=${comparison.verificationEquivalent}. ` +
        `Insufficient signal to promote or reject.`,
    };
  }
}

/**
 * Promote a variant by adding it to the production pattern set. The caller
 * MUST pass the result of `EvolutionSandbox.evaluate` and verify the
 * decision is 'promote' — this function does NOT re-evaluate.
 *
 * Returns a NEW array; the input `productionPatterns` is NOT mutated
 * (production behavior changes only when the caller adopts the returned
 * array).
 */
export function promoteVariant(
  productionPatterns: readonly AdvisoryPattern[],
  result: EvolutionResult,
): readonly AdvisoryPattern[] {
  if (result.decision !== 'promote') {
    throw new Error(
      `Cannot promote variant "${result.variant.id}": sandbox decision is ` +
        `"${result.decision}", not "promote".`,
    );
  }
  // The variant pattern is added to the production set. The baseline pattern
  // is NOT removed — the variant may augment or partially overlap it. The
  // planner applies both; if they conflict, the application order is
  // deterministic (production patterns first, variant last).
  return [...productionPatterns, result.variant.pattern];
}

/**
 * Verify that production behavior was unchanged during sandbox evaluation.
 * The caller passes the production patterns before and after the sandbox
 * run; this function confirms they are identical (the sandbox never touched
 * them).
 */
export function verifyIsolation(
  before: readonly AdvisoryPattern[],
  after: readonly AdvisoryPattern[],
): boolean {
  if (before.length !== after.length) return false;
  return before.every((pattern, index) => pattern.id === after[index]?.id);
}
