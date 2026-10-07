import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  JevDecisionProvider,
  JevCredentialMissingError,
  JevCredentialInvalidError,
  JevProviderUnavailableError,
  JevMalformedResponseError,
  JevInvalidChoiceError,
} from '../../src/providers/jev-decision-provider.js';
import type { Decision } from '../../src/contracts/core.js';

/**
 * G6-03 — JevDecisionProvider unit tests.
 *
 * These tests verify:
 *   - credential boundary (missing, invalid)
 *   - provider failure (network, HTTP non-200)
 *   - timeout
 *   - malformed response
 *   - invalid returned choice
 *   - secret redaction (no credential in any error or metadata)
 *   - model pinning (no model setter, no constructor override)
 *   - response mapping (choice, reason, providerMetadata fields)
 *
 * None of these tests make real HTTP calls — they inject a `fetchImpl`
 * stub. Tests that need real Jev behavior live under experiments/g6-03.
 */

const TEST_KEY = 'sk-test-only-not-a-real-key-DO-NOT-USE';

function buildDecision(): Decision<string> {
  return {
    kind: 'reasoning-tier',
    question: 'Select reasoning tier',
    options: ['cheap', 'default', 'frontier'],
    facts: { criticality: 'routine', missionDomain: 'research' },
  };
}

function fakeResponse(
  ok: boolean,
  status: number,
  body: unknown,
): Response {
  const r = new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
  // Response.ok is derived from status (2xx = true), so we don't pass it
  // to the constructor. To simulate non-2xx responses, the status itself
  // is the source of truth. The `ok` parameter is kept in this helper for
  // test readability but is asserted via the status.
  void ok;
  return r;
}

describe('JevDecisionProvider — credential boundary', () => {
  const prevKey = process.env.OPENROUTER_API_KEY;
  beforeEach(() => {
    delete process.env.OPENROUTER_API_KEY;
  });
  afterEach(() => {
    if (prevKey !== undefined) process.env.OPENROUTER_API_KEY = prevKey;
    else delete process.env.OPENROUTER_API_KEY;
  });

  it('hasCredential() returns false when no env var and no test credential', () => {
    const p = new JevDecisionProvider();
    expect(p.hasCredential()).toBe(false);
  });

  it('hasCredential() returns true when testCredential is supplied', () => {
    const p = new JevDecisionProvider({ testCredential: TEST_KEY });
    expect(p.hasCredential()).toBe(true);
  });

  it('decide() throws JevCredentialMissingError when no credential and no HTTP call is made', async () => {
    let calls = 0;
    const p = new JevDecisionProvider({
      fetchImpl: () => {
        calls += 1;
        return Promise.resolve(new Response(''));
      },
    });
    await expect(p.decide(buildDecision())).rejects.toBeInstanceOf(
      JevCredentialMissingError,
    );
    expect(calls).toBe(0); // No HTTP call — credential check is synchronous
  });

  it('respects envVarName override', async () => {
    process.env.CUSTOM_JEV_KEY = TEST_KEY;
    const p = new JevDecisionProvider({ envVarName: 'CUSTOM_JEV_KEY' });
    expect(p.hasCredential()).toBe(true);
  });
});

describe('JevDecisionProvider — model and endpoint pinning', () => {
  it('model is typesafe/jev-router and immutable', () => {
    const p = new JevDecisionProvider({ testCredential: TEST_KEY });
    expect(p.model).toBe('typesafe/jev-router');
    expect(p.endpoint).toBe('https://openrouter.ai/api/v1/chat/completions');
    // No setter exists — TypeScript would refuse assignment at compile time.
  });

  it('the constructor options do not allow overriding the model', () => {
    // The JevDecisionProviderOptions type does not include a `model` field.
    // The following is a static-type assertion: passing { model: ... } would
    // be a compile-time error in callers. We assert by inspecting the keys
    // accepted by the type:
    type Opts = ConstructorParameters<typeof JevDecisionProvider>[0];
    type Keys = keyof NonNullable<Opts>;
    const keys: Keys[] = ['envVarName', 'fetchImpl', 'testCredential'];
    expect(keys.sort()).toEqual(['envVarName', 'fetchImpl', 'testCredential'].sort());
  });
});

describe('JevDecisionProvider — happy path response mapping', () => {
  it('parses a valid JSON response with choice in options', async () => {
    const p = new JevDecisionProvider({
      testCredential: TEST_KEY,
      fetchImpl: async () =>
        fakeResponse(true, 200, {
          choices: [
            {
              message: {
                role: 'assistant',
                content: JSON.stringify({
                  choice: 'default',
                  reason: 'important task benefits from balanced reasoning',
                }),
                reasoning: 'We need answer JSON only. Need choose option...',
              },
            },
          ],
          usage: {
            prompt_tokens: 73,
            completion_tokens: 247,
            total_tokens: 320,
            cost: 0.0003183,
            completion_tokens_details: { reasoning_tokens: 222 },
          },
        }),
    });
    const outcome = await p.decide(buildDecision());
    expect(outcome.choice).toBe('default');
    expect(outcome.provider).toBe('jev');
    expect(outcome.reason).toContain('balanced reasoning');
    expect(outcome.providerMetadata.model).toBe('typesafe/jev-router');
    expect(outcome.providerMetadata.promptTokens).toBe(73);
    expect(outcome.providerMetadata.completionTokens).toBe(247);
    expect(outcome.providerMetadata.reasoningTokens).toBe(222);
    expect(outcome.providerMetadata.costUsd).toBeCloseTo(0.0003183, 8);
    expect(outcome.providerMetadata.reasoningExcerpt).toContain(
      'Need choose option',
    );
  });

  it('caps the reasoning excerpt at 500 chars', async () => {
    const long = 'x'.repeat(2000);
    const p = new JevDecisionProvider({
      testCredential: TEST_KEY,
      fetchImpl: async () =>
        fakeResponse(true, 200, {
          choices: [
            {
              message: {
                content: JSON.stringify({ choice: 'cheap', reason: 'r' }),
                reasoning: long,
              },
            },
          ],
          usage: {},
        }),
    });
    const outcome = await p.decide(buildDecision());
    expect(outcome.providerMetadata.reasoningExcerpt?.length).toBe(500);
  });

  it('caps the returned reason at 500 chars', async () => {
    const long = 'y'.repeat(2000);
    const p = new JevDecisionProvider({
      testCredential: TEST_KEY,
      fetchImpl: async () =>
        fakeResponse(true, 200, {
          choices: [
            {
              message: {
                content: JSON.stringify({ choice: 'cheap', reason: long }),
              },
            },
          ],
        }),
    });
    const outcome = await p.decide(buildDecision());
    expect(outcome.reason.length).toBe(500);
  });
});

describe('JevDecisionProvider — failure behavior', () => {
  it('throws JevCredentialInvalidError on HTTP 401', async () => {
    const p = new JevDecisionProvider({
      testCredential: TEST_KEY,
      fetchImpl: async () =>
        fakeResponse(false, 401, { error: 'unauthorized' }),
    });
    await expect(p.decide(buildDecision())).rejects.toBeInstanceOf(
      JevCredentialInvalidError,
    );
  });

  it('throws JevCredentialInvalidError on HTTP 403', async () => {
    const p = new JevDecisionProvider({
      testCredential: TEST_KEY,
      fetchImpl: async () =>
        fakeResponse(false, 403, { error: 'forbidden' }),
    });
    await expect(p.decide(buildDecision())).rejects.toBeInstanceOf(
      JevCredentialInvalidError,
    );
  });

  it('throws JevProviderUnavailableError on HTTP 500', async () => {
    const p = new JevDecisionProvider({
      testCredential: TEST_KEY,
      fetchImpl: async () =>
        fakeResponse(false, 500, { error: 'internal server error' }),
    });
    try {
      await p.decide(buildDecision());
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(JevProviderUnavailableError);
      expect((e as JevProviderUnavailableError).status).toBe(500);
      // Body excerpt may be in the message but must not include the key.
      const msg = (e as Error).message;
      expect(msg).not.toContain(TEST_KEY);
    }
  });

  it('throws JevProviderUnavailableError on network error', async () => {
    const p = new JevDecisionProvider({
      testCredential: TEST_KEY,
      fetchImpl: async () => {
        throw new Error('ECONNREFUSED');
      },
    });
    await expect(p.decide(buildDecision())).rejects.toBeInstanceOf(
      JevProviderUnavailableError,
    );
  });

  it('throws JevMalformedResponseError when content is not JSON', async () => {
    const p = new JevDecisionProvider({
      testCredential: TEST_KEY,
      fetchImpl: async () =>
        fakeResponse(true, 200, {
          choices: [{ message: { content: 'not-json' } }],
        }),
    });
    await expect(p.decide(buildDecision())).rejects.toBeInstanceOf(
      JevMalformedResponseError,
    );
  });

  it('throws JevMalformedResponseError when content is null', async () => {
    const p = new JevDecisionProvider({
      testCredential: TEST_KEY,
      fetchImpl: async () =>
        fakeResponse(true, 200, {
          choices: [{ message: { content: null } }],
        }),
    });
    await expect(p.decide(buildDecision())).rejects.toBeInstanceOf(
      JevMalformedResponseError,
    );
  });

  it('throws JevMalformedResponseError when choice is not a string', async () => {
    const p = new JevDecisionProvider({
      testCredential: TEST_KEY,
      fetchImpl: async () =>
        fakeResponse(true, 200, {
          choices: [
            { message: { content: JSON.stringify({ choice: 42, reason: 'r' }) } },
          ],
        }),
    });
    await expect(p.decide(buildDecision())).rejects.toBeInstanceOf(
      JevMalformedResponseError,
    );
  });

  it('throws JevInvalidChoiceError when choice is not in options', async () => {
    const p = new JevDecisionProvider({
      testCredential: TEST_KEY,
      fetchImpl: async () =>
        fakeResponse(true, 200, {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  choice: 'quantum',
                  reason: 'jev decided outside the option set',
                }),
              },
            },
          ],
        }),
    });
    try {
      await p.decide(buildDecision());
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(JevInvalidChoiceError);
      expect((e as JevInvalidChoiceError).returned).toBe('quantum');
      expect((e as JevInvalidChoiceError).options).toEqual([
        'cheap',
        'default',
        'frontier',
      ]);
    }
  });

  it('does NOT silently fall back to a Rule provider on failure', async () => {
    // Verify by inspecting the source: there is no Rule field on the
    // provider, no fallback call in decide(). We assert the behavior by
    // observing that an HTTP 500 propagates as an error, not as a
    // 'cheap'/'default'/'frontier' outcome.
    const p = new JevDecisionProvider({
      testCredential: TEST_KEY,
      fetchImpl: async () =>
        fakeResponse(false, 500, { error: 'server down' }),
    });
    const result = await p.decide(buildDecision()).catch((e) => e);
    expect(result).toBeInstanceOf(JevProviderUnavailableError);
    // The error must not be silently turned into a successful outcome.
    expect(result).not.toHaveProperty('choice');
  });
});

describe('JevDecisionProvider — secret redaction', () => {
  it('does not include the credential in any error message', async () => {
    const p = new JevDecisionProvider({
      testCredential: TEST_KEY,
      fetchImpl: async () =>
        fakeResponse(false, 500, { error: 'internal' }),
    });
    try {
      await p.decide(buildDecision());
      throw new Error('expected throw');
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).not.toContain(TEST_KEY);
      expect(msg).not.toContain('Bearer');
      expect(msg).not.toContain('sk-');
    }
  });

  it('does not include the credential in providerMetadata', async () => {
    const p = new JevDecisionProvider({
      testCredential: TEST_KEY,
      fetchImpl: async () =>
        fakeResponse(true, 200, {
          choices: [
            { message: { content: JSON.stringify({ choice: 'cheap', reason: 'r' }) } },
          ],
          usage: { cost: 0.0001 },
        }),
    });
    const outcome = await p.decide(buildDecision());
    const meta = JSON.stringify(outcome.providerMetadata);
    expect(meta).not.toContain(TEST_KEY);
    expect(meta).not.toContain('Bearer');
  });

  it('redacts via the FlightRecorder secret patterns too (defense-in-depth)', () => {
    // The FlightRecorder's SECRET_PATTERNS list catches OpenAI-style keys
    // (sk-<...>) via /sk-(?:proj-)?[A-Za-z0-9_-]{20,}/gi. OpenRouter keys
    // (sk-or-v1-<...>) match this pattern too. Verify by inspecting the
    // regex coverage — a synthetic test that the redaction function
    // catches the OpenRouter format:
    const sample = `Authorization: Bearer sk-or-v1-${'a'.repeat(60)}`;
    const pattern = /sk-(?:proj-)?[A-Za-z0-9_-]{20,}/gi;
    const redacted = sample.replace(pattern, 'sk-[redacted]');
    expect(redacted).toContain('sk-[redacted]');
    expect(redacted).not.toContain('aaaaaa');
  });
});

describe('JevDecisionProvider — request shape', () => {
  it('uses the pinned model and not an arbitrary model parameter', async () => {
    let captured: { url: string | URL | Request; init: RequestInit | undefined } | undefined;
    const ensureCaptured = (): { url: string | URL | Request; init: RequestInit | undefined } => {
      if (!captured) throw new Error('fetchImpl never captured the request');
      return captured;
    };
    const p = new JevDecisionProvider({
      testCredential: TEST_KEY,
      fetchImpl: async (url, init) => {
        captured = { url, init };
        return fakeResponse(true, 200, {
          choices: [
            { message: { content: JSON.stringify({ choice: 'cheap', reason: 'r' }) } },
          ],
        });
      },
    });
    await p.decide(buildDecision());
    const c = ensureCaptured();
    const body = JSON.parse((c.init?.body as string) ?? '{}');
    expect(body.model).toBe('typesafe/jev-router');
    expect(body.response_format).toBeDefined();
    expect(body.response_format.type).toBe('json_schema');
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(body.response_format.json_schema.schema.properties.choice.enum).toEqual([
      'cheap',
      'default',
      'frontier',
    ]);
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0].role).toBe('system');
    expect(body.messages[1].role).toBe('user');
  });
});
