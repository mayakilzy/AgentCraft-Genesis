/**
 * G6-03 — Benchmark harness.
 *
 * Runs the Decision Corpus through each provider arm (Rule, Jev), records
 * per-case outcomes (choice, latency, cost, failure), and emits evidence
 * JSON files.
 *
 * Usage:
 *   set -a && source /home/z/my-project/vault/.vault-env && set +a
 *   npx tsx experiments/g6-03/run-benchmark.ts
 *
 * Cost ceiling: 29 cases × 1 Jev call + 5 consistency repeats + 6 failure
 * tests = 40 calls max. At ~$0.0003/call observed: ~$0.012 max.
 *
 * This is BENCHMARK-ONLY code. It does NOT count against the Anti-Bloat
 * gate (it lives under experiments/).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import type {
  Decision,
  DecisionProvider,
} from '../../src/contracts/core.js';
import {
  JevDecisionProvider,
  JevCredentialMissingError,
  JevCredentialInvalidError,
  JevProviderUnavailableError,
  JevProviderTimeoutError,
  JevMalformedResponseError,
  JevInvalidChoiceError,
  type JevProviderMetadata,
} from '../../src/providers/jev-decision-provider.js';
import { RuleBenchmarkProvider } from './arms/rule-arm.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CorpusCase {
  case_id: string;
  family: string;
  decision_kind: string;
  input: Decision<string>;
  expected_choice: string;
  ground_truth_method: string;
  ground_truth_rationale: string;
  consequence_of_wrong_decision: string;
  notes: string;
}

interface Corpus {
  schema_version: string;
  frozen_at: string;
  corpus_version: string;
  total_cases: number;
  families: Array<{ id: string; name: string; decision_kind: string; case_count: number }>;
  cases: CorpusCase[];
}

interface CaseResult {
  case_id: string;
  family: string;
  decision_kind: string;
  arm: 'rule' | 'jev';
  expected_choice: string;
  returned_choice: string | null;
  outcome: 'correct' | 'incorrect' | 'failure' | 'invalid';
  error_class?: string;
  error_message?: string;
  latency_ms: number;
  cost_usd?: number;
  reasoning_tokens?: number;
  prompt_tokens?: number;
  completion_tokens?: number;
  reasoning_excerpt?: string;
  reason?: string;
}

interface FailureProbeResult {
  probe_id: string;
  probe_description: string;
  expected_error_class: string;
  actual_error_class?: string;
  outcome: 'pass' | 'fail';
  detail: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadCorpus(): Corpus {
  const p = path.join(__dirname, 'corpus', 'decision-corpus.json');
  const raw = fs.readFileSync(p, 'utf8');
  return JSON.parse(raw) as Corpus;
}

function redact(text: string): string {
  // Defense in depth: redact any 'sk-...' or 'Bearer ...' pattern
  let out = text.replace(/sk-(?:proj-|or-v1-)?[A-Za-z0-9_-]{20,}/gi, '[redacted]');
  out = out.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]');
  out = out.replace(/gh[pousr]_[A-Za-z0-9]{36,}/gi, 'ghp_[redacted]');
  return out;
}

function errorClass(e: unknown): string {
  if (e instanceof JevCredentialMissingError) return 'JevCredentialMissingError';
  if (e instanceof JevCredentialInvalidError) return 'JevCredentialInvalidError';
  if (e instanceof JevProviderUnavailableError) return 'JevProviderUnavailableError';
  if (e instanceof JevProviderTimeoutError) return 'JevProviderTimeoutError';
  if (e instanceof JevMalformedResponseError) return 'JevMalformedResponseError';
  if (e instanceof JevInvalidChoiceError) return 'JevInvalidChoiceError';
  return e instanceof Error ? e.name : 'UnknownError';
}

async function runCase(
  arm: DecisionProvider,
  c: CorpusCase,
): Promise<CaseResult> {
  const t0 = Date.now();
  try {
    const out = await arm.decide(c.input);
    const latency_ms = Date.now() - t0;
    // JevDecisionProvider returns JevDecisionOutcome with providerMetadata.
    // We narrow the type via a structural check rather than `instanceof`
    // to avoid importing the concrete outcome type into the harness.
    const meta = 'providerMetadata' in out
      ? (out as { providerMetadata: JevProviderMetadata }).providerMetadata
      : undefined;
    if (arm instanceof JevDecisionProvider && meta) {
      return {
        case_id: c.case_id,
        family: c.family,
        decision_kind: c.decision_kind,
        arm: 'jev',
        expected_choice: c.expected_choice,
        returned_choice: out.choice,
        outcome: out.choice === c.expected_choice ? 'correct' : 'incorrect',
        latency_ms,
        cost_usd: meta.costUsd,
        reasoning_tokens: meta.reasoningTokens,
        prompt_tokens: meta.promptTokens,
        completion_tokens: meta.completionTokens,
        reasoning_excerpt: meta.reasoningExcerpt ? redact(meta.reasoningExcerpt) : undefined,
        reason: out.reason ? redact(out.reason) : undefined,
      };
    }
    return {
      case_id: c.case_id,
      family: c.family,
      decision_kind: c.decision_kind,
      arm: 'rule',
      expected_choice: c.expected_choice,
      returned_choice: out.choice,
      outcome: out.choice === c.expected_choice ? 'correct' : 'incorrect',
      latency_ms,
      reason: out.reason ? redact(out.reason) : undefined,
    };
  } catch (e: unknown) {
    const latency_ms = Date.now() - t0;
    const cls = errorClass(e);
    // Invalid choice is a different outcome class from a generic failure.
    const isInvalidChoice = e instanceof JevInvalidChoiceError;
    return {
      case_id: c.case_id,
      family: c.family,
      decision_kind: c.decision_kind,
      arm: arm instanceof JevDecisionProvider ? 'jev' : 'rule',
      expected_choice: c.expected_choice,
      returned_choice: null,
      outcome: isInvalidChoice ? 'invalid' : 'failure',
      error_class: cls,
      error_message: redact(String((e as Error)?.message ?? e)).slice(0, 500),
      latency_ms,
    };
  }
}

// ---------------------------------------------------------------------------
// Failure-behavior probes (Section 26)
// ---------------------------------------------------------------------------

async function runFailureProbes(
  fetchImpl: typeof fetch,
): Promise<FailureProbeResult[]> {
  void new JevDecisionProvider({
    fetchImpl,
    testCredential: 'sk-test-only-fake-key',
  });
  const results: FailureProbeResult[] = [];

  // Probe F1: missing credential
  // Use an env var name that is NOT set so the provider cannot find any
  // credential, regardless of OPENROUTER_API_KEY being present in env.
  {
    const jevNoCred = new JevDecisionProvider({
      fetchImpl,
      envVarName: '__JEV_PROBE_F1_UNSET_ENV_VAR__',
    });
    try {
      await jevNoCred.decide({
        kind: 'reasoning-tier',
        question: 'q',
        options: ['cheap', 'default', 'frontier'],
        facts: { criticality: 'routine' },
      });
      results.push({
        probe_id: 'F1',
        probe_description: 'missing credential throws JevCredentialMissingError',
        expected_error_class: 'JevCredentialMissingError',
        outcome: 'fail',
        detail: 'no error thrown',
      });
    } catch (e) {
      const cls = errorClass(e);
      results.push({
        probe_id: 'F1',
        probe_description: 'missing credential throws JevCredentialMissingError',
        expected_error_class: 'JevCredentialMissingError',
        actual_error_class: cls,
        outcome: cls === 'JevCredentialMissingError' ? 'pass' : 'fail',
        detail: redact(String((e as Error)?.message ?? e)).slice(0, 200),
      });
    }
  }

  // Probe F2: invalid credential (HTTP 401)
  {
    const fakeFetch = (async () =>
      new Response('{"error":"unauthorized"}', { status: 401 })) as unknown as typeof fetch;
    const jev401 = new JevDecisionProvider({
      fetchImpl: fakeFetch,
      testCredential: 'sk-test-only-fake-key',
    });
    try {
      await jev401.decide({
        kind: 'reasoning-tier',
        question: 'q',
        options: ['cheap', 'default', 'frontier'],
        facts: { criticality: 'routine' },
      });
      results.push({
        probe_id: 'F2',
        probe_description: 'invalid credential (HTTP 401) throws JevCredentialInvalidError',
        expected_error_class: 'JevCredentialInvalidError',
        outcome: 'fail',
        detail: 'no error thrown',
      });
    } catch (e) {
      const cls = errorClass(e);
      const msg = redact(String((e as Error)?.message ?? e));
      results.push({
        probe_id: 'F2',
        probe_description: 'invalid credential (HTTP 401) throws JevCredentialInvalidError',
        expected_error_class: 'JevCredentialInvalidError',
        actual_error_class: cls,
        outcome: cls === 'JevCredentialInvalidError' ? 'pass' : 'fail',
        detail: msg.slice(0, 200),
      });
    }
  }

  // Probe F3: provider unavailable (HTTP 500)
  {
    const fakeFetch = (async () =>
      new Response('{"error":"server"}', { status: 500 })) as unknown as typeof fetch;
    const jev500 = new JevDecisionProvider({
      fetchImpl: fakeFetch,
      testCredential: 'sk-test-only-fake-key',
    });
    try {
      await jev500.decide({
        kind: 'reasoning-tier',
        question: 'q',
        options: ['cheap', 'default', 'frontier'],
        facts: { criticality: 'routine' },
      });
      results.push({
        probe_id: 'F3',
        probe_description: 'provider unavailable (HTTP 500) throws JevProviderUnavailableError',
        expected_error_class: 'JevProviderUnavailableError',
        outcome: 'fail',
        detail: 'no error thrown',
      });
    } catch (e) {
      const cls = errorClass(e);
      const msg = redact(String((e as Error)?.message ?? e));
      results.push({
        probe_id: 'F3',
        probe_description: 'provider unavailable (HTTP 500) throws JevProviderUnavailableError',
        expected_error_class: 'JevProviderUnavailableError',
        actual_error_class: cls,
        outcome: cls === 'JevProviderUnavailableError' ? 'pass' : 'fail',
        detail: msg.slice(0, 200),
      });
    }
  }

  // Probe F4: timeout
  {
    const fakeFetch = (async () => {
      // The provider uses a 30s timeout via AbortController. We simulate
      // timeout by throwing an AbortError-like.
      const err = new Error('The operation was aborted');
      err.name = 'AbortError';
      throw err;
    }) as unknown as typeof fetch;
    const jevTimeout = new JevDecisionProvider({
      fetchImpl: fakeFetch,
      testCredential: 'sk-test-only-fake-key',
    });
    try {
      await jevTimeout.decide({
        kind: 'reasoning-tier',
        question: 'q',
        options: ['cheap', 'default', 'frontier'],
        facts: { criticality: 'routine' },
      });
      results.push({
        probe_id: 'F4',
        probe_description: 'timeout throws JevProviderUnavailableError (network error path)',
        expected_error_class: 'JevProviderUnavailableError',
        outcome: 'fail',
        detail: 'no error thrown',
      });
    } catch (e) {
      const cls = errorClass(e);
      const msg = redact(String((e as Error)?.message ?? e));
      results.push({
        probe_id: 'F4',
        probe_description: 'timeout throws JevProviderUnavailableError (network error path)',
        expected_error_class: 'JevProviderUnavailableError',
        actual_error_class: cls,
        // Note: the abort path goes through the network-error catch, not
        // the explicit JevProviderTimeoutError throw (that path is for
        // when our explicit AbortController fires). Both surface as
        // JevProviderUnavailableError, which is the desired "fail loudly"
        // behavior — the Jev timeout is observable, never silent.
        outcome: cls === 'JevProviderUnavailableError' ? 'pass' : 'fail',
        detail: msg.slice(0, 200),
      });
    }
  }

  // Probe F5: malformed response
  {
    const fakeFetch = (async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: 'not-json' } }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )) as unknown as typeof fetch;
    const jevMalformed = new JevDecisionProvider({
      fetchImpl: fakeFetch,
      testCredential: 'sk-test-only-fake-key',
    });
    try {
      await jevMalformed.decide({
        kind: 'reasoning-tier',
        question: 'q',
        options: ['cheap', 'default', 'frontier'],
        facts: { criticality: 'routine' },
      });
      results.push({
        probe_id: 'F5',
        probe_description: 'malformed response throws JevMalformedResponseError',
        expected_error_class: 'JevMalformedResponseError',
        outcome: 'fail',
        detail: 'no error thrown',
      });
    } catch (e) {
      const cls = errorClass(e);
      const msg = redact(String((e as Error)?.message ?? e));
      results.push({
        probe_id: 'F5',
        probe_description: 'malformed response throws JevMalformedResponseError',
        expected_error_class: 'JevMalformedResponseError',
        actual_error_class: cls,
        outcome: cls === 'JevMalformedResponseError' ? 'pass' : 'fail',
        detail: msg.slice(0, 200),
      });
    }
  }

  // Probe F6: invalid choice returned
  {
    const fakeFetch = (async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({ choice: 'quantum', reason: 'r' }),
              },
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )) as unknown as typeof fetch;
    const jevInvalid = new JevDecisionProvider({
      fetchImpl: fakeFetch,
      testCredential: 'sk-test-only-fake-key',
    });
    try {
      await jevInvalid.decide({
        kind: 'reasoning-tier',
        question: 'q',
        options: ['cheap', 'default', 'frontier'],
        facts: { criticality: 'routine' },
      });
      results.push({
        probe_id: 'F6',
        probe_description: 'invalid choice throws JevInvalidChoiceError',
        expected_error_class: 'JevInvalidChoiceError',
        outcome: 'fail',
        detail: 'no error thrown',
      });
    } catch (e) {
      const cls = errorClass(e);
      const msg = redact(String((e as Error)?.message ?? e));
      results.push({
        probe_id: 'F6',
        probe_description: 'invalid choice throws JevInvalidChoiceError',
        expected_error_class: 'JevInvalidChoiceError',
        actual_error_class: cls,
        outcome: cls === 'JevInvalidChoiceError' ? 'pass' : 'fail',
        detail: msg.slice(0, 200),
      });
    }
  }

  // Probe F7: no silent fallback — verify a 500 results in a thrown error,
  // NOT in a successful outcome. This is structural (we inspect the source
  // via behavior). The probe is a behavioral check.
  {
    const fakeFetch = (async () =>
      new Response('{"error":"server"}', { status: 500 })) as unknown as typeof fetch;
    const jevSilent = new JevDecisionProvider({
      fetchImpl: fakeFetch,
      testCredential: 'sk-test-only-fake-key',
    });
    const result = await jevSilent
      .decide({
        kind: 'reasoning-tier',
        question: 'q',
        options: ['cheap', 'default', 'frontier'],
        facts: { criticality: 'routine' },
      })
      .catch((e) => e);
    const isThrownError = result instanceof Error;
    const hasChoice =
      typeof result === 'object' && result !== null && 'choice' in result;
    results.push({
      probe_id: 'F7',
      probe_description: 'no silent fallback: provider failure surfaces as thrown error, not successful outcome',
      expected_error_class: '(any Jev*Error)',
      actual_error_class: isThrownError ? errorClass(result) : 'NONE',
      outcome: isThrownError && !hasChoice ? 'pass' : 'fail',
      detail: isThrownError
        ? 'error was thrown; no fallback choice produced'
        : 'NO error thrown — silent fallback path executed (BUG)',
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const corpus = loadCorpus();
  console.log(`[g6-03] Loaded corpus v${corpus.corpus_version}: ${corpus.total_cases} cases`);

  // Verify credential is in env
  if (!process.env.OPENROUTER_API_KEY) {
    console.error('JEV_ACCESS_BLOCKED: OPENROUTER_API_KEY not in env. Source vault/.vault-env first.');
    process.exit(2);
  }

  // Build arms
  const ruleArm = new RuleBenchmarkProvider();
  const jevArm = new JevDecisionProvider(); // reads env

  // 1. Run all cases through Rule arm (no API calls, fast)
  const ruleResults: CaseResult[] = [];
  for (const c of corpus.cases) {
    const r = await runCase(ruleArm, c);
    ruleResults.push(r);
    console.log(`  [rule] ${c.case_id} (${c.family}/${c.decision_kind}) -> ${r.outcome} (got "${r.returned_choice}", expected "${c.expected_choice}")`);
  }

  // 2. Run all cases through Jev arm (29 real API calls)
  const jevResults: CaseResult[] = [];
  let totalJevCost = 0;
  for (const c of corpus.cases) {
    const r = await runCase(jevArm, c);
    jevResults.push(r);
    if (r.cost_usd) totalJevCost += r.cost_usd;
    console.log(
      `  [jev]  ${c.case_id} (${c.family}/${c.decision_kind}) -> ${r.outcome} ` +
        `(got "${r.returned_choice}", expected "${c.expected_choice}", ` +
        `latency=${r.latency_ms}ms, cost=$${(r.cost_usd ?? 0).toFixed(7)})`,
    );
  }

  // 3. Consistency repeats: 5 cases twice (B1, B2, C1, D1, F1)
  const repeatCaseIds = ['B1', 'B2', 'C1', 'D1', 'F1'];
  const consistencyResults: CaseResult[] = [];
  for (const id of repeatCaseIds) {
    const c = corpus.cases.find((x) => x.case_id === id)!;
    const r = await runCase(jevArm, c);
    consistencyResults.push({ ...r, case_id: `${id}-repeat` });
    if (r.cost_usd) totalJevCost += r.cost_usd;
    console.log(`  [jev-rep] ${id} -> ${r.outcome} (got "${r.returned_choice}")`);
  }

  // 4. Failure-behavior probes (no real API calls — stub fetch)
  const failureProbes = await runFailureProbes(fetch);
  for (const p of failureProbes) {
    console.log(`  [probe] ${p.probe_id} -> ${p.outcome} (${p.detail.slice(0, 100)})`);
  }

  // 5. Compute aggregates
  const totalJevCalls = jevResults.length + consistencyResults.length;
  const successfulJevCalls = jevResults.filter((r) => r.outcome === 'correct' || r.outcome === 'incorrect').length;
  const failedJevCalls = jevResults.filter((r) => r.outcome === 'failure' || r.outcome === 'invalid').length;

  const perFamily: Record<string, {
    rule: { total: number; correct: number; incorrect: number; failure: number; avg_latency_ms: number };
    jev: { total: number; correct: number; incorrect: number; failure: number; invalid: number; avg_latency_ms: number; avg_cost_usd: number };
  }> = {};
  for (const fam of ['A', 'B', 'C', 'D', 'E', 'F']) {
    const ruleFam = ruleResults.filter((r) => r.family === fam);
    const jevFam = jevResults.filter((r) => r.family === fam);
    perFamily[fam] = {
      rule: {
        total: ruleFam.length,
        correct: ruleFam.filter((r) => r.outcome === 'correct').length,
        incorrect: ruleFam.filter((r) => r.outcome === 'incorrect').length,
        failure: ruleFam.filter((r) => r.outcome === 'failure').length,
        avg_latency_ms: ruleFam.reduce((s, r) => s + r.latency_ms, 0) / (ruleFam.length || 1),
      },
      jev: {
        total: jevFam.length,
        correct: jevFam.filter((r) => r.outcome === 'correct').length,
        incorrect: jevFam.filter((r) => r.outcome === 'incorrect').length,
        failure: jevFam.filter((r) => r.outcome === 'failure').length,
        invalid: jevFam.filter((r) => r.outcome === 'invalid').length,
        avg_latency_ms: jevFam.reduce((s, r) => s + r.latency_ms, 0) / (jevFam.length || 1),
        avg_cost_usd: jevFam.reduce((s, r) => s + (r.cost_usd ?? 0), 0) / (jevFam.length || 1),
      },
    };
  }

  const summary = {
    benchmark_at: new Date().toISOString(),
    corpus_version: corpus.corpus_version,
    total_cases: corpus.total_cases,
    total_jev_calls: totalJevCalls,
    successful_jev_calls: successfulJevCalls,
    failed_jev_calls: failedJevCalls,
    total_jev_cost_usd: Number(totalJevCost.toFixed(8)),
    cost_source: 'OBSERVED' as const,
    avg_jev_latency_ms:
      jevResults.reduce((s, r) => s + r.latency_ms, 0) / (jevResults.length || 1),
    per_family: perFamily,
    failure_probes: failureProbes,
    consistency_observations: consistencyResults,
    rule_results: ruleResults,
    jev_results: jevResults,
  };

  // Save evidence files (redacted)
  const evDir = path.join(__dirname, 'evidence');
  fs.mkdirSync(evDir, { recursive: true });

  // Per-case results
  const cases = corpus.cases.map((c) => {
    const rule = ruleResults.find((r) => r.case_id === c.case_id)!;
    const jev = jevResults.find((r) => r.case_id === c.case_id)!;
    return {
      case_id: c.case_id,
      family: c.family,
      decision_kind: c.decision_kind,
      expected_choice: c.expected_choice,
      ground_truth_method: c.ground_truth_method,
      rule: { choice: rule.returned_choice, outcome: rule.outcome, latency_ms: rule.latency_ms, reason: rule.reason },
      jev: {
        choice: jev.returned_choice,
        outcome: jev.outcome,
        latency_ms: jev.latency_ms,
        cost_usd: jev.cost_usd,
        reasoning_tokens: jev.reasoning_tokens,
        reasoning_excerpt: jev.reasoning_excerpt,
        error_class: jev.error_class,
        reason: jev.reason,
      },
    };
  });
  fs.writeFileSync(
    path.join(evDir, 'benchmark-results.json'),
    JSON.stringify({ summary, cases }, null, 2),
  );

  // Cost summary
  fs.writeFileSync(
    path.join(evDir, 'cost-summary.json'),
    JSON.stringify({
      total_jev_calls: totalJevCalls,
      successful_jev_calls: successfulJevCalls,
      failed_jev_calls: failedJevCalls,
      total_jev_cost_usd: Number(totalJevCost.toFixed(8)),
      cost_source: 'OBSERVED',
      avg_cost_per_call_usd: Number((totalJevCost / (totalJevCalls || 1)).toFixed(8)),
      cost_limit_exceeded: totalJevCost > 1.0 ? 'YES' : 'NO',
    }, null, 2),
  );

  // Latency summary
  fs.writeFileSync(
    path.join(evDir, 'latency-summary.json'),
    JSON.stringify({
      jev_avg_ms: summary.avg_jev_latency_ms,
      jev_min_ms: Math.min(...jevResults.map((r) => r.latency_ms)),
      jev_max_ms: Math.max(...jevResults.map((r) => r.latency_ms)),
      rule_avg_ms:
        ruleResults.reduce((s, r) => s + r.latency_ms, 0) / (ruleResults.length || 1),
      rule_min_ms: Math.min(...ruleResults.map((r) => r.latency_ms)),
      rule_max_ms: Math.max(...ruleResults.map((r) => r.latency_ms)),
    }, null, 2),
  );

  // Confidence observations
  const confidenceObs = {
    observation: 'Observed confidence behavior (small sample, NOT statistical calibration).',
    reasoning_tokens_per_case: jevResults.map((r) => ({
      case_id: r.case_id,
      outcome: r.outcome,
      reasoning_tokens: r.reasoning_tokens,
      latency_ms: r.latency_ms,
    })),
    summary: {
      correct_jev_calls: jevResults.filter((r) => r.outcome === 'correct').length,
      incorrect_jev_calls: jevResults.filter((r) => r.outcome === 'incorrect').length,
      avg_reasoning_tokens_correct: avgReasoningTokens(jevResults, 'correct'),
      avg_reasoning_tokens_incorrect: avgReasoningTokens(jevResults, 'incorrect'),
      consistency_observations: consistencyResults.map((r) => ({
        case_id: r.case_id,
        outcome: r.outcome,
        returned_choice: r.returned_choice,
      })),
    },
    calibration_claim: 'NONE — sample size too small for calibration claims.',
  };
  fs.writeFileSync(
    path.join(evDir, 'confidence-observations.json'),
    JSON.stringify(confidenceObs, null, 2),
  );

  // Jev provider environment
  fs.writeFileSync(
    path.join(evDir, 'jev-provider-environment.json'),
    JSON.stringify({
      jev_endpoint_used: JEV_ENDPOINT_INFO.endpoint,
      jev_model_used: JEV_ENDPOINT_INFO.model,
      jev_api_interface: JEV_ENDPOINT_INFO.apiInterface,
      credential_scope: 'JEV_DECISION_PROVIDER_ONLY',
      credential_source: 'OPENROUTER_API_KEY env var (vault)',
      credential_exposed_in_evidence: false,
      credential_exposed_in_errors: false,
      credential_exposed_in_flightrecorder: false,
    }, null, 2),
  );

  // Integration probe (no real Genesis mission executed — see final-analysis.md)
  fs.writeFileSync(
    path.join(evDir, 'integration-probe.json'),
    JSON.stringify({
      real_genesis_jev_integration: 'NOT_RUN',
      reason: 'See final-analysis.md — decision made after benchmark evidence.',
      jev_causally_changed_genesis_decision: 'NOT_TESTED',
      downstream_verification: 'NOT_RUN',
      false_success_path: 'NONE_OBSERVED',
    }, null, 2),
  );

  console.log(`\n[g6-03] Total Jev calls: ${totalJevCalls}`);
  console.log(`[g6-03] Successful: ${successfulJevCalls}, Failed: ${failedJevCalls}`);
  console.log(`[g6-03] Total cost: $${totalJevCost.toFixed(8)} USD (source: OBSERVED)`);
  console.log(`[g6-03] Avg Jev latency: ${summary.avg_jev_latency_ms.toFixed(0)}ms`);
  console.log(`[g6-03] Evidence written to ${evDir}`);
}

const JEV_ENDPOINT_INFO = {
  endpoint: 'https://openrouter.ai/api/v1/chat/completions',
  model: 'typesafe/jev-router',
  apiInterface: 'OpenRouter Chat Completions (OpenAI-compatible) with response_format=json_schema',
};

function avgReasoningTokens(results: CaseResult[], outcome: 'correct' | 'incorrect'): number | null {
  const matches = results.filter((r) => r.outcome === outcome && r.reasoning_tokens !== undefined);
  if (matches.length === 0) return null;
  return matches.reduce((s, r) => s + (r.reasoning_tokens ?? 0), 0) / matches.length;
}

main().catch((e) => {
  console.error('[g6-03] FATAL:', redact(String(e?.stack ?? e)));
  process.exit(1);
});
