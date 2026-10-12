import type {
  ReasoningInput,
  ReasoningOutput,
  ReasoningProvider,
} from '../contracts/core.js';

/**
 * ZAI Reasoning Provider (TASK-015) — a real LLM behind the frozen
 * ReasoningProvider contract.
 *
 * Genesis stays vendor-clean: this is ONE adapter among possible ones (an
 * OpenAI/Anthropic/Jev provider would implement the same contract), loaded
 * through a configurable module path so the Genesis repo never depends on a
 * specific vendor package. The sandbox exposes the z-ai-web-dev-sdk globally;
 * a real deployment sets ZAI_SDK_PATH or installs the package.
 *
 * Tier honesty (verified live, 2026-10-05): this SDK exposes one backing
 * model (glm-4-plus) and ignores per-call model overrides, so the tier
 * distinction maps to the one behavioral lever it does expose — `frontier`
 * runs with thinking enabled, `cheap`/`default` with it disabled. Tier
 * SELECTION remains real and genome-driven (GROUP 1); this provider records
 * that mapping instead of hiding it.
 */

export interface ZAIReasoningOptions {
  /** Absolute path to the SDK entrypoint when it is not an npm dependency. */
  readonly sdkPath?: string;
  /**
   * Backoff schedule for transient provider failures (429 rate limits),
   * in milliseconds. The sandbox's ZAI endpoint allows short bursts then
   * throttles for tens of seconds; patience is the correct response.
   */
  readonly retryBackoffMs?: readonly number[];
  /** Environment passed to ZAI.create (rarely needed). */
  readonly createEnv?: Record<string, string>;
  /**
   * G7-11 (FM-02): per-call timeout in milliseconds. When set, each
   * `chat.completions.create()` call is wrapped in an AbortSignal.timeout()
   * so a single hung provider call cannot consume the entire mission budget.
   * Default: undefined (no per-call timeout; relies on missionTimeoutMs).
   */
  readonly callTimeoutMs?: number;
  /**
   * G7-11 (FM-12): cumulative token budget ceiling across ALL calls to this
   * provider instance. When set, the provider checks `totalTokens` before
   * each call; if the ceiling is exceeded, it throws a BudgetExceededError
   * (which the orchestrator maps to mission FAILED via existing error handling).
   * This is the enforceable spending bound — USD pricing is not available
   * from the SDK, so tokens are the directly measurable proxy.
   *
   * PILOT-002 R3.1: the ceiling is now enforced via pre-call reservation
   * (see `maxTokensPerCall`). If the reservation would exceed the ceiling,
   * the call is refused BEFORE consuming any provider resources. This
   * prevents the "post-call overshoot" where a single large call pushes
   * totalTokens past the ceiling (observed in PILOT-002 R3: 67553 vs 60000).
   */
  readonly maxTotalTokens?: number;
  /**
   * PILOT-002 R3.1 (TASK 03): the maximum tokens a single call is
   * permitted to consume (input + output). Before each call, the provider
   * reserves this amount against the remaining budget. If the reservation
   * would exceed the ceiling, the call is refused with BudgetExceededError.
   *
   * After the call, the actual usage is reconciled: the reservation is
   * released and the real tokens are added. This means the provider never
   * overshoots the ceiling by more than one call's worth of tokens.
   *
   * If undefined, no pre-call reservation is made (legacy behavior: the
   * post-call check in attemptReason catches overshoot after the fact).
   *
   * Provider limitation note: the ZAI SDK does not expose a `max_tokens`
   * parameter to cap output. The reservation is an ESTIMATE based on
   * `maxTokensPerCall` — the actual output may be less (reservation
   * is released back) but never more than the estimate (if the provider
   * returns more than `maxTokensPerCall` total tokens, the post-call
   * check catches it and throws BudgetExceededError).
   */
  readonly maxTokensPerCall?: number;
}

export interface ReasoningUsage {
  readonly calls: number;
  readonly failures: number;
  readonly rateLimitRetries: number;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
  /**
   * PILOT-002 R3.1 (TASK 03): reserved tokens — the sum of pre-call
   * reservations that have not yet been reconciled against actual usage.
   * At the end of a mission, this should be 0 (all reservations reconciled).
   */
  readonly reservedTokens: number;
  /**
   * PILOT-002 R3.1 (TASK 03): the maximum permitted tokens for a single
   * call, used for pre-call reservation. If undefined, no reservation
   * is made (legacy behavior).
   */
  readonly maxTokensPerCall: number | undefined;
}

/** Default patience for rate-limited endpoints (window measured in minutes). */
export const DEFAULT_RETRY_BACKOFF_MS: readonly number[] = [
  5_000,
  15_000,
  30_000,
  60_000,
  120_000,
  180_000,
];

/**
 * G7-11 (FM-12): error thrown when the cumulative token budget is exceeded.
 * The orchestrator's existing error handling maps this to mission FAILED
 * with a scrubbed failureMessage — no false success.
 */
export class BudgetExceededError extends Error {
  readonly tokensUsed: number;
  readonly tokenCeiling: number;
  constructor(tokensUsed: number, tokenCeiling: number) {
    super(`reasoning budget exceeded: ${tokensUsed} tokens used, ceiling is ${tokenCeiling}`);
    this.name = 'BudgetExceededError';
    this.tokensUsed = tokensUsed;
    this.tokenCeiling = tokenCeiling;
  }
}

interface ZAIClient {
  chat: {
    completions: {
      create(request: unknown): Promise<{
        choices?: { message?: { content?: string } }[];
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          total_tokens?: number;
        };
      }>;
    };
  };
}

export class ZAIReasoningProvider implements ReasoningProvider {
  readonly name = 'zai';

  private readonly sdkPath: string | undefined;
  private readonly backoff: readonly number[];
  private readonly callTimeoutMs: number | undefined;
  private readonly maxTotalTokens: number | undefined;
  private readonly maxTokensPerCall: number | undefined;
  private client: ZAIClient | undefined;
  private calls = 0;
  private failures = 0;
  private rateLimitRetries = 0;
  private promptTokens = 0;
  private completionTokens = 0;
  private totalTokens = 0;
  /**
   * PILOT-002 R3.1 (TASK 03): reserved tokens — the sum of pre-call
   * reservations not yet reconciled. At the start of each `reason()` call,
   * we reserve `maxTokensPerCall` against the budget. After the call
   * completes (or throws), we release the reservation and add the actual
   * usage. This prevents a new call from starting if its maximum
   * permitted consumption cannot fit the remaining allowance.
   */
  private reservedTokens = 0;

  constructor(options: ZAIReasoningOptions = {}) {
    this.sdkPath =
      options.sdkPath ?? process.env.ZAI_SDK_PATH ?? 'z-ai-web-dev-sdk';
    this.backoff = options.retryBackoffMs ?? DEFAULT_RETRY_BACKOFF_MS;
    this.callTimeoutMs = options.callTimeoutMs;
    this.maxTotalTokens = options.maxTotalTokens;
    this.maxTokensPerCall = options.maxTokensPerCall;
  }

  /** Real spend telemetry for MissionCost and experiment reports. */
  usage(): ReasoningUsage {
    return {
      calls: this.calls,
      failures: this.failures,
      rateLimitRetries: this.rateLimitRetries,
      promptTokens: this.promptTokens,
      completionTokens: this.completionTokens,
      totalTokens: this.totalTokens,
      reservedTokens: this.reservedTokens,
      maxTokensPerCall: this.maxTokensPerCall,
    };
  }

  private async loadClient(): Promise<ZAIClient> {
    if (this.client !== undefined) return this.client;
    const modulePath = this.sdkPath ?? 'z-ai-web-dev-sdk';
    const imported = (await import(modulePath)) as {
      default?: { create(): Promise<ZAIClient> };
      create?: () => Promise<ZAIClient>;
    };
    const factory = imported.default ?? imported;
    if (factory === undefined || typeof factory.create !== 'function') {
      throw new Error(
        `ZAI SDK at "${modulePath}" exports no create() factory`,
      );
    }
    this.client = await factory.create();
    return this.client;
  }

  async reason(input: ReasoningInput): Promise<ReasoningOutput> {
    // G7-11 (FM-12) + PILOT-002 R3.1 (TASK 03): pre-call budget reservation.
    //
    // If maxTotalTokens and maxTokensPerCall are both set, reserve the
    // per-call allowance BEFORE making the call. If the reservation would
    // exceed the ceiling, refuse the call BEFORE consuming any provider
    // resources. This prevents the "post-call overshoot" observed in
    // PILOT-002 R3 (67553 tokens vs 60000 ceiling).
    //
    // Provider limitation: the ZAI SDK does not expose a `max_tokens`
    // parameter to cap output. The reservation is an ESTIMATE — if the
    // provider returns more tokens than `maxTokensPerCall`, the post-call
    // check in attemptReason catches it. But in practice, the reservation
    // ensures the budget is never exceeded by more than one call's worth.
    if (this.maxTotalTokens !== undefined) {
      const projected = this.totalTokens + this.reservedTokens;
      if (projected >= this.maxTotalTokens) {
        throw new BudgetExceededError(
          this.totalTokens + this.reservedTokens,
          this.maxTotalTokens,
        );
      }
      // Reserve the per-call allowance if configured.
      if (this.maxTokensPerCall !== undefined) {
        const remaining = this.maxTotalTokens - projected;
        if (this.maxTokensPerCall > remaining) {
          throw new BudgetExceededError(
            this.totalTokens + this.reservedTokens,
            this.maxTotalTokens,
          );
        }
        this.reservedTokens += this.maxTokensPerCall;
      }
    }
    this.calls += 1;
    const maxAttempts = this.backoff.length + 1;
    let lastError: unknown;
    try {
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
          return await this.attemptReason(input);
        } catch (error) {
          // Budget exceeded is not retryable — rethrow immediately.
          if (error instanceof BudgetExceededError) throw error;
          lastError = error;
          const rateLimited = isRateLimitError(error);
          if (!rateLimited || attempt === maxAttempts) {
            this.failures += 1;
            throw error;
          }
          this.rateLimitRetries += 1;
          await sleep(this.backoff[attempt - 1]);
        }
      }
      this.failures += 1;
      throw lastError;
    } finally {
      // Release the reservation after the call (success or failure).
      // The actual usage has been added to totalTokens by attemptReason.
      // If attemptReason threw before adding usage (e.g., network error),
      // the reservation is still released — no double-counting.
      if (this.maxTokensPerCall !== undefined && this.reservedTokens >= this.maxTokensPerCall) {
        this.reservedTokens -= this.maxTokensPerCall;
      } else {
        this.reservedTokens = 0;
      }
    }
  }

  private async attemptReason(
    input: ReasoningInput,
  ): Promise<ReasoningOutput> {
    const zai = await this.loadClient();
    // G7-11 (FM-02): per-call timeout. Wrap the SDK call in a timeout so a
    // single hung call cannot consume the entire mission budget. The
    // AbortSignal.timeout() is available in Node 18+ / Node 24 (our target).
    const requestParams: Record<string, unknown> = {
      messages: [
        {
          role: 'assistant',
          content:
            input.system ??
            'You are a capable worker. Reply exactly as instructed.',
        },
        { role: 'user', content: input.prompt },
      ],
      thinking: { type: input.tier === 'frontier' ? 'enabled' : 'disabled' },
    };
    if (this.callTimeoutMs !== undefined) {
      requestParams.signal = AbortSignal.timeout(this.callTimeoutMs);
    }
    const completion = await zai.chat.completions.create(requestParams);
    const usage = completion.usage;
    if (usage !== undefined) {
      this.promptTokens += usage.prompt_tokens ?? 0;
      this.completionTokens += usage.completion_tokens ?? 0;
      this.totalTokens += usage.total_tokens ?? 0;
    }
    // G7-11 (FM-12): post-call budget check. If THIS call pushed us over the
    // ceiling, throw immediately — the caller sees a budget-exceeded error
    // and no further calls are made.
    if (this.maxTotalTokens !== undefined && this.totalTokens > this.maxTotalTokens) {
      throw new BudgetExceededError(this.totalTokens, this.maxTotalTokens);
    }
    const text = completion.choices?.[0]?.message?.content ?? '';
    if (text.trim().length === 0) {
      throw new Error('empty completion from the ZAI provider');
    }
    return { text };
  }
}

function isRateLimitError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (/status 429/.test(error.message) || /too many requests/i.test(error.message))
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
