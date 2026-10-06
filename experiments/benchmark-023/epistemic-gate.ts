/**
 * TASK-023A — the pre-launch epistemic gate (supervisor's Steps 9/10/12).
 *
 * The invalid attempt 001 proved that the weakest point of the benchmark
 * was not the workload or the evaluator but the boundary between
 * BENCHMARK AUTHORITY (who knows the gold truth) and REASONING ACTOR
 * (who serves worker reasoning). Filesystem isolation alone cannot
 * enforce that boundary; an explicit, machine-checked declaration must.
 *
 * Before any arm may launch, the operator supplies a declaration file:
 *
 *   {
 *     "benchmark_attempt_id": "benchmark-023-attempt-002",
 *     "arm_id": "A" | "B" | "C",
 *     "reasoning_actor_id": "<who actually serves worker reasoning>",
 *     "reasoning_mode": "DEVELOPMENT_REASONING_FALLBACK" | "EXTERNAL_PROVIDER",
 *     "reasoning_context_id": "<unique per arm — never reused>",
 *     "gold_access": false,
 *     "builder_context_access": false,
 *     "prior_arm_context_access": false
 *   }
 *
 * Gate rules (hard — no downgrade, no defaulting):
 *
 *   - every field must be present and well-formed;
 *   - the three access fields must be the literal boolean `false`;
 *     `true`, missing, "unknown" or any other value BLOCKS the launch;
 *   - the reasoning context must never have served another arm
 *     (checked against every prior ARM-RESULT.json declaration);
 *   - an (attempt, arm) pair runs at most once — a rerun requires a new
 *     attempt id, which is the supervisor's Arm-A restart policy.
 *
 * What this gate does NOT do: it cannot mechanically prove the truth of
 * the declaration. Its job is to make the epistemic claim explicit,
 * machine-checkable and permanently recorded in the arm's evidence, so
 * that a false claim (like attempt 001's `GLM_FRESH_ISOLATED_SESSION`
 * label) can never again hide inside a hardcoded harness constant.
 */

export interface EpistemicDeclaration {
  benchmark_attempt_id: string;
  arm_id: 'A' | 'B' | 'C';
  reasoning_actor_id: string;
  reasoning_mode: 'DEVELOPMENT_REASONING_FALLBACK' | 'EXTERNAL_PROVIDER';
  reasoning_context_id: string;
  gold_access: false;
  builder_context_access: false;
  prior_arm_context_access: false;
}

export interface GateFailure {
  field: string;
  problem: string;
}

export interface PriorArmDeclaration {
  benchmark_attempt_id: string;
  arm_id: string;
  reasoning_context_id: string;
  source: string;
}

const STRING_FIELDS = [
  'benchmark_attempt_id',
  'reasoning_actor_id',
  'reasoning_context_id',
] as const;

const ACCESS_FIELDS = [
  'gold_access',
  'builder_context_access',
  'prior_arm_context_access',
] as const;

export const BLOCKED_MESSAGE = 'BENCHMARK BLOCKED — EPISTEMIC ISOLATION NOT PROVEN';

export type GateResult =
  | { ok: true; declaration: EpistemicDeclaration }
  | { ok: false; failures: GateFailure[] };

export function parseDeclaration(raw: string): GateResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, failures: [{ field: '<file>', problem: 'not valid JSON' }] };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, failures: [{ field: '<file>', problem: 'not a JSON object' }] };
  }
  const d = parsed as Record<string, unknown>;
  const failures: GateFailure[] = [];

  for (const field of STRING_FIELDS) {
    if (typeof d[field] !== 'string' || (d[field] as string).trim() === '') {
      failures.push({ field, problem: 'must be a non-empty string' });
    }
  }
  if (d.arm_id !== 'A' && d.arm_id !== 'B' && d.arm_id !== 'C') {
    failures.push({ field: 'arm_id', problem: 'must be "A", "B" or "C"' });
  }
  if (
    d.reasoning_mode !== 'DEVELOPMENT_REASONING_FALLBACK' &&
    d.reasoning_mode !== 'EXTERNAL_PROVIDER'
  ) {
    failures.push({
      field: 'reasoning_mode',
      problem: 'must be "DEVELOPMENT_REASONING_FALLBACK" or "EXTERNAL_PROVIDER"',
    });
  }
  // The three hard gates. Anything but literal `false` — including
  // `true`, a missing field, or a string like "unknown" — blocks the
  // launch. UNKNOWN is never downgraded to NO.
  for (const field of ACCESS_FIELDS) {
    if (d[field] !== false) {
      failures.push({
        field,
        problem: `must be the literal boolean false (got ${JSON.stringify(d[field]) ?? 'absent'}) — ${BLOCKED_MESSAGE}`,
      });
    }
  }

  if (failures.length > 0) {
    return { ok: false, failures };
  }
  return {
    ok: true,
    declaration: d as unknown as EpistemicDeclaration,
  };
}

/** Cross-arm isolation (supervisor's Step 7): one reasoning context per arm,
 *  and one arm per attempt. `priors` are all previous arms' declarations. */
export function checkCrossArm(
  declaration: EpistemicDeclaration,
  priors: PriorArmDeclaration[],
): GateFailure[] {
  const failures: GateFailure[] = [];
  for (const prior of priors) {
    if (prior.reasoning_context_id === declaration.reasoning_context_id) {
      failures.push({
        field: 'reasoning_context_id',
        problem: `context already served arm ${prior.arm_id} of attempt ${prior.benchmark_attempt_id} (${prior.source}) — no reasoning session may serve more than one arm`,
      });
    }
    if (
      prior.benchmark_attempt_id === declaration.benchmark_attempt_id &&
      prior.arm_id === declaration.arm_id
    ) {
      failures.push({
        field: 'benchmark_attempt_id',
        problem: `arm ${declaration.arm_id} already ran in attempt ${declaration.benchmark_attempt_id} (${prior.source}) — restart requires a new attempt id, new mission and new context`,
      });
    }
  }
  return failures;
}
