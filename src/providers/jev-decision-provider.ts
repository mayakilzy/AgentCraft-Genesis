import type {
  Decision,
  DecisionOutcome,
  DecisionProvider,
} from '../contracts/core.js';

/**
 * G6-03 — JevDecisionProvider (the Jev decision arm).
 *
 * A THIN ADAPTER over the OpenRouter Chat Completions API for the
 * `typesafe/jev-router` model only. It implements the existing
 * DecisionProvider contract — no contract redesign.
 *
 * CREDENTIAL BOUNDARY (Section 8 of the G6-03 mission):
 *   - Reads OPENROUTER_API_KEY from process.env at construction time.
 *   - The credential is NEVER serialized into the request body, NEVER
 *     logged, NEVER echoed in errors, NEVER returned in
 *     providerMetadata, NEVER recorded by FlightRecorder.
 *   - The adapter is structurally INCAPABLE of using a different model:
 *     the model id is a private readonly field with no setter, no
 *     constructor parameter to override it, and no public exposure.
 *   - OpenRouter is authorized for Jev ONLY. This adapter does not
 *     expose a generic chat-completion surface; it only exposes
 *     DecisionProvider.decide().
 *
 * FAILURE BEHAVIOR (Section 26):
 *   - Missing credential → throws JevCredentialMissingError (no HTTP call).
 *   - HTTP 401/403 → throws JevCredentialInvalidError (no secret echo).
 *   - HTTP non-200 (other) → throws JevProviderUnavailableError (status only).
 *   - Timeout (no response in 30s) → throws JevProviderTimeoutError.
 *   - Malformed JSON in response content → throws JevMalformedResponseError.
 *   - choice not in request.options → throws JevInvalidChoiceError.
 *
 * FALLBACK POLICY (Section 27):
 *   - NO hidden fallback. JevDecisionProvider does NOT silently use Rule
 *     or any other provider on failure. Failures propagate as thrown errors.
 *   - Production callers may catch and fall back EXPLICITLY, recording
 *     provider identity and fallback reason in FlightRecorder.
 *
 * OBSERVABILITY (Section 36):
 *   - providerMetadata preserves: reasoningTokens, promptTokens,
 *     completionTokens, costUsd (when available), latencyMs.
 *   - Reasoning text is preserved as providerMetadata.reasoningExcerpt
 *     (capped at 500 chars) — this is structured decision metadata, NOT
 *     chain-of-thought persistence. The model's reasoning is observable
 *     only as a token count + a brief excerpt for diagnostic purposes.
 */

const JEV_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const JEV_MODEL = 'typesafe/jev-router';
const JEV_TIMEOUT_MS = 30_000;
const JEV_MAX_TOKENS = 256;
const JEV_REASONING_EXCERPT_MAX = 500;

const JEV_SYSTEM_PROMPT =
  'You are a bounded decision provider inside the AgentCraft Genesis ' +
  'runtime. You will receive a decision request with a kind, a question, ' +
  'a fixed option set, and structured facts. You MUST choose exactly one ' +
  'option from the provided option set. Do not refuse. Do not invent ' +
  'options. Output strict JSON matching the schema.';

/**
 * Build a JSON Schema enforcing that the model's output is an object with
 * `choice` (one of the exact option strings) and `reason` (a short string).
 * The schema is constructed dynamically per call so the option set is the
 * authority — the model is structurally prevented from returning a choice
 * outside the requested set.
 */
function buildResponseSchema<T extends string>(options: readonly T[]): object {
  return {
    type: 'json_schema',
    json_schema: {
      name: 'genesis_decision',
      strict: true,
      schema: {
        type: 'object',
        properties: {
          choice: { type: 'string', enum: [...options] },
          reason: { type: 'string' },
        },
        required: ['choice', 'reason'],
        additionalProperties: false,
      },
    },
  };
}

function renderDecisionPrompt<T extends string>(request: Decision<T>): string {
  return [
    `Decision kind: ${request.kind}`,
    `Question: ${request.question}`,
    `Options: ${request.options.join(', ')}`,
    `Facts: ${JSON.stringify(request.facts)}`,
    '',
    'Choose exactly one option from the list above. Output JSON.',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Error taxonomy — all errors carry NON-SECRET messages only.
// ---------------------------------------------------------------------------

export class JevCredentialMissingError extends Error {
  constructor() {
    super(
      'JevDecisionProvider requires OPENROUTER_API_KEY in process.env. ' +
        'No credential was found. Set the env var or do not construct this provider.',
    );
    this.name = 'JevCredentialMissingError';
  }
}

export class JevCredentialInvalidError extends Error {
  constructor(readonly status: number) {
    super(
      `Jev credential was rejected by OpenRouter (HTTP ${status}). ` +
        'Verify OPENROUTER_API_KEY validity and authorization scope. ' +
        'No secret is echoed in this error.',
    );
    this.name = 'JevCredentialInvalidError';
  }
}

export class JevProviderUnavailableError extends Error {
  constructor(readonly status: number, readonly bodyExcerpt: string) {
    super(
      `Jev provider unavailable: HTTP ${status}. Body excerpt: ${bodyExcerpt}`,
    );
    this.name = 'JevProviderUnavailableError';
  }
}

export class JevProviderTimeoutError extends Error {
  constructor() {
    super(`Jev provider timed out after ${JEV_TIMEOUT_MS}ms`);
    this.name = 'JevProviderTimeoutError';
  }
}

export class JevMalformedResponseError extends Error {
  constructor(readonly reason: string, readonly contentExcerpt: string) {
    super(
      `Jev returned malformed response content: ${reason}. ` +
        `Content excerpt: ${contentExcerpt}`,
    );
    this.name = 'JevMalformedResponseError';
  }
}

export class JevInvalidChoiceError extends Error {
  constructor(readonly returned: string, readonly options: readonly string[]) {
    super(
      `Jev returned a choice "${returned}" not in the requested option set ` +
        `[${options.join(', ')}]. This is a contract violation; the Jev ` +
        'response was rejected. The provider did not silently fall back.',
    );
    this.name = 'JevInvalidChoiceError';
  }
}

// ---------------------------------------------------------------------------
// JevDecisionProvider
// ---------------------------------------------------------------------------

export interface JevProviderMetadata {
  readonly endpoint: typeof JEV_ENDPOINT;
  readonly model: typeof JEV_MODEL;
  readonly latencyMs: number;
  readonly promptTokens?: number;
  readonly completionTokens?: number;
  readonly reasoningTokens?: number;
  readonly totalTokens?: number;
  readonly costUsd?: number;
  /** Brief reasoning excerpt (capped) — for observability, not CoT persistence. */
  readonly reasoningExcerpt?: string;
}

export interface JevDecisionOutcome<T extends string = string>
  extends DecisionOutcome<T> {
  readonly provider: 'jev';
  readonly providerMetadata: JevProviderMetadata;
}

/**
 * Construction options. The model and endpoint are NOT configurable —
 * they are pinned to Jev-specific values. Passing an override is a
 * programming error.
 */
export interface JevDecisionProviderOptions {
  /**
   * Override the env var name read for the credential. Production callers
   * should leave this as the default 'OPENROUTER_API_KEY'. Used by tests
   * to verify the credential boundary without polluting process.env.
   */
  readonly envVarName?: string;
  /**
   * Test-only: inject a fetch implementation. Production callers leave this
   * undefined; the adapter uses global fetch. Tests inject a stub to verify
   * failure behavior without real HTTP.
   */
  readonly fetchImpl?: typeof fetch;
  /**
   * Test-only: inject a credential directly (bypassing process.env).
   * Production callers MUST NOT pass this; the adapter reads from env.
   */
  readonly testCredential?: string;
}

export class JevDecisionProvider implements DecisionProvider {
  readonly name = 'jev';
  /** Pinned — there is no setter, no constructor parameter, no escape hatch. */
  readonly model = JEV_MODEL;
  /** Pinned — same. */
  readonly endpoint = JEV_ENDPOINT;
  private readonly apiKey: string | undefined;
  private readonly envVarName: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: JevDecisionProviderOptions = {}) {
    this.envVarName = options.envVarName ?? 'OPENROUTER_API_KEY';
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    if (options.testCredential !== undefined) {
      this.apiKey = options.testCredential;
    } else {
      this.apiKey = process.env[this.envVarName];
    }
  }

  /**
   * Synchronously verifies the credential is present. Cheap to call.
   * Useful for early-fail in tests and for deployers who want to fail
   * fast at startup instead of on the first decision.
   */
  hasCredential(): boolean {
    return typeof this.apiKey === 'string' && this.apiKey.length > 0;
  }

  async decide<T extends string>(
    request: Decision<T>,
  ): Promise<JevDecisionOutcome<T>> {
    if (!this.hasCredential()) {
      throw new JevCredentialMissingError();
    }

    const body = {
      model: JEV_MODEL,
      messages: [
        { role: 'system', content: JEV_SYSTEM_PROMPT },
        { role: 'user', content: renderDecisionPrompt(request) },
      ],
      max_tokens: JEV_MAX_TOKENS,
      temperature: 0,
      response_format: buildResponseSchema(request.options),
    };

    const t0 = Date.now();
    let resp: Response;
    try {
      resp = await this.fetchWithTimeout(JEV_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
    } catch (e: unknown) {
      // Network/timeout error. FetchWithTimeout throws on timeout; other
      // network errors land here too. Do NOT echo the credential.
      if (e instanceof JevProviderTimeoutError) throw e;
      throw new JevProviderUnavailableError(0, String((e as Error)?.message ?? e).slice(0, 200));
    }
    const latencyMs = Date.now() - t0;

    if (resp.status === 401 || resp.status === 403) {
      throw new JevCredentialInvalidError(resp.status);
    }
    if (!resp.ok) {
      const text = await resp.text();
      throw new JevProviderUnavailableError(resp.status, text.slice(0, 200));
    }

    const parsed = (await resp.json()) as {
      choices?: Array<{
        message?: {
          content?: string | null;
          reasoning?: string | null;
        };
      }>;
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
        cost?: number;
        completion_tokens_details?: { reasoning_tokens?: number };
      };
    };

    const message = parsed.choices?.[0]?.message;
    const content = message?.content;
    if (typeof content !== 'string' || content.length === 0) {
      throw new JevMalformedResponseError(
        'message.content missing or non-string',
        JSON.stringify(message ?? null).slice(0, 200),
      );
    }

    let parsedContent: { choice?: unknown; reason?: unknown };
    try {
      parsedContent = JSON.parse(content) as { choice?: unknown; reason?: unknown };
    } catch (e) {
      throw new JevMalformedResponseError(
        `JSON.parse failed: ${(e as Error).message}`,
        content.slice(0, 200),
      );
    }
    if (typeof parsedContent.choice !== 'string') {
      throw new JevMalformedResponseError(
        'parsed.choice is not a string',
        JSON.stringify(parsedContent).slice(0, 200),
      );
    }
    // Verify the returned choice is in the requested option set.
    const matched = request.options.find(
      (o) => o === (parsedContent.choice as T),
    );
    if (matched === undefined) {
      throw new JevInvalidChoiceError(
        parsedContent.choice as string,
        request.options as readonly string[],
      );
    }

    const reasoning = message?.reasoning ?? undefined;
    const reasoningExcerpt =
      typeof reasoning === 'string' && reasoning.length > 0
        ? reasoning.slice(0, JEV_REASONING_EXCERPT_MAX)
        : undefined;

    const meta: JevProviderMetadata = {
      endpoint: JEV_ENDPOINT,
      model: JEV_MODEL,
      latencyMs,
      promptTokens: parsed.usage?.prompt_tokens,
      completionTokens: parsed.usage?.completion_tokens,
      totalTokens: parsed.usage?.total_tokens,
      reasoningTokens:
        parsed.usage?.completion_tokens_details?.reasoning_tokens,
      costUsd: parsed.usage?.cost,
      reasoningExcerpt,
    };

    return {
      choice: matched,
      reason:
        typeof parsedContent.reason === 'string' && parsedContent.reason.length > 0
          ? parsedContent.reason.slice(0, 500)
          : 'jev selected this option; no structured reason supplied',
      provider: 'jev',
      providerMetadata: meta,
    };
  }

  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
  ): Promise<Response> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), JEV_TIMEOUT_MS);
    try {
      return await this.fetchImpl(url, { ...init, signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
    }
  }
}
