/**
 * G6-01 — Production failure taxonomy.
 *
 * Section 13 of the G6-01 mission brief requires a MINIMAL production
 * failure taxonomy. This is NOT an elaborate exception ontology — it is
 * the smallest set of classes that lets Genesis preserve mission truth
 * under failure, support future Mission Control observability, and
 * distinguish recovery paths.
 *
 * The taxonomy deliberately covers the failure SOURCES the engine
 * actually encounters (provider, runtime, worker, tool, verification,
 * timeout, cancellation, budget, configuration, recovery, unknown).
 * Each class has a one-line operational meaning; nothing more.
 *
 * Anti-bloat: one small file. No class hierarchy. No exception tree.
 * The class is a string literal for direct JSON serialization in flight
 * events — no transformation required at the recorder boundary.
 */

/**
 * The minimal production failure taxonomy. Each literal names a SOURCE
 * of failure (who failed), not a SYMPTOM (what failed). A worker that
 * reports "the LLM gave me malformed JSON" classifies as PROVIDER_FAILURE
 * (the provider returned unusable output) or WORKER_FAILURE (the worker
 * could not adapt) depending on which boundary actually broke.
 */
export type FailureClass =
  | 'PROVIDER_FAILURE'
  | 'RUNTIME_FAILURE'
  | 'WORKER_FAILURE'
  | 'TOOL_FAILURE'
  | 'VERIFICATION_FAILURE'
  | 'TIMEOUT'
  | 'CANCELLED'
  | 'BUDGET_EXHAUSTED'
  | 'CONFIGURATION_FAILURE'
  | 'RECOVERY_FAILURE'
  | 'UNKNOWN_FAILURE';

/** All valid failure classes — used for input validation. */
export const FAILURE_CLASSES: readonly FailureClass[] = [
  'PROVIDER_FAILURE',
  'RUNTIME_FAILURE',
  'WORKER_FAILURE',
  'TOOL_FAILURE',
  'VERIFICATION_FAILURE',
  'TIMEOUT',
  'CANCELLED',
  'BUDGET_EXHAUSTED',
  'CONFIGURATION_FAILURE',
  'RECOVERY_FAILURE',
  'UNKNOWN_FAILURE',
];

/**
 * Classify an arbitrary thrown value into a FailureClass. The classifier
 * inspects the error's message and shape — never its stack — to pick the
 * most specific class. The fallback is UNKNOWN_FAILURE: the engine never
 * silently relabels an unknown failure as a known one.
 *
 * Classification heuristics (intentionally simple, intentionally few):
 *   - AbortError / 'aborted' / signal.aborted → CANCELLED
 *   - 'timeout' / 'timed out' / ETIMEDOUT → TIMEOUT
 *   - HTTP 429 / 'rate limit' / 'too many requests' → PROVIDER_FAILURE
 *   - HTTP 5xx / ECONNREFUSED / ECONNRESET / ENOTFOUND / 'network' → PROVIDER_FAILURE
 *   - 'unknown tool' / 'not granted' / 'unauthorized' → TOOL_FAILURE
 *   - 'configuration' / 'missing' / 'not set' / 'required env' → CONFIGURATION_FAILURE
 *   - Everything else → UNKNOWN_FAILURE
 */
export function classifyError(error: unknown): FailureClass {
  if (error === null || error === undefined) return 'UNKNOWN_FAILURE';
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : String(error);
  const lower = message.toLowerCase();

  // Cancellation: AbortController signal or explicit cancel.
  if (
    (error as { name?: string }).name === 'AbortError' ||
    lower.includes('aborted') ||
    lower.includes('cancel')
  ) {
    return 'CANCELLED';
  }

  // Timeout.
  if (
    lower.includes('timeout') ||
    lower.includes('timed out') ||
    lower.includes('etimedout')
  ) {
    return 'TIMEOUT';
  }

  // Configuration errors (env vars, missing secrets).
  if (
    lower.includes('configuration') ||
    lower.includes('missing') ||
    lower.includes('not set') ||
    lower.includes('required env') ||
    lower.includes('api_key') ||
    lower.includes('api key')
  ) {
    return 'CONFIGURATION_FAILURE';
  }

  // Provider errors: rate limits, HTTP 429/5xx, network errors.
  if (
    lower.includes('429') ||
    lower.includes('rate limit') ||
    lower.includes('too many requests') ||
    lower.includes('status 5') ||
    lower.includes('econnrefused') ||
    lower.includes('econnreset') ||
    lower.includes('enotfound') ||
    lower.includes('epipe') ||
    lower.includes('network') ||
    lower.includes('unavailable') ||
    lower.includes('empty completion')
  ) {
    return 'PROVIDER_FAILURE';
  }

  // Tool errors: unauthorized, not granted, unknown tool.
  if (
    lower.includes('not granted') ||
    lower.includes('unauthorized') ||
    lower.includes('unknown tool') ||
    lower.includes('mcp tool')
  ) {
    return 'TOOL_FAILURE';
  }

  return 'UNKNOWN_FAILURE';
}

/**
 * Build a one-line summary of multiple failures for a flight event. Each
 * failure contributes its class and a truncated message; the summary
 * preserves enough information to triage without dumping stack traces.
 */
export function failureSummary(
  failures: ReadonlyArray<{ readonly class: FailureClass; readonly message: string }>,
): string {
  if (failures.length === 0) return '';
  return failures
    .map((f) => `${f.class}: ${f.message.slice(0, 160)}`)
    .join(' | ');
}

/**
 * Whether a failure class is RETRYABLE with a fresh attempt. Used by the
 * worker loop's bounded-retry decision. Cancellation and budget exhaustion
 * are never retried; verification failure is the orchestrator's call (not
 * the worker's); unknown failures are retried once (the conservative
 * choice — a transient glitch deserves one bounded retry).
 */
export function isRetryable(cls: FailureClass): boolean {
  switch (cls) {
    case 'PROVIDER_FAILURE':
    case 'RUNTIME_FAILURE':
    case 'TOOL_FAILURE':
    case 'TIMEOUT':
    case 'UNKNOWN_FAILURE':
      return true;
    case 'WORKER_FAILURE':
    case 'VERIFICATION_FAILURE':
    case 'CANCELLED':
    case 'BUDGET_EXHAUSTED':
    case 'CONFIGURATION_FAILURE':
    case 'RECOVERY_FAILURE':
      return false;
  }
}
