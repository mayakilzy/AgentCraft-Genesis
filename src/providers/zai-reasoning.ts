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
}

export interface ReasoningUsage {
  readonly calls: number;
  readonly failures: number;
  readonly rateLimitRetries: number;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
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
  private client: ZAIClient | undefined;
  private calls = 0;
  private failures = 0;
  private rateLimitRetries = 0;
  private promptTokens = 0;
  private completionTokens = 0;
  private totalTokens = 0;

  constructor(options: ZAIReasoningOptions = {}) {
    this.sdkPath =
      options.sdkPath ?? process.env.ZAI_SDK_PATH ?? 'z-ai-web-dev-sdk';
    this.backoff = options.retryBackoffMs ?? DEFAULT_RETRY_BACKOFF_MS;
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
    this.calls += 1;
    const maxAttempts = this.backoff.length + 1;
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await this.attemptReason(input);
      } catch (error) {
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
  }

  private async attemptReason(
    input: ReasoningInput,
  ): Promise<ReasoningOutput> {
    const zai = await this.loadClient();
    const completion = await zai.chat.completions.create({
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
    });
    const usage = completion.usage;
    if (usage !== undefined) {
      this.promptTokens += usage.prompt_tokens ?? 0;
      this.completionTokens += usage.completion_tokens ?? 0;
      this.totalTokens += usage.total_tokens ?? 0;
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
