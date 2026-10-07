import type {
  Decision,
  DecisionOutcome,
  DecisionProvider,
} from '../contracts/core.js';

/**
 * G6-03A — JevDecisionProvider CORRECTED for the OpenRouter Decisions API.
 *
 * G6-03 used the chat-completions endpoint with the chat-router variant of
 * the Jev model. G6-03A architecture review determined that this is a
 * DIFFERENT product from the Jev Decision Model. The corrected provider
 * targets the Decisions API exclusively:
 *
 *   JEV_DECISIONS_ENDPOINT = https://openrouter.ai/api/alpha/decisions
 *   JEV_DECISION_MODEL     = typesafe/jev-1.13
 *
 * The Decisions API uses native Jev semantics: state + typed questions →
 * typed answers / probabilities. The previous chat-completions approach
 * simulated Jev by asking a generative model to output JSON — that is NOT
 * equivalent to using the real Decisions API.
 *
 * CREDENTIAL BOUNDARY (G6-03A Section 2):
 *   - The supplied OpenRouter credential is authorized EXCLUSIVELY for:
 *       OpenRouter Decisions API + TypeSafe Jev Decision Model
 *   - It MUST NOT be used for:
 *       the chat-router variant of the Jev model, the chat-completions
 *       endpoint, any generative model, DeepSeek, GPT, Claude, Gemini,
 *       Qwen, Llama, worker reasoning, verification reasoning,
 *       development reasoning, fallback reasoning.
 *   - GLM remains the development reasoning mechanism.
 *   - This adapter is structurally incapable of using a different model:
 *     the model id is a private readonly const with no setter, no
 *     constructor parameter, no public exposure.
 *   - The adapter exposes ONLY DecisionProvider.decide() — there is no
 *     chat() / complete() / messages() surface, so the credential cannot
 *     be repurposed for chat completions through this adapter.
 *
 * FAILURE BEHAVIOR (G6-03A Section 19):
 *   - Missing credential → throws JevCredentialMissingError (no HTTP call).
 *   - HTTP 401/403 → throws JevCredentialInvalidError (no secret echo).
 *     NOTE: HTTP 403 with "This model is not available in your region"
 *     is a geo-restriction, NOT an invalid credential. We surface it as
 *     JevProviderUnavailableError so callers can distinguish
 *     "credential bad" (JevCredentialInvalidError) from "provider
 *     unavailable / geo-restricted" (JevProviderUnavailableError).
 *   - HTTP non-200 (other) → throws JevProviderUnavailableError.
 *   - Timeout (no response in 30s) → throws JevProviderTimeoutError.
 *   - Malformed JSON response → throws JevMalformedResponseError.
 *   - Returned answer not in question's choices → throws JevInvalidChoiceError.
 *
 * FALLBACK POLICY (G6-03A Section 14 PROBE B):
 *   - NO hidden fallback. JevDecisionProvider does NOT silently use Rule,
 *     GLM, or any other provider on failure. Failures propagate as thrown
 *     errors. Production callers may catch and fall back EXPLICITLY,
 *     recording provider identity and fallback reason in FlightRecorder.
 *
 * OBSERVABILITY (G6-03A Section 15):
 *   - providerMetadata preserves: decisions API endpoint, model, latencyMs,
 *     promptTokens/completionTokens (if returned), costUsd (if returned),
 *     probabilities (per-option, if returned), confidence (if returned),
 *     questionType (echoed), reasoningExcerpt (capped).
 *   - Reasoning text is preserved as providerMetadata.reasoningExcerpt
 *     (capped at 500 chars) — this is structured decision metadata, NOT
 *     chain-of-thought persistence.
 */

const JEV_DECISIONS_ENDPOINT = 'https://openrouter.ai/api/alpha/decisions';
const JEV_DECISION_MODEL = 'typesafe/jev-1.13';
const JEV_TIMEOUT_MS = 30_000;
const JEV_REASONING_EXCERPT_MAX = 500;

const JEV_SYSTEM_INSTRUCTIONS =
  'You are the bounded decision provider inside the AgentCraft Genesis ' +
  'runtime. You will receive a state description and one or more typed ' +
  'questions. For each question, choose exactly one of the provided ' +
  'choices. Do not refuse. Do not invent choices outside the provided set.';

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
        'Verify OPENROUTER_API_KEY validity and authorization scope ' +
        '(must be JEV-DECISIONS-API-ONLY). No secret is echoed.',
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
      `Jev returned an answer "${returned}" not in the requested choice set ` +
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
  /** Pinned — there is no setter, no constructor parameter, no escape hatch. */
  readonly endpoint: typeof JEV_DECISIONS_ENDPOINT;
  /** Pinned — same. */
  readonly model: typeof JEV_DECISION_MODEL;
  readonly latencyMs: number;
  readonly promptTokens?: number;
  readonly completionTokens?: number;
  readonly totalTokens?: number;
  readonly costUsd?: number;
  /** Per-option probability distribution, if returned by the Decisions API. */
  readonly probabilities?: Readonly<Record<string, number>>;
  /** Confidence in the selected answer, if returned. */
  readonly confidence?: number;
  /** The question type echo (choice / boolean / score). */
  readonly questionType?: string;
  /** Brief reasoning excerpt (capped) — for observability, not CoT persistence. */
  readonly reasoningExcerpt?: string;
  /** Geo-restriction flag — set when HTTP 403 indicates region block. */
  readonly geoRestricted?: boolean;
}

export interface JevDecisionOutcome<T extends string = string>
  extends DecisionOutcome<T> {
  readonly provider: 'jev';
  readonly providerMetadata: JevProviderMetadata;
}

/**
 * Construction options. The model and endpoint are NOT configurable —
 * they are pinned to Jev-decision-specific values. Passing an override
 * is a programming error.
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

interface JevDecisionQuestion {
  type: string;
  question: string;
  choices: readonly string[];
  instructions: string;
  criteria: Readonly<Record<string, string>>;
}

interface JevDecisionRequestBody {
  model: typeof JEV_DECISION_MODEL;
  state: string;
  questions: Readonly<Record<string, JevDecisionQuestion>>;
}

interface JevDecisionAnswer {
  selected_choice?: string;
  choice?: string;
  answer?: string;
  probabilities?: Readonly<Record<string, number>>;
  confidence?: number;
  question_type?: string;
  type?: string;
  reasoning?: string;
}

interface JevDecisionResponseBody {
  answers?: Readonly<Record<string, JevDecisionAnswer>>;
  results?: Readonly<Record<string, JevDecisionAnswer>>;
  // Some Decisions APIs return the answer keyed by question id at the root.
  [k: string]: unknown;
}

function renderState<T extends string>(request: Decision<T>): string {
  const facts = request.facts as Readonly<Record<string, unknown>>;
  const parts: string[] = [request.question];
  for (const [k, v] of Object.entries(facts)) {
    parts.push(`${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`);
  }
  return parts.join('\n');
}

function buildQuestion<T extends string>(request: Decision<T>): JevDecisionQuestion {
  return {
    type: 'choice',
    question: request.question,
    choices: [...request.options],
    instructions: JEV_SYSTEM_INSTRUCTIONS,
    criteria: {
      decision_kind: request.kind,
      constraint: 'must select exactly one of the listed choices',
    },
  };
}

export class JevDecisionProvider implements DecisionProvider {
  readonly name = 'jev';
  /** Pinned — there is no setter, no constructor parameter, no escape hatch. */
  readonly model = JEV_DECISION_MODEL;
  /** Pinned — same. */
  readonly endpoint = JEV_DECISIONS_ENDPOINT;
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

    const body: JevDecisionRequestBody = {
      model: JEV_DECISION_MODEL,
      state: renderState(request),
      questions: {
        q1: buildQuestion(request),
      },
    };

    const t0 = Date.now();
    let resp: Response;
    try {
      resp = await this.fetchWithTimeout(JEV_DECISIONS_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
    } catch (e: unknown) {
      if (e instanceof JevProviderTimeoutError) throw e;
      throw new JevProviderUnavailableError(
        0,
        String((e as Error)?.message ?? e).slice(0, 200),
      );
    }
    const latencyMs = Date.now() - t0;

    // HTTP 401/403 handling. 403 with "not available in your region" is a
    // geo-restriction — we surface as JevProviderUnavailableError so callers
    // can distinguish it from a bad credential (which stays as
    // JevCredentialInvalidError). The discriminator is the response body.
    if (resp.status === 401) {
      throw new JevCredentialInvalidError(resp.status);
    }
    if (resp.status === 403) {
      const text = await resp.text();
      // If the 403 body explicitly mentions "region" or "geo", treat as
      // provider-unavailable (caller can retry with different region).
      // Otherwise treat as invalid credential.
      if (/region|geo/i.test(text)) {
        throw new JevProviderUnavailableError(
          resp.status,
          text.slice(0, 200),
        );
      }
      throw new JevCredentialInvalidError(resp.status);
    }
    if (!resp.ok) {
      const text = await resp.text();
      throw new JevProviderUnavailableError(resp.status, text.slice(0, 200));
    }

    const parsed = (await resp.json()) as JevDecisionResponseBody;

    // Locate the answer for q1. The Decisions API may return answers under
    // `answers.q1` or `results.q1` (we handle both), or — as a fallback —
    // at the root with key `q1`.
    const answers = parsed.answers ?? parsed.results ?? parsed;
    const answer = (answers as Record<string, JevDecisionAnswer | undefined>)?.['q1'];

    if (answer === undefined) {
      throw new JevMalformedResponseError(
        'no answer for question q1',
        JSON.stringify(parsed).slice(0, 400),
      );
    }

    // The selected choice may be under selected_choice, choice, or answer.
    const returnedChoiceRaw =
      answer.selected_choice ?? answer.choice ?? answer.answer;
    if (typeof returnedChoiceRaw !== 'string') {
      throw new JevMalformedResponseError(
        'answer.q1.selected_choice (or choice/answer) is not a string',
        JSON.stringify(answer).slice(0, 400),
      );
    }
    // Verify the returned choice is in the requested option set.
    const matched = request.options.find(
      (o) => o === (returnedChoiceRaw as T),
    );
    if (matched === undefined) {
      throw new JevInvalidChoiceError(returnedChoiceRaw, request.options);
    }

    const usage = (parsed as { usage?: Record<string, unknown> }).usage;
    const costUsd =
      typeof usage?.cost === 'number'
        ? (usage.cost as number)
        : typeof usage?.usd === 'number'
          ? (usage.usd as number)
          : undefined;
    const promptTokens = typeof usage?.prompt_tokens === 'number'
      ? (usage.prompt_tokens as number)
      : undefined;
    const completionTokens = typeof usage?.completion_tokens === 'number'
      ? (usage.completion_tokens as number)
      : undefined;
    const totalTokens = typeof usage?.total_tokens === 'number'
      ? (usage.total_tokens as number)
      : undefined;

    const meta: JevProviderMetadata = {
      endpoint: JEV_DECISIONS_ENDPOINT,
      model: JEV_DECISION_MODEL,
      latencyMs,
      promptTokens,
      completionTokens,
      totalTokens,
      costUsd,
      probabilities: answer.probabilities,
      confidence: answer.confidence,
      questionType: answer.question_type ?? answer.type ?? 'choice',
      reasoningExcerpt:
        typeof answer.reasoning === 'string' && answer.reasoning.length > 0
          ? answer.reasoning.slice(0, JEV_REASONING_EXCERPT_MAX)
          : undefined,
    };

    return {
      choice: matched,
      reason:
        typeof answer.reasoning === 'string' && answer.reasoning.length > 0
          ? answer.reasoning.slice(0, 500)
          : 'jev (Decisions API) selected this option; no structured reason supplied',
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
