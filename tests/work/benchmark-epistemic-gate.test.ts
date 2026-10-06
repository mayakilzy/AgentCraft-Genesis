import { describe, expect, it } from 'vitest';

import {
  BLOCKED_MESSAGE,
  checkCrossArm,
  parseDeclaration,
  type EpistemicDeclaration,
} from '../../experiments/benchmark-023/epistemic-gate.js';

/**
 * TASK-023A — the pre-launch epistemic gate, pinned.
 *
 * Attempt 001 of the benchmark was invalidated because the actor label
 * (`GLM_FRESH_ISOLATED_SESSION`) was a hardcoded harness constant that
 * described a mechanism which did not exist: the builder session that
 * knew the hidden gold truth ended up serving worker reasoning. These
 * tests pin the remediation's hard rules:
 *
 *   - no arm launches without a complete declaration;
 *   - the three access gates accept ONLY literal `false` — `true`,
 *     missing, or "unknown" string values BLOCK (UNKNOWN is never
 *     downgraded to NO);
 *   - a reasoning context that already served one arm can never serve
 *     another;
 *   - an (attempt, arm) pair runs at most once.
 */

function validDeclaration(): Record<string, unknown> {
  return {
    benchmark_attempt_id: 'benchmark-023-attempt-002',
    arm_id: 'A',
    reasoning_actor_id: 'INDEPENDENT_ACTOR_XYZ',
    reasoning_mode: 'DEVELOPMENT_REASONING_FALLBACK',
    reasoning_context_id: 'ctx-arm-A-attempt-002',
    gold_access: false,
    builder_context_access: false,
    prior_arm_context_access: false,
  };
}

describe('parseDeclaration — the three hard access gates', () => {
  it('accepts a complete, honest declaration', () => {
    const result = parseDeclaration(JSON.stringify(validDeclaration()));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.declaration.arm_id).toBe('A');
      expect(result.declaration.reasoning_actor_id).toBe('INDEPENDENT_ACTOR_XYZ');
      expect(result.declaration.gold_access).toBe(false);
    }
  });

  it('BLOCKS when gold_access is true', () => {
    const d = { ...validDeclaration(), gold_access: true };
    const result = parseDeclaration(JSON.stringify(d));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failures.some((f) => f.field === 'gold_access')).toBe(true);
      expect(result.failures.some((f) => f.problem.includes(BLOCKED_MESSAGE))).toBe(true);
    }
  });

  it('BLOCKS when builder_context_access is the string "unknown" — UNKNOWN never downgrades to NO', () => {
    const d = { ...validDeclaration(), builder_context_access: 'unknown' };
    const result = parseDeclaration(JSON.stringify(d));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failures.some((f) => f.field === 'builder_context_access')).toBe(true);
    }
  });

  it('BLOCKS when prior_arm_context_access is absent', () => {
    const d = validDeclaration();
    delete d.prior_arm_context_access;
    const result = parseDeclaration(JSON.stringify(d));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failures.some((f) => f.field === 'prior_arm_context_access')).toBe(true);
    }
  });

  it('BLOCKS all three gates at once when all three are polluted', () => {
    const d = {
      ...validDeclaration(),
      gold_access: true,
      builder_context_access: true,
      prior_arm_context_access: 'UNVERIFIABLE',
    };
    const result = parseDeclaration(JSON.stringify(d));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failures.map((f) => f.field).sort()).toEqual([
        'builder_context_access',
        'gold_access',
        'prior_arm_context_access',
      ]);
    }
  });
});

describe('parseDeclaration — provenance fields (Step 9)', () => {
  it('BLOCKS an empty reasoning_context_id', () => {
    const d = { ...validDeclaration(), reasoning_context_id: '  ' };
    expect(parseDeclaration(JSON.stringify(d)).ok).toBe(false);
  });

  it('BLOCKS a missing reasoning_actor_id (no anonymous actors)', () => {
    const d = validDeclaration();
    delete d.reasoning_actor_id;
    const result = parseDeclaration(JSON.stringify(d));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failures.some((f) => f.field === 'reasoning_actor_id')).toBe(true);
    }
  });

  it('BLOCKS an invalid arm or mode', () => {
    expect(parseDeclaration(JSON.stringify({ ...validDeclaration(), arm_id: 'D' })).ok).toBe(false);
    expect(
      parseDeclaration(JSON.stringify({ ...validDeclaration(), reasoning_mode: 'VIBES' })).ok,
    ).toBe(false);
  });

  it('BLOCKS non-JSON and non-object payloads', () => {
    expect(parseDeclaration('not json').ok).toBe(false);
    expect(parseDeclaration('[1,2,3]').ok).toBe(false);
  });
});

describe('checkCrossArm — cross-arm context isolation (Step 7)', () => {
  function declaration(): EpistemicDeclaration {
    const result = parseDeclaration(JSON.stringify(validDeclaration()));
    if (!result.ok) throw new Error('test fixture declaration must parse as valid');
    return result.declaration;
  }

  it('accepts a fresh context with no prior arms', () => {
    expect(checkCrossArm(declaration(), [])).toEqual([]);
  });

  it('BLOCKS a reasoning context that already served another arm', () => {
    const priors = [
      {
        benchmark_attempt_id: 'benchmark-023-attempt-001',
        arm_id: 'C',
        reasoning_context_id: 'ctx-arm-A-attempt-002',
        source: 'mission-x',
      },
    ];
    const failures = checkCrossArm(declaration(), priors);
    expect(failures).toHaveLength(1);
    expect(failures[0].field).toBe('reasoning_context_id');
    expect(failures[0].problem).toContain('no reasoning session may serve more than one arm');
  });

  it('accepts a different context even against prior arms of other attempts', () => {
    const priors = [
      {
        benchmark_attempt_id: 'benchmark-023-attempt-002',
        arm_id: 'A',
        reasoning_context_id: 'ctx-arm-A-attempt-002',
        source: 'mission-x',
      },
    ];
    const d = declaration();
    d.reasoning_context_id = 'ctx-arm-B-attempt-002';
    d.arm_id = 'B';
    expect(checkCrossArm(d, priors)).toEqual([]);
  });

  it('BLOCKS rerunning the same arm of the same attempt (restart needs a new attempt id)', () => {
    const first = declaration(); // arm A, attempt-002, ctx-arm-A-attempt-002
    const priors = [
      {
        benchmark_attempt_id: first.benchmark_attempt_id,
        arm_id: 'A',
        reasoning_context_id: first.reasoning_context_id,
        source: 'mission-x',
      },
    ];
    const rerun = declaration();
    rerun.reasoning_context_id = 'ctx2-arm-A-attempt-002'; // fresh context, same arm+attempt
    const failures = checkCrossArm(rerun, priors);
    expect(failures.some((f) => f.field === 'benchmark_attempt_id')).toBe(true);
  });
});
