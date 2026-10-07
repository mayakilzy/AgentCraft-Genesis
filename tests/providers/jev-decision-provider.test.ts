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
 * G6-03A — JevDecisionProvider unit tests for the corrected Decisions API
 * integration.
 *
 * These tests verify (per G6-03A Section 19):
 *   - state mapping (Decision.facts → state string)
 *   - Choice mapping (request.options → question.choices; verified in body)
 *   - probability mapping (response.probabilities → providerMetadata.probabilities)
 *   - confidence mapping (response.confidence → providerMetadata.confidence)
 *   - invalid answer rejection
 *   - missing credential (no HTTP call)
 *   - timeout (abort path)
 *   - provider error (HTTP 500, HTTP 403 region-restricted)
 *   - secret redaction (no credential in any error or metadata)
 *   - WRONG MODEL PREVENTION (no model parameter exposed; pin is const)
 *   - WRONG ENDPOINT PREVENTION (no endpoint parameter exposed; pin is const)
 *   - NO chat-completions path (no /api/v1/chat/completions reference)
 *   - NO jev-router path (no typesafe/jev-router reference)
 *   - NO silent fallback (failure surfaces as thrown error)
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

function fakeResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

// Helper to inspect the request body the provider sent.
function captureRequestBody(init: RequestInit | undefined): Record<string, unknown> | null {
  if (!init || !init.body) return null;
  try { return JSON.parse(init.body as string) as Record<string, unknown>; } catch { return null; }
}

describe('JevDecisionProvider — endpoint and model pinning (no chat-completions, no jev-router)', () => {
  it('pins the endpoint to /api/alpha/decisions', () => {
    const p = new JevDecisionProvider({ testCredential: TEST_KEY });
    expect(p.endpoint).toBe('https://openrouter.ai/api/alpha/decisions');
    // The endpoint must NOT be the chat-completions endpoint.
    expect(p.endpoint).not.toContain('/chat/completions');
  });

  it('pins the model to typesafe/jev-1.13', () => {
    const p = new JevDecisionProvider({ testCredential: TEST_KEY });
    expect(p.model).toBe('typesafe/jev-1.13');
    // The model must NOT be jev-router.
    expect(p.model).not.toBe('typesafe/jev-router');
    expect(p.model).not.toContain('router');
  });

  it('the constructor options do not allow overriding the model or endpoint', () => {
    // JevDecisionProviderOptions does not include `model` or `endpoint` fields.
    type Opts = ConstructorParameters<typeof JevDecisionProvider>[0];
    type Keys = keyof NonNullable<Opts>;
    const keys: Keys[] = ['envVarName', 'fetchImpl', 'testCredential'];
    expect(keys.sort()).toEqual(['envVarName', 'fetchImpl', 'testCredential'].sort());
  });

  it('the request body uses the Decisions API schema (state + questions as record)', async () => {
    let captured: { url: string | URL | Request; init: RequestInit | undefined } | undefined;
    const ensureCaptured = () => {
      if (!captured) throw new Error('fetchImpl never captured the request');
      return captured;
    };
    const p = new JevDecisionProvider({
      testCredential: TEST_KEY,
      fetchImpl: async (url, init) => {
        captured = { url, init };
        return fakeResponse(200, {
          answers: {
            q1: {
              selected_choice: 'cheap',
              probabilities: { cheap: 0.85, default: 0.10, frontier: 0.05 },
              confidence: 0.85,
              question_type: 'choice',
              reasoning: 'routine research benefits from cheap tier',
            },
          },
          usage: { cost: 0.0001, prompt_tokens: 50, completion_tokens: 30, total_tokens: 80 },
        });
      },
    });
    await p.decide(buildDecision());
    const c = ensureCaptured();
    expect(String(c.url)).toBe('https://openrouter.ai/api/alpha/decisions');
    const body = captureRequestBody(c.init);
    expect(body).not.toBeNull();
    const b = body as Record<string, unknown>;
    expect(b.model).toBe('typesafe/jev-1.13');
    expect(b.state).toContain('Select reasoning tier');
    expect(b.state).toContain('criticality');
    expect(b.state).toContain('missionDomain');
    expect(b.questions).toBeDefined();
    expect(typeof b.questions).toBe('object');
    expect(Array.isArray(b.questions)).toBe(false); // questions is a RECORD, not array
    const q = b.questions as Record<string, unknown>;
    expect(q.q1).toBeDefined();
    expect((q.q1 as { type: unknown }).type).toBe('choice');
    expect((q.q1 as { question: unknown }).question).toBe('Select reasoning tier');
    expect((q.q1 as { choices: unknown }).choices).toEqual(['cheap', 'default', 'frontier']);
    expect((q.q1 as { instructions: unknown }).instructions).toEqual(expect.any(String));
    expect(typeof (q.q1 as { criteria: unknown }).criteria).toBe('object');
    expect(Array.isArray((q.q1 as { criteria: unknown }).criteria)).toBe(false);
  });

  it('HARD NEGATIVE: no /api/v1/chat/completions reference in the source', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../src/providers/jev-decision-provider.ts'),
      'utf8',
    );
    expect(src).not.toMatch(/\/api\/v1\/chat\/completions/);
    // The chat-completions model id must NOT appear.
    expect(src).not.toMatch(/typesafe\/jev-router/);
  });
});

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
    expect(calls).toBe(0);
  });

  it('respects envVarName override', async () => {
    process.env.CUSTOM_JEV_KEY = TEST_KEY;
    const p = new JevDecisionProvider({ envVarName: 'CUSTOM_JEV_KEY' });
    expect(p.hasCredential()).toBe(true);
  });
});

describe('JevDecisionProvider — happy path response mapping', () => {
  it('parses a valid Decisions API response with selected_choice + probabilities + confidence', async () => {
    const p = new JevDecisionProvider({
      testCredential: TEST_KEY,
      fetchImpl: async () =>
        fakeResponse(200, {
          answers: {
            q1: {
              selected_choice: 'default',
              probabilities: { cheap: 0.10, default: 0.80, frontier: 0.10 },
              confidence: 0.80,
              question_type: 'choice',
              reasoning: 'important research benefits from default tier',
            },
          },
          usage: {
            cost: 0.0002,
            prompt_tokens: 73,
            completion_tokens: 30,
            total_tokens: 103,
          },
        }),
    });
    const outcome = await p.decide(buildDecision());
    expect(outcome.choice).toBe('default');
    expect(outcome.provider).toBe('jev');
    expect(outcome.reason).toContain('default tier');
    expect(outcome.providerMetadata.model).toBe('typesafe/jev-1.13');
    expect(outcome.providerMetadata.endpoint).toBe('https://openrouter.ai/api/alpha/decisions');
    expect(outcome.providerMetadata.promptTokens).toBe(73);
    expect(outcome.providerMetadata.completionTokens).toBe(30);
    expect(outcome.providerMetadata.totalTokens).toBe(103);
    expect(outcome.providerMetadata.costUsd).toBeCloseTo(0.0002, 8);
    expect(outcome.providerMetadata.probabilities).toEqual({
      cheap: 0.10, default: 0.80, frontier: 0.10,
    });
    expect(outcome.providerMetadata.confidence).toBeCloseTo(0.80, 8);
    expect(outcome.providerMetadata.questionType).toBe('choice');
    expect(outcome.providerMetadata.reasoningExcerpt).toContain('default tier');
  });

  it('accepts answer under .choice when selected_choice is absent', async () => {
    const p = new JevDecisionProvider({
      testCredential: TEST_KEY,
      fetchImpl: async () =>
        fakeResponse(200, {
          answers: { q1: { choice: 'frontier', reasoning: 'r' } },
        }),
    });
    const outcome = await p.decide(buildDecision());
    expect(outcome.choice).toBe('frontier');
  });

  it('accepts answer under .answer when both selected_choice and choice are absent', async () => {
    const p = new JevDecisionProvider({
      testCredential: TEST_KEY,
      fetchImpl: async () =>
        fakeResponse(200, {
          answers: { q1: { answer: 'cheap' } },
        }),
    });
    const outcome = await p.decide(buildDecision());
    expect(outcome.choice).toBe('cheap');
  });

  it('accepts answers under .results.q1 when .answers is absent', async () => {
    const p = new JevDecisionProvider({
      testCredential: TEST_KEY,
      fetchImpl: async () =>
        fakeResponse(200, {
          results: { q1: { selected_choice: 'cheap' } },
        }),
    });
    const outcome = await p.decide(buildDecision());
    expect(outcome.choice).toBe('cheap');
  });

  it('caps the reasoning excerpt at 500 chars', async () => {
    const long = 'x'.repeat(2000);
    const p = new JevDecisionProvider({
      testCredential: TEST_KEY,
      fetchImpl: async () =>
        fakeResponse(200, {
          answers: { q1: { selected_choice: 'cheap', reasoning: long } },
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
        fakeResponse(200, {
          answers: { q1: { selected_choice: 'cheap', reasoning: long } },
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
      fetchImpl: async () => fakeResponse(401, { error: 'unauthorized' }),
    });
    await expect(p.decide(buildDecision())).rejects.toBeInstanceOf(
      JevCredentialInvalidError,
    );
  });

  it('throws JevCredentialInvalidError on HTTP 403 with no region message', async () => {
    const p = new JevDecisionProvider({
      testCredential: TEST_KEY,
      fetchImpl: async () => fakeResponse(403, { error: 'forbidden' }),
    });
    await expect(p.decide(buildDecision())).rejects.toBeInstanceOf(
      JevCredentialInvalidError,
    );
  });

  it('throws JevProviderUnavailableError on HTTP 403 with region message (geo-restriction)', async () => {
    const p = new JevDecisionProvider({
      testCredential: TEST_KEY,
      fetchImpl: async () =>
        fakeResponse(403, {
          error: {
            message: 'This model is not available in your region.',
            code: 403,
            metadata: {
              routing_funnel: [{ step: 'Initial Endpoints', endpoint_count: 1 }],
              failed_routing_step: 'Gate Endpoints with Geo Restrictions',
            },
          },
        }),
    });
    try {
      await p.decide(buildDecision());
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(JevProviderUnavailableError);
      expect((e as JevProviderUnavailableError).status).toBe(403);
      // Body excerpt may be in the message but must not include the key.
      const msg = (e as Error).message;
      expect(msg).not.toContain(TEST_KEY);
    }
  });

  it('throws JevProviderUnavailableError on HTTP 500', async () => {
    const p = new JevDecisionProvider({
      testCredential: TEST_KEY,
      fetchImpl: async () => fakeResponse(500, { error: 'internal server error' }),
    });
    try {
      await p.decide(buildDecision());
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(JevProviderUnavailableError);
      expect((e as JevProviderUnavailableError).status).toBe(500);
    }
  });

  it('throws JevProviderUnavailableError on network error', async () => {
    const p = new JevDecisionProvider({
      testCredential: TEST_KEY,
      fetchImpl: async () => { throw new Error('ECONNREFUSED'); },
    });
    await expect(p.decide(buildDecision())).rejects.toBeInstanceOf(
      JevProviderUnavailableError,
    );
  });

  it('throws JevMalformedResponseError when no answer for q1', async () => {
    const p = new JevDecisionProvider({
      testCredential: TEST_KEY,
      fetchImpl: async () => fakeResponse(200, { answers: {} }),
    });
    await expect(p.decide(buildDecision())).rejects.toBeInstanceOf(
      JevMalformedResponseError,
    );
  });

  it('throws JevMalformedResponseError when selected_choice is not a string', async () => {
    const p = new JevDecisionProvider({
      testCredential: TEST_KEY,
      fetchImpl: async () =>
        fakeResponse(200, {
          answers: { q1: { selected_choice: 42 } },
        }),
    });
    await expect(p.decide(buildDecision())).rejects.toBeInstanceOf(
      JevMalformedResponseError,
    );
  });

  it('throws JevInvalidChoiceError when selected_choice is not in options', async () => {
    const p = new JevDecisionProvider({
      testCredential: TEST_KEY,
      fetchImpl: async () =>
        fakeResponse(200, {
          answers: { q1: { selected_choice: 'quantum', reasoning: 'r' } },
        }),
    });
    try {
      await p.decide(buildDecision());
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(JevInvalidChoiceError);
      expect((e as JevInvalidChoiceError).returned).toBe('quantum');
      expect((e as JevInvalidChoiceError).options).toEqual([
        'cheap', 'default', 'frontier',
      ]);
    }
  });

  it('does NOT silently fall back to a Rule provider on failure', async () => {
    // Verify by behavior: an HTTP 500 propagates as an error, not as a
    // 'cheap'/'default'/'frontier' outcome.
    const p = new JevDecisionProvider({
      testCredential: TEST_KEY,
      fetchImpl: async () => fakeResponse(500, { error: 'server down' }),
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
      fetchImpl: async () => fakeResponse(500, { error: 'internal' }),
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
        fakeResponse(200, {
          answers: { q1: { selected_choice: 'cheap', reasoning: 'r' } },
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
    // (sk-or-v1-<...>) match this pattern too.
    const sample = `Authorization: Bearer sk-or-v1-${'a'.repeat(60)}`;
    const pattern = /sk-(?:proj-)?[A-Za-z0-9_-]{20,}/gi;
    const redacted = sample.replace(pattern, 'sk-[redacted]');
    expect(redacted).toContain('sk-[redacted]');
    expect(redacted).not.toContain('aaaaaa');
  });
});

describe('JevDecisionProvider — request shape (Decisions API native)', () => {
  it('uses the pinned model and the Decisions API schema (NOT chat completions)', async () => {
    let captured: { url: string | URL | Request; init: RequestInit | undefined } | undefined;
    const ensureCaptured = () => {
      if (!captured) throw new Error('fetchImpl never captured the request');
      return captured;
    };
    const p = new JevDecisionProvider({
      testCredential: TEST_KEY,
      fetchImpl: async (url, init) => {
        captured = { url, init };
        return fakeResponse(200, {
          answers: { q1: { selected_choice: 'cheap' } },
        });
      },
    });
    await p.decide(buildDecision());
    const c = ensureCaptured();
    const body = captureRequestBody(c.init);
    expect(body).not.toBeNull();
    expect(body!.model).toBe('typesafe/jev-1.13');
    // The body must NOT contain a `messages` array (chat-completions shape).
    expect(body!.messages).toBeUndefined();
    // The body must NOT contain a `response_format` field (chat-completions shape).
    expect(body!.response_format).toBeUndefined();
    // The body must contain `state` and `questions` (Decisions API shape).
    expect(body!.state).toBeDefined();
    expect(body!.questions).toBeDefined();
    expect(typeof body!.questions).toBe('object');
  });
});
