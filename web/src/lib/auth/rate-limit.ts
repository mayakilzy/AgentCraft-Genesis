/**
 * AgentCraft Genesis G7-15A — Minimal in-memory PIN brute-force rate limiter.
 *
 * Reconciles the G7-08C deferred item ("Add rate limiting — e.g., 5 attempts
 * per minute per IP") into the production code path, without introducing a
 * new framework or external dependency.
 *
 * Design constraints (per G7-15A spec):
 *   - "Prevent untrusted client-supplied headers from bypassing the limiter."
 *   - "Avoid new frameworks or dependencies."
 *   - "Preserve legitimate development behavior without exposing secrets."
 *
 * Trust model for the client identity key:
 *
 *   Next.js 16 `NextRequest` does NOT expose `req.ip` (the property was
 *   removed in Next.js 15+). The only sources of client identity available
 *   to a route handler are HTTP headers — and the spec explicitly forbids
 *   trusting client-supplied forwarding headers (`X-Forwarded-For`,
 *   `X-Real-IP`, etc.) because an attacker can forge them to rotate the
 *   rate-limit key and bypass the limiter.
 *
 *   Resolution: the limiter uses a single configurable trust point.
 *   `getRateLimitKey(req)` returns one of:
 *
 *     1. If `GENESIS_TRUSTED_PROXY_HEADER` is set (e.g., `X-Real-IP`), AND
 *        the named header is present on the request, the value of that
 *        header is used. The operator is responsible for ensuring their
 *        reverse proxy overwrites this header on EVERY inbound request
 *        (stripping any client-supplied value) before forwarding to the
 *        BFF. This is the only way to enable per-IP rate limiting behind
 *        a proxy; the limiter itself does NOT trust the header by default.
 *
 *     2. Otherwise, a single static key `"default"` is used. Every caller
 *        shares one bucket. This is appropriate for the documented
 *        single-operator controlled environment (the BFF is reachable
 *        only on the operator network; the only attack surface is
 *        online PIN brute-force, which the single-bucket limiter still
 *        bounds). It is the fail-safe default when no trusted proxy is
 *        configured.
 *
 * Documented limitations of the in-memory limiter:
 *   - RESTART_CLEARS_LIMITER: state lives in a process-local Map. A
 *     gateway/BFF restart resets every bucket to empty. Acceptable for
 *     the controlled environment because the PIN is constant-time
 *     compared AND the cookie secret is rotated on restart.
 *   - MULTI_INSTANCE_NOT_SHARED: when running multiple BFF instances
 *     behind a load balancer, each instance has its own limiter Map.
 *     An attacker who can route around instances can multiply their
 *     effective rate by the instance count. To bound this, the
 *     operator must either run a single BFF instance OR introduce a
 *     shared store (Redis, etc.). A shared store is out of scope for
 *     G7-15A (no new dependencies per the spec) and is documented as
 *     a residual risk.
 *   - MEMORY_BOUND: the Map is bounded by `MAX_BUCKETS`. New buckets
 *     evict the oldest when the cap is reached (LRU-ish; we don't
 *     implement true LRU to keep the code small — oldest-insertion
 *     eviction is sufficient because a bucket is recreated on the
 *     next failed attempt from that key). Each bucket stores at most
 *     `MAX_TIMESTAMPS` integers (timestamps). Worst-case memory is
 *     MAX_BUCKETS × MAX_TIMESTAMPS × 8 bytes ≈ 80 KB.
 *
 * This module is server-only. It MUST NOT be imported by client
 * components (it stores state and reads env vars).
 */

import type { NextRequest } from "next/server";

/** Default: 5 attempts per 60 seconds per key. */
const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_WINDOW_MS = 60_000;
/** Bound the total number of distinct keys we track. */
const MAX_BUCKETS = 10_000;
/** Bound the number of timestamps we keep per key (defense in depth). */
const MAX_TIMESTAMPS = 100;

/**
 * A single rate-limit bucket. Stores the timestamps of recent attempts
 * within the sliding window. The next attempt older than `windowMs` is
 * evicted on every call to `checkAndRecord()`.
 */
interface RateLimitBucket {
  readonly createdAt: number;
  attempts: number[];
}

/**
 * In-memory rate-limit store. Module-level singleton — one per BFF
 * process. Documented limitations above.
 */
const buckets = new Map<string, RateLimitBucket>();
/** Insertion order of keys (for oldest-eviction). */
const bucketOrder: string[] = [];

/**
 * Resolve the rate-limit key for a request.
 *
 * Per the spec: "Prevent untrusted client-supplied headers from bypassing
 * the limiter." We ONLY read a header if the operator has explicitly
 * configured it via `GENESIS_TRUSTED_PROXY_HEADER`. The default is the
 * single static key `"default"`.
 *
 * @param req - the inbound NextRequest (only its headers are read).
 * @returns the rate-limit key (a stable string identifying the caller
 *   group for rate-limit purposes — NOT a cryptographic identity).
 */
export function getRateLimitKey(req: NextRequest): string {
  const trustedHeader = process.env.GENESIS_TRUSTED_PROXY_HEADER;
  if (trustedHeader) {
    // Operator-configured trusted proxy. The header name is case-insensitive
    // (HTTP headers are). The operator MUST ensure their reverse proxy
    // overwrites this header on every inbound request — stripping any
    // client-supplied value — before forwarding to the BFF. The limiter
    // does NOT validate this; it is an operator-side responsibility,
    // documented in the README.
    const value = req.headers.get(trustedHeader);
    if (value && value.length > 0) {
      // Use the FIRST comma-separated value (typical X-Forwarded-For
      // format: "client, proxy1, proxy2"). When the trusted proxy is
      // correctly configured, this is the proxy-overwritten value, not
      // a client-supplied one.
      const first = value.split(",")[0]?.trim() ?? "";
      if (first.length > 0) {
        // Truncate to a reasonable length to bound memory.
        return first.slice(0, 64);
      }
    }
    // Header configured but absent on this request (e.g., direct local
    // access that bypasses the proxy). Fall through to the default key
    // — fail-safe (single bucket), NOT fail-open.
  }
  return "default";
}

/**
 * Check whether the key is currently rate-limited, WITHOUT recording a
 * new attempt. Used by the login route to refuse early when the bucket
 * is already over the limit (so a flood of requests does not consume
 * the JSON-parse budget before the limiter rejects them).
 */
export function isRateLimited(key: string, now: number = Date.now()): boolean {
  const bucket = buckets.get(key);
  if (bucket === undefined) return false;
  const windowMs = DEFAULT_WINDOW_MS;
  const cutoff = now - windowMs;
  // Drop expired timestamps.
  bucket.attempts = bucket.attempts.filter((t) => t > cutoff);
  return bucket.attempts.length >= DEFAULT_MAX_ATTEMPTS;
}

/**
 * Record a failed attempt and return whether the key is now rate-limited.
 * The caller is responsible for returning HTTP 429 when this returns
 * `true`. Successful logins do NOT call this (a successful login is not
 * a rate-limitable event).
 *
 * @param key - the rate-limit key (from `getRateLimitKey`).
 * @param now - the current timestamp (injectable for tests).
 * @returns `true` if the key is now over the limit (caller should 429).
 */
export function recordFailedAttempt(
  key: string,
  now: number = Date.now(),
): boolean {
  let bucket = buckets.get(key);
  if (bucket === undefined) {
    // Evict the oldest bucket if we are at the cap.
    if (buckets.size >= MAX_BUCKETS && bucketOrder.length > 0) {
      const oldest = bucketOrder.shift();
      if (oldest !== undefined) buckets.delete(oldest);
    }
    bucket = { createdAt: now, attempts: [] };
    buckets.set(key, bucket);
    bucketOrder.push(key);
  }
  // Drop expired timestamps (sliding window).
  const cutoff = now - DEFAULT_WINDOW_MS;
  bucket.attempts = bucket.attempts.filter((t) => t > cutoff);
  // Append the new attempt.
  bucket.attempts.push(now);
  // Bound the per-bucket array (defense in depth against a runaway
  // attacker who somehow issues attempts faster than the window evicts).
  if (bucket.attempts.length > MAX_TIMESTAMPS) {
    bucket.attempts = bucket.attempts.slice(-MAX_TIMESTAMPS);
  }
  return bucket.attempts.length >= DEFAULT_MAX_ATTEMPTS;
}

/**
 * Clear the rate-limit bucket for a key. Called on a successful login
 * for the SAME key — a legitimate operator who failed a few times then
 * succeeded should NOT be locked out on the next session. This is the
 * "preserve legitimate development behavior" path: a real operator
 * who typos their PIN a few times and then succeeds is forgiven.
 *
 * Note: this clears attempts for the key, NOT for the operator. If the
 * key is the static `"default"` (no trusted proxy configured), clearing
 * it also clears any concurrent attacker's attempts. This is acceptable
 * in the single-operator controlled environment (the operator IS the
 * only legitimate user of the "default" key).
 */
export function clearRateLimit(key: string): void {
  buckets.delete(key);
  const idx = bucketOrder.indexOf(key);
  if (idx >= 0) bucketOrder.splice(idx, 1);
}

/**
 * Reset all rate-limit state. Exported for tests; production code
 * should NOT call this (it would clear an active brute-force defense).
 */
export function resetRateLimiterForTests(): void {
  buckets.clear();
  bucketOrder.length = 0;
}

/**
 * Inspect the current state. Exported for tests; not used by production.
 */
export function getRateLimitStateForTests(): ReadonlyMap<string, readonly number[]> {
  return new Map(
    [...buckets.entries()].map(([k, v]) => [k, [...v.attempts]]),
  );
}

/**
 * Configuration accessor. Exported for tests + documentation; production
 * code reads the constants directly.
 */
export const RATE_LIMIT_CONFIG = {
  maxAttempts: DEFAULT_MAX_ATTEMPTS,
  windowMs: DEFAULT_WINDOW_MS,
  maxBuckets: MAX_BUCKETS,
  maxTimestamps: MAX_TIMESTAMPS,
} as const;
