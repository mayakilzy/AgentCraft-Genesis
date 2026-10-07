/**
 * G6-03A — PROBE B: Failure Truthfulness
 *
 * Verify that JevDecisionProvider failure modes are LOUD — no silent fallback
 * to Rule, GLM, or any other provider. This probe uses injected fetch stubs
 * (no real HTTP) for the failure modes, plus the real OPENROUTER_API_KEY
 * env var (if set) to test the missing-credential path.
 *
 * Per G6-03A Section 14 PROBE B:
 *   "Prove: Genesis does not claim Jev success; no silent Rule fallback;
 *    no silent GLM fallback; no fake decision; failure/fallback semantics
 *    are observable."
 *
 * Required: FAILURE_TRUTHFULNESS_PROBE = PASS
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  JevDecisionProvider,
} from '../../src/providers/jev-decision-provider.js';
import type { Decision } from '../../src/contracts/core.js';




function fakeResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const SAMPLE_DECISION: Decision<string> = {
  kind: 'reasoning-tier',
  question: 'Select reasoning tier',
  options: ['cheap', 'default', 'frontier'],
  facts: { criticality: 'routine', missionDomain: 'research' },
};

interface ProbeResult {
  probe_id: string;
  description: string;
  expected_behavior: string;
  actual_error_class: string | null;
  fallback_invoked: boolean;
  outcome: 'pass' | 'fail';
  detail: string;
}

async function runProbes(): Promise<ProbeResult[]> {
  const results: ProbeResult[] = [];

  // F1: Missing credential throws JevCredentialMissingError, NO HTTP call
  {
    let httpCalls = 0;
    const p = new JevDecisionProvider({
      fetchImpl: () => { httpCalls += 1; return Promise.resolve(new Response('')); },
      envVarName: '__JEV_PROBE_F1_UNSET_ENV_VAR__',
    });
    let actualError: unknown = null;
    let returnedChoice: string | undefined;
    try {
      const r = await p.decide(SAMPLE_DECISION);
      returnedChoice = r.choice;
    } catch (e) {
      actualError = e;
    }
    const cls = actualError instanceof Error ? actualError.name : 'NO_ERROR';
    results.push({
      probe_id: 'F1',
      description: 'Missing credential throws JevCredentialMissingError; NO HTTP call made; NO silent fallback to Rule/GLM',
      expected_behavior: 'throws JevCredentialMissingError; httpCalls === 0; no returned choice',
      actual_error_class: cls,
      fallback_invoked: returnedChoice !== undefined,
      outcome: cls === 'JevCredentialMissingError' && httpCalls === 0 && returnedChoice === undefined ? 'pass' : 'fail',
      detail: `actual_error_class=${cls}, httpCalls=${httpCalls}, returnedChoice=${returnedChoice ?? '<none>'}`,
    });
  }

  // F2: HTTP 401 throws JevCredentialInvalidError
  {
    const p = new JevDecisionProvider({
      testCredential: 'sk-test-only',
      fetchImpl: async () => fakeResponse(401, { error: 'unauthorized' }),
    });
    let actualError: unknown = null;
    let returnedChoice: string | undefined;
    try {
      const r = await p.decide(SAMPLE_DECISION);
      returnedChoice = r.choice;
    } catch (e) { actualError = e; }
    const cls = actualError instanceof Error ? actualError.name : 'NO_ERROR';
    results.push({
      probe_id: 'F2',
      description: 'HTTP 401 throws JevCredentialInvalidError; no silent fallback',
      expected_behavior: 'throws JevCredentialInvalidError; no returned choice',
      actual_error_class: cls,
      fallback_invoked: returnedChoice !== undefined,
      outcome: cls === 'JevCredentialInvalidError' && returnedChoice === undefined ? 'pass' : 'fail',
      detail: `actual_error_class=${cls}, returnedChoice=${returnedChoice ?? '<none>'}`,
    });
  }

  // F3: HTTP 403 with region message throws JevProviderUnavailableError (geo-restriction case)
  {
    const p = new JevDecisionProvider({
      testCredential: 'sk-test-only',
      fetchImpl: async () => fakeResponse(403, {
        error: { message: 'This model is not available in your region.', code: 403 },
      }),
    });
    let actualError: unknown = null;
    let returnedChoice: string | undefined;
    try {
      const r = await p.decide(SAMPLE_DECISION);
      returnedChoice = r.choice;
    } catch (e) { actualError = e; }
    const cls = actualError instanceof Error ? actualError.name : 'NO_ERROR';
    results.push({
      probe_id: 'F3',
      description: 'HTTP 403 (geo-restricted) throws JevProviderUnavailableError; no silent fallback',
      expected_behavior: 'throws JevProviderUnavailableError; no returned choice',
      actual_error_class: cls,
      fallback_invoked: returnedChoice !== undefined,
      outcome: cls === 'JevProviderUnavailableError' && returnedChoice === undefined ? 'pass' : 'fail',
      detail: `actual_error_class=${cls}, returnedChoice=${returnedChoice ?? '<none>'}`,
    });
  }

  // F4: HTTP 500 throws JevProviderUnavailableError
  {
    const p = new JevDecisionProvider({
      testCredential: 'sk-test-only',
      fetchImpl: async () => fakeResponse(500, { error: 'internal server error' }),
    });
    let actualError: unknown = null;
    let returnedChoice: string | undefined;
    try {
      const r = await p.decide(SAMPLE_DECISION);
      returnedChoice = r.choice;
    } catch (e) { actualError = e; }
    const cls = actualError instanceof Error ? actualError.name : 'NO_ERROR';
    results.push({
      probe_id: 'F4',
      description: 'HTTP 500 throws JevProviderUnavailableError; no silent fallback',
      expected_behavior: 'throws JevProviderUnavailableError; no returned choice',
      actual_error_class: cls,
      fallback_invoked: returnedChoice !== undefined,
      outcome: cls === 'JevProviderUnavailableError' && returnedChoice === undefined ? 'pass' : 'fail',
      detail: `actual_error_class=${cls}, returnedChoice=${returnedChoice ?? '<none>'}`,
    });
  }

  // F5: Network error throws JevProviderUnavailableError
  {
    const p = new JevDecisionProvider({
      testCredential: 'sk-test-only',
      fetchImpl: async () => { throw new Error('ECONNREFUSED'); },
    });
    let actualError: unknown = null;
    let returnedChoice: string | undefined;
    try {
      const r = await p.decide(SAMPLE_DECISION);
      returnedChoice = r.choice;
    } catch (e) { actualError = e; }
    const cls = actualError instanceof Error ? actualError.name : 'NO_ERROR';
    results.push({
      probe_id: 'F5',
      description: 'Network error throws JevProviderUnavailableError; no silent fallback',
      expected_behavior: 'throws JevProviderUnavailableError; no returned choice',
      actual_error_class: cls,
      fallback_invoked: returnedChoice !== undefined,
      outcome: cls === 'JevProviderUnavailableError' && returnedChoice === undefined ? 'pass' : 'fail',
      detail: `actual_error_class=${cls}, returnedChoice=${returnedChoice ?? '<none>'}`,
    });
  }

  // F6: Malformed response throws JevMalformedResponseError
  {
    const p = new JevDecisionProvider({
      testCredential: 'sk-test-only',
      fetchImpl: async () => fakeResponse(200, { answers: {} }),
    });
    let actualError: unknown = null;
    let returnedChoice: string | undefined;
    try {
      const r = await p.decide(SAMPLE_DECISION);
      returnedChoice = r.choice;
    } catch (e) { actualError = e; }
    const cls = actualError instanceof Error ? actualError.name : 'NO_ERROR';
    results.push({
      probe_id: 'F6',
      description: 'Malformed response throws JevMalformedResponseError; no silent fallback',
      expected_behavior: 'throws JevMalformedResponseError; no returned choice',
      actual_error_class: cls,
      fallback_invoked: returnedChoice !== undefined,
      outcome: cls === 'JevMalformedResponseError' && returnedChoice === undefined ? 'pass' : 'fail',
      detail: `actual_error_class=${cls}, returnedChoice=${returnedChoice ?? '<none>'}`,
    });
  }

  // F7: Invalid choice throws JevInvalidChoiceError
  {
    const p = new JevDecisionProvider({
      testCredential: 'sk-test-only',
      fetchImpl: async () => fakeResponse(200, {
        answers: { q1: { selected_choice: 'quantum', reasoning: 'r' } },
      }),
    });
    let actualError: unknown = null;
    let returnedChoice: string | undefined;
    try {
      const r = await p.decide(SAMPLE_DECISION);
      returnedChoice = r.choice;
    } catch (e) { actualError = e; }
    const cls = actualError instanceof Error ? actualError.name : 'NO_ERROR';
    results.push({
      probe_id: 'F7',
      description: 'Invalid choice throws JevInvalidChoiceError; no silent fallback to a valid choice',
      expected_behavior: 'throws JevInvalidChoiceError; no returned choice',
      actual_error_class: cls,
      fallback_invoked: returnedChoice !== undefined,
      outcome: cls === 'JevInvalidChoiceError' && returnedChoice === undefined ? 'pass' : 'fail',
      detail: `actual_error_class=${cls}, returnedChoice=${returnedChoice ?? '<none>'}`,
    });
  }

  return results;
}

(async () => {
  const probes = await runProbes();
  const evDir = path.join(new URL(".", import.meta.url).pathname, "evidence");
  fs.mkdirSync(evDir, { recursive: true });
  const summary = {
    probe_at: new Date().toISOString(),
    total_probes: probes.length,
    passed: probes.filter(p => p.outcome === 'pass').length,
    failed: probes.filter(p => p.outcome === 'fail').length,
    failure_truthfulness_probe_overall: probes.every(p => p.outcome === 'pass') ? 'PASS' : 'FAIL',
    probes,
  };
  fs.writeFileSync(
    path.join(evDir, 'failure-truthfulness-probe.json'),
    JSON.stringify(summary, null, 2),
  );
  for (const p of probes) {
    console.log(`  [F] ${p.probe_id} -> ${p.outcome} (${p.detail.slice(0, 100)})`);
  }
  console.log(`\n[failure-truthfulness] ${summary.passed}/${summary.total_probes} probes pass; overall: ${summary.failure_truthfulness_probe_overall}`);
})();
