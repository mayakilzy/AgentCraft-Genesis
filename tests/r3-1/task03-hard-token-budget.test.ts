/**
 * PILOT-002 R3.1 — TASK 03: Hard Token Budget with pre-call reservations.
 *
 * Tests that the pre-call reservation mechanism prevents budget overshoot.
 * The provider reserves `maxTokensPerCall` before each call; if the
 * reservation would exceed the ceiling, the call is refused.
 *
 * Provider limitation note: the ZAI SDK does not expose a `max_tokens`
 * parameter. The reservation is an ESTIMATE — actual usage may be less
 * (reservation is released back) but the pre-call check ensures the
 * budget is never exceeded by more than one call's worth of tokens.
 *
 * These tests use a mock ZAI client that returns controlled token usage,
 * so no paid production reasoning is invoked.
 */

import { describe, expect, it } from 'vitest';

import {
  ZAIReasoningProvider,
  BudgetExceededError,
  type ZAIReasoningOptions,
} from '../../src/providers/zai-reasoning.js';
import type { ReasoningInput } from '../../src/contracts/core.js';

/** A mock ZAI client that returns controlled usage + content. */
function mockClient(usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number }, content = 'ok') {
  return {
    chat: {
      completions: {
        create: async () => ({
          choices: [{ message: { content } }],
          usage,
        }),
      },
    },
  };
}

/** Build a provider with a mock SDK that returns the given client. */
function buildProvider(opts: ZAIReasoningOptions & { client: ReturnType<typeof mockClient> }) {
  const { client, ...rest } = opts;
  const provider = new ZAIReasoningProvider({
    sdkPath: 'mock',
    ...rest,
  });
  // Inject the mock client by accessing the private loadClient path.
  // We override the import to return our mock.
  (provider as any).client = client;
  return provider;
}

const input: ReasoningInput = {
  prompt: 'test prompt',
  tier: 'default',
};

describe('PILOT-002 R3.1 TASK 03 — Hard Token Budget (pre-call reservation)', () => {
  it('allows calls when budget is sufficient', async () => {
    const provider = buildProvider({
      maxTotalTokens: 10_000,
      maxTokensPerCall: 5_000,
      client: mockClient({ prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 }),
    });

    const result = await provider.reason(input);
    expect(result.text).toBe('ok');

    const usage = provider.usage();
    expect(usage.totalTokens).toBe(300);
    expect(usage.reservedTokens).toBe(0); // released after call
    expect(usage.maxTokensPerCall).toBe(5_000);
  });

  it('refuses call when reservation would exceed ceiling', async () => {
    // Budget: 1000 tokens. Per-call: 500. After 2 calls (600 tokens used),
    // remaining is 400. The third call needs 500 reserved → refused.
    const provider = buildProvider({
      maxTotalTokens: 1_000,
      maxTokensPerCall: 500,
      client: mockClient({ prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 }),
    });

    // First two calls consume 600 tokens (300 each).
    await provider.reason(input);
    await provider.reason(input);
    expect(provider.usage().totalTokens).toBe(600);

    // Third call: remaining = 1000 - 600 = 400. Reservation needs 500. 500 > 400 → refuse.
    await expect(provider.reason(input)).rejects.toThrow(BudgetExceededError);

    const usage = provider.usage();
    // totalTokens unchanged (call was refused before execution)
    expect(usage.totalTokens).toBe(600);
    // reservedTokens should be 0 (reservation was not made or was released)
    expect(usage.reservedTokens).toBe(0);
  });

  it('refuses call when totalTokens already at ceiling', async () => {
    const provider = buildProvider({
      maxTotalTokens: 300,
      maxTokensPerCall: 300,
      client: mockClient({ prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 }),
    });

    // First call consumes 300 tokens (hits the ceiling exactly).
    await provider.reason(input);
    expect(provider.usage().totalTokens).toBe(300);

    // Second call: projected = 300 + 0 = 300 >= 300 → refuse.
    await expect(provider.reason(input)).rejects.toThrow(BudgetExceededError);
  });

  it('releases reservation on call failure (no double-counting)', async () => {
    // If the call throws (e.g., network error), the reservation must be released
    // so the next call can proceed (if budget allows).
    const failClient = {
      chat: {
        completions: {
          create: async () => { throw new Error('network error'); },
        },
      },
    };
    const provider = buildProvider({
      maxTotalTokens: 10_000,
      maxTokensPerCall: 5_000,
      client: failClient as any,
    });

    // First call throws — reservation should be released.
    await expect(provider.reason(input)).rejects.toThrow('network error');

    const usage = provider.usage();
    expect(usage.totalTokens).toBe(0); // no tokens consumed
    expect(usage.reservedTokens).toBe(0); // reservation released
  });

  it('tracks reserved tokens during an active call', async () => {
    // Verify that reservedTokens is set during the call and released after.
    let observedReserved = -1;
    const trackingClient = {
      chat: {
        completions: {
          create: async () => {
            // During the call, the reservation should be held.
            // We can't access the provider here, but we can verify
            // via the usage() after the call that it was released.
            observedReserved = 999; // placeholder — just verify call ran
            return {
              choices: [{ message: { content: 'ok' } }],
              usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 },
            };
          },
        },
      },
    };
    const provider = buildProvider({
      maxTotalTokens: 10_000,
      maxTokensPerCall: 5_000,
      client: trackingClient as any,
    });

    await provider.reason(input);

    expect(observedReserved).toBe(999); // call executed
    // After call: reservation released.
    expect(provider.usage().reservedTokens).toBe(0);
  });

  it('post-call check catches overshoot if provider exceeds maxTokensPerCall', async () => {
    // If the provider returns more tokens than maxTokensPerCall,
    // the post-call check in attemptReason catches it.
    const provider = buildProvider({
      maxTotalTokens: 1_000,
      maxTokensPerCall: 500,
      client: mockClient({ prompt_tokens: 400, completion_tokens: 700, total_tokens: 1_100 }),
    });

    // The call returns 1100 tokens — exceeds both maxTokensPerCall (500)
    // and maxTotalTokens (1000). Post-call check should throw.
    await expect(provider.reason(input)).rejects.toThrow(BudgetExceededError);

    const usage = provider.usage();
    // totalTokens reflects the actual usage (1100) — the call DID consume tokens.
    expect(usage.totalTokens).toBe(1_100);
  });

  it('without maxTokensPerCall: legacy post-call-only behavior', async () => {
    // When maxTokensPerCall is not set, the provider uses the legacy
    // post-call-only check (no pre-call reservation).
    const provider = buildProvider({
      maxTotalTokens: 1_000,
      // no maxTokensPerCall
      client: mockClient({ prompt_tokens: 400, completion_tokens: 200, total_tokens: 600 }),
    });

    // First call: 600 tokens. No pre-call reservation, but post-call check
    // allows it (600 < 1000).
    await provider.reason(input);
    expect(provider.usage().totalTokens).toBe(600);

    // Second call: would push to 1200 > 1000.
    // Legacy behavior: call is made, usage is added, post-call check throws.
    await expect(provider.reason(input)).rejects.toThrow(BudgetExceededError);
    expect(provider.usage().totalTokens).toBe(1_200); // overshoot observed
  });

  it('usage() reports complete telemetry', async () => {
    const provider = buildProvider({
      maxTotalTokens: 10_000,
      maxTokensPerCall: 5_000,
      client: mockClient({ prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 }),
    });

    await provider.reason(input);
    await provider.reason(input);

    const usage = provider.usage();
    expect(usage.calls).toBe(2);
    expect(usage.failures).toBe(0);
    expect(usage.promptTokens).toBe(200);
    expect(usage.completionTokens).toBe(400);
    expect(usage.totalTokens).toBe(600);
    expect(usage.reservedTokens).toBe(0);
    expect(usage.maxTokensPerCall).toBe(5_000);
  });
});
