/**
 * G7-11 — Provider Hardening tests (FM-02 timeout + FM-12 budget).
 *
 * Verifies the ZAIReasoningProvider additions:
 *   1. callTimeoutMs: per-call timeout wraps the SDK call.
 *   2. maxTotalTokens: cumulative token budget ceiling is enforced.
 *   3. BudgetExceededError: thrown when ceiling exceeded; not retryable.
 *
 * These tests use a MOCK ZAI client (no real SDK, no paid calls) to verify
 * the provider's enforcement logic deterministically.
 */
import { describe, it, expect } from 'vitest';
import {
  ZAIReasoningProvider,
  BudgetExceededError,
  type ZAIReasoningOptions,
} from '../../src/providers/zai-reasoning.js';
import type { ReasoningInput } from '../../src/contracts/core.js';

/**
 * Build a mock ZAI client that returns controlled responses.
 * This avoids the real SDK (which is not installed in this environment).
 */
function buildMockClient(opts: {
  readonly content?: string;
  readonly usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  readonly delayMs?: number;
  readonly error?: Error;
}): {
  readonly client: {
    chat: {
      completions: {
        create(request: unknown): Promise<{
          choices?: { message?: { content?: string } }[];
          usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
        }>;
      };
    };
  };
  readonly createCalls: { readonly request: unknown }[];
} {
  const createCalls: { request: unknown }[] = [];
  const client = {
    chat: {
      completions: {
        async create(request: unknown): Promise<{
          choices?: { message?: { content?: string } }[];
          usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
        }> {
          createCalls.push({ request });
          if (opts.delayMs !== undefined) {
            await new Promise((r) => setTimeout(r, opts.delayMs));
          }
          if (opts.error !== undefined) {
            throw opts.error;
          }
          return {
            choices: [{ message: { content: opts.content ?? 'mock response' } }],
            usage: opts.usage,
          };
        },
      },
    },
  };
  return { client, createCalls };
}

/**
 * Build a ZAIReasoningProvider with a mock client injected via prototype
 * override. This avoids the real SDK import path.
 */
function buildProviderWithMock(
  options: ZAIReasoningOptions,
  mockClient: ReturnType<typeof buildMockClient>['client'],
): ZAIReasoningProvider {
  const provider = new ZAIReasoningProvider(options);
  // Inject the mock client by overriding the private loadClient method.
  // This is test-only — production code uses the real SDK.
  (provider as unknown as { client: unknown }).client = mockClient;
  return provider;
}

const MOCK_INPUT: ReasoningInput = {
  prompt: 'test prompt',
  system: 'test system',
  tier: 'default',
};

describe('G7-11 FM-02 — Provider per-call timeout', () => {
  it('TO-01: callTimeoutMs wraps the SDK call with a timeout signal', async () => {
    // The mock client delays 500ms. With callTimeoutMs=50, the AbortSignal
    // should be passed in the request params. We verify the signal is present.
    const { client, createCalls } = buildMockClient({ content: 'ok', delayMs: 0 });
    const provider = buildProviderWithMock({ callTimeoutMs: 50 }, client);

    await provider.reason(MOCK_INPUT);

    expect(createCalls.length).toBe(1);
    const request = createCalls[0].request as Record<string, unknown>;
    // The signal must be present when callTimeoutMs is set.
    expect(request.signal).toBeDefined();
    // AbortSignal.timeout returns an AbortSignal instance.
    expect(request.signal).toBeInstanceOf(AbortSignal);
  });

  it('TO-02: no callTimeoutMs → no signal in request', async () => {
    const { client, createCalls } = buildMockClient({ content: 'ok' });
    const provider = buildProviderWithMock({}, client);

    await provider.reason(MOCK_INPUT);

    const request = createCalls[0].request as Record<string, unknown>;
    expect(request.signal).toBeUndefined();
  });
});

describe('G7-11 FM-12 — Provider token budget enforcement', () => {
  it('BG-01: maxTotalTokens allows calls under the ceiling', async () => {
    const { client } = buildMockClient({
      content: 'ok',
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
    });
    const provider = buildProviderWithMock({ maxTotalTokens: 100 }, client);

    const result = await provider.reason(MOCK_INPUT);
    expect(result.text).toBe('ok');

    const usage = provider.usage();
    expect(usage.totalTokens).toBe(30);
    expect(usage.calls).toBe(1);
  });

  it('BG-02: maxTotalTokens throws BudgetExceededError when ceiling exceeded (post-call)', async () => {
    // First call uses 80 tokens; ceiling is 100. Second call adds 30 → 110 > 100.
    const { client } = buildMockClient({
      content: 'ok',
      usage: { prompt_tokens: 40, completion_tokens: 40, total_tokens: 80 },
    });
    const provider = buildProviderWithMock({ maxTotalTokens: 100 }, client);

    // First call succeeds (80 ≤ 100).
    await provider.reason(MOCK_INPUT);
    expect(provider.usage().totalTokens).toBe(80);

    // Second call: mock returns 80 again, but cumulative would be 160 > 100.
    // The post-call check throws BudgetExceededError.
    await expect(provider.reason(MOCK_INPUT)).rejects.toThrow(BudgetExceededError);
    expect(provider.usage().totalTokens).toBe(160);
    // BudgetExceededError is an enforcement decision, NOT a provider failure
    // (the provider responded successfully). The failures counter tracks
    // actual provider errors (auth, timeout, etc.) — it stays at 0.
    expect(provider.usage().failures).toBe(0);
  });

  it('BG-03: maxTotalTokens refuses call BEFORE consuming resources when ceiling already reached', async () => {
    const { client, createCalls } = buildMockClient({
      content: 'ok',
      usage: { prompt_tokens: 50, completion_tokens: 50, total_tokens: 100 },
    });
    const provider = buildProviderWithMock({ maxTotalTokens: 100 }, client);

    // First call uses exactly 100 tokens (== ceiling, allowed).
    await provider.reason(MOCK_INPUT);
    expect(provider.usage().totalTokens).toBe(100);
    expect(createCalls.length).toBe(1);

    // Second call: pre-call check sees totalTokens (100) >= ceiling (100) → refuse.
    await expect(provider.reason(MOCK_INPUT)).rejects.toThrow(BudgetExceededError);
    // No additional SDK call was made — the provider refused before calling.
    expect(createCalls.length).toBe(1);
    expect(provider.usage().calls).toBe(1); // calls counter only increments if pre-check passes
  });

  it('BG-04: BudgetExceededError is not retryable (no backoff)', async () => {
    // Even with retry backoff configured, a BudgetExceededError should
    // propagate immediately — no retry attempts.
    const { client, createCalls } = buildMockClient({
      content: 'ok',
      usage: { prompt_tokens: 60, completion_tokens: 60, total_tokens: 120 },
    });
    const provider = buildProviderWithMock(
      { maxTotalTokens: 100, retryBackoffMs: [100] },
      client,
    );

    // First call: 120 > 100 → post-call check throws BudgetExceededError.
    // The retry loop should NOT retry (BudgetExceededError is not a 429).
    await expect(provider.reason(MOCK_INPUT)).rejects.toThrow(BudgetExceededError);
    // Only ONE SDK call was made — no retry.
    expect(createCalls.length).toBe(1);
    expect(provider.usage().rateLimitRetries).toBe(0);
  });

  it('BG-05: BudgetExceededError carries token usage details', async () => {
    const { client } = buildMockClient({
      content: 'ok',
      usage: { prompt_tokens: 60, completion_tokens: 60, total_tokens: 120 },
    });
    const provider = buildProviderWithMock({ maxTotalTokens: 100 }, client);

    try {
      await provider.reason(MOCK_INPUT);
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(BudgetExceededError);
      const err = e as BudgetExceededError;
      expect(err.tokensUsed).toBe(120);
      expect(err.tokenCeiling).toBe(100);
      expect(err.name).toBe('BudgetExceededError');
    }
  });

  it('BG-06: no maxTotalTokens → no budget enforcement (backward compatible)', async () => {
    const { client } = buildMockClient({
      content: 'ok',
      usage: { prompt_tokens: 1000, completion_tokens: 1000, total_tokens: 2000 },
    });
    const provider = buildProviderWithMock({}, client);

    // Multiple calls, high token count — no error (no ceiling set).
    await provider.reason(MOCK_INPUT);
    await provider.reason(MOCK_INPUT);
    await provider.reason(MOCK_INPUT);

    expect(provider.usage().totalTokens).toBe(6000);
    expect(provider.usage().calls).toBe(3);
    expect(provider.usage().failures).toBe(0);
  });
});
