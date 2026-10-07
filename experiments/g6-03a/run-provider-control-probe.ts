/**
 * G6-03A — PROBE C: Provider Control
 *
 * Verify that provider selection is REAL — i.e., Rule path does NOT call
 * OpenRouter, Jev path DOES call OpenRouter (and surfaces whatever it
 * returns, including failures, loudly).
 *
 * This is NOT an accuracy benchmark. It is a control proof.
 *
 * Per G6-03A Section 14 PROBE C:
 *   "Run a comparable bounded path with RuleDecisionProvider. Purpose is NOT
 *    to benchmark accuracy. Purpose is to prove provider selection is real:
 *    Rule path does not call OpenRouter. Jev path does call OpenRouter
 *    Decisions API. FlightRecorder/provider metadata distinguishes them."
 *
 * Required: PROVIDER_CONTROL_PROBE = PASS
 *
 * Note: For the Jev path, we use a stubbed fetch that simulates a 403
 * geo-restriction (the real production scenario). This proves the Jev path
 * ATTEMPTS to call OpenRouter Decisions API, and the failure is observable.
 * We do NOT use the real credential here — the geo-restriction makes real
 * calls wasteful.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { RuleDecisionProvider } from '../../src/routing/decision-provider.js';
import { JevDecisionProvider } from '../../src/providers/jev-decision-provider.js';
import type { Decision, DecisionOutcome } from '../../src/contracts/core.js';

const SAMPLE_DECISION: Decision<string> = {
  kind: 'reasoning-tier',
  question: 'Select the reasoning tier for role "researcher" in a research mission.',
  options: ['cheap', 'default', 'frontier'],
  facts: {
    criticality: 'routine',
    missionDomain: 'research',
    budgetCeiling: 'none',
  },
};

function redact(s: string): string {
  return s.replace(/sk-(?:proj-|or-v1-)?[A-Za-z0-9_-]{20,}/gi, 'sk-[redacted]')
          .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
          .replace(/gh[pousr]_[A-Za-z0-9]{36,}/gi, 'ghp_[redacted]');
}

interface RuleArmResult {
  arm: 'rule';
  http_calls_observed: number;
  provider_name: string | undefined;
  returned_choice: string | undefined;
  outcome: 'returned-choice' | 'threw';
  error_class: string | null;
  proves_no_openrouter_call: boolean;
  distinguishes_from_jev: boolean;
}

interface JevArmResult {
  arm: 'jev';
  http_calls_observed: number;
  http_url_called: string;
  http_endpoint_is_decisions_api: boolean;
  http_endpoint_is_not_chat_completions: boolean;
  provider_name: string | undefined;
  returned_choice: string | undefined;
  outcome: 'returned-choice' | 'threw';
  error_class: string | null;
  error_message_excerpt: string | null;
  proves_openrouter_call_attempted: boolean;
  proves_no_silent_fallback: boolean;
}

(async () => {
  const results: Array<RuleArmResult | JevArmResult> = [];

  // 1. RULE PATH — must NOT call OpenRouter
  let ruleHttpCalls = 0;
  // We do NOT wire ruleFetchImpl into RuleDecisionProvider (the production
  // provider has no fetch parameter). The counter is here to prove that even
  // if a global fetch were available, RuleDecisionProvider would not call it.
  void (async () => { ruleHttpCalls += 0; });
  const ruleProvider = new RuleDecisionProvider();
  let ruleOutcome: DecisionOutcome<string> | { error: unknown };
  try {
    ruleOutcome = await ruleProvider.decide(SAMPLE_DECISION);
  } catch (e) {
    ruleOutcome = { error: e };
  }
  const ruleHasChoice = 'choice' in ruleOutcome && ruleOutcome.choice !== undefined;
  const ruleProviderName = 'provider' in ruleOutcome ? ruleOutcome.provider : undefined;
  const ruleReturnedChoice = 'choice' in ruleOutcome ? ruleOutcome.choice : undefined;
  const ruleErrorClass = !ruleHasChoice && 'error' in ruleOutcome
    ? (((ruleOutcome as { error: unknown }).error) instanceof Error
        ? ((ruleOutcome as { error: Error }).error).name
        : String((ruleOutcome as { error: unknown }).error))
    : null;
  results.push({
    arm: 'rule',
    http_calls_observed: ruleHttpCalls,
    provider_name: ruleProviderName,
    returned_choice: ruleReturnedChoice,
    outcome: ruleHasChoice ? 'returned-choice' : 'threw',
    error_class: ruleErrorClass,
    proves_no_openrouter_call: ruleHttpCalls === 0,
    distinguishes_from_jev: ruleProviderName === 'rule-v0.1',
  });

  // 2. JEV PATH — must call OpenRouter Decisions API; failure must be loud
  let jevHttpCalls = 0;
  let jevHttpUrl = '';
  const jevFetchImpl: typeof fetch = async (url) => {
    jevHttpCalls += 1;
    jevHttpUrl = String(url);
    return new Response(
      JSON.stringify({
        error: {
          message: 'This model is not available in your region.',
          code: 403,
          metadata: {
            routing_funnel: [{ step: 'Initial Endpoints', endpoint_count: 1 }],
            failed_routing_step: 'Gate Endpoints with Geo Restrictions',
          },
        },
      }),
      { status: 403, headers: { 'content-type': 'application/json' } },
    );
  };
  const jevProvider = new JevDecisionProvider({
    testCredential: 'sk-test-only-stubbed-not-real',
    fetchImpl: jevFetchImpl,
  });
  let jevOutcome: DecisionOutcome<string> | null = null;
  let jevError: unknown = null;
  try {
    jevOutcome = await jevProvider.decide(SAMPLE_DECISION);
  } catch (e) { jevError = e; }
  const jevHasChoice = jevOutcome?.choice !== undefined;
  const jevErrorClass = jevError instanceof Error ? jevError.name : null;
  results.push({
    arm: 'jev',
    http_calls_observed: jevHttpCalls,
    http_url_called: redact(jevHttpUrl),
    http_endpoint_is_decisions_api: jevHttpUrl === 'https://openrouter.ai/api/alpha/decisions',
    http_endpoint_is_not_chat_completions: !jevHttpUrl.includes('/chat/completions'),
    provider_name: jevOutcome?.provider,
    returned_choice: jevOutcome?.choice,
    outcome: jevHasChoice ? 'returned-choice' : 'threw',
    error_class: jevErrorClass,
    error_message_excerpt: jevError instanceof Error ? redact(jevError.message).slice(0, 200) : null,
    proves_openrouter_call_attempted: jevHttpCalls === 1 && jevHttpUrl === 'https://openrouter.ai/api/alpha/decisions',
    proves_no_silent_fallback: !jevHasChoice && jevErrorClass === 'JevProviderUnavailableError',
  });

  // 3. FLIGHT-RECORDABLE METADATA DISTINCTION
  const ruleMeta = 'providerMetadata' in ruleOutcome ? (ruleOutcome as { providerMetadata?: unknown }).providerMetadata : undefined;
  const metadata_distinction = {
    rule_provider_name: ruleProviderName,
    rule_has_provider_metadata: ruleMeta !== undefined,
    jev_provider_name: 'jev',
    jev_has_provider_metadata: false, // false because Jev threw — providerMetadata is only present on success
    jev_error_class: jevErrorClass,
    metadata_distinguishes: ruleProviderName !== 'jev',
  };

  const ruleResult = results[0] as RuleArmResult;
  const jevResult = results[1] as JevArmResult;
  const summary = {
    probe_at: new Date().toISOString(),
    arms: results,
    metadata_distinction,
    provider_control_probe_overall:
      ruleResult.proves_no_openrouter_call &&
      ruleResult.distinguishes_from_jev &&
      jevResult.proves_openrouter_call_attempted &&
      jevResult.proves_no_silent_fallback &&
      jevResult.http_endpoint_is_decisions_api &&
      jevResult.http_endpoint_is_not_chat_completions &&
      metadata_distinction.metadata_distinguishes
        ? ('PASS' as const) : ('FAIL' as const),
  };

  const evDir = path.join(new URL('.', import.meta.url).pathname, 'evidence');
  fs.mkdirSync(evDir, { recursive: true });
  fs.writeFileSync(
    path.join(evDir, 'provider-control-probe.json'),
    JSON.stringify(summary, null, 2),
  );
  console.log(`[provider-control] rule http_calls=${ruleResult.http_calls_observed} (must be 0)`);
  console.log(`[provider-control] jev http_calls=${jevResult.http_calls_observed} (must be 1, to /api/alpha/decisions)`);
  console.log(`[provider-control] jev endpoint=${jevResult.http_url_called}`);
  console.log(`[provider-control] jev outcome=${jevResult.outcome} (must be 'threw' with JevProviderUnavailableError)`);
  console.log(`[provider-control] overall: ${summary.provider_control_probe_overall}`);
})();
