/**
 * AgentCraft Genesis G7 — BFF Operator Login (PIN-validated)
 *
 * POST /api/auth/login
 *   Body: { "pin": "<operator-pin>" }
 *   200 + Set-Cookie genesis_bff=<HMAC-signed token with op=operator claim>
 *      on successful PIN validation.
 *   400 INVALID_JSON — body not valid JSON.
 *   400 MISSING_PIN — body missing the "pin" field.
 *   401 INVALID_PIN — PIN does not match (constant-time comparison).
 *      No Set-Cookie issued. The error code returned is intentionally
 *      the same as 503 to avoid leaking which case applies.
 *   429 TOO_MANY_ATTEMPTS — the caller's rate-limit bucket is over the
 *      threshold (5 failed attempts per 60s by default). The body is
 *      a generic error; the `Retry-After` header indicates the wait.
 *      The bucket is keyed by `getRateLimitKey(req)`, which does NOT
 *      trust client-supplied forwarding headers by default — see
 *      `web/src/lib/auth/rate-limit.ts` for the trust model.
 *   503 BFF_PIN_NOT_CONFIGURED — server has no operator PIN configured
 *      (GENESIS_OPERATOR_PIN unset AND NODE_ENV=production). Fail-closed.
 *
 * Trust boundary: only callers with the correct operator PIN can obtain
 * an authenticated cookie. The cookie is required by /api/genesis/* —
 * without it, the BFF returns 401.
 *
 * The PIN is the SOLE trust boundary for the controlled environment. It is
 * a single shared secret — NOT multi-user. All BFF sessions share the
 * single GENESIS_API_KEY's callerId. The `operatorId` field in the cookie
 * records WHICH operator authenticated via PIN, for audit only.
 *
 * G7-15A reconciliation: the rate limiter (`web/src/lib/auth/rate-limit.ts`)
 * is the previously-deferred G7-08C item. It is in-memory, single-process,
 * and bounds online PIN brute-force. See the limiter module for documented
 * limitations (restart clears, multi-instance not shared).
 */

import { type NextRequest, NextResponse } from "next/server";
import {
  buildSetCookieHeader,
  constantTimePinCompare,
  getOperatorPin,
  issueAuthenticatedCookie,
} from "@/lib/auth/cookie";
import {
  clearRateLimit,
  getRateLimitKey,
  isRateLimited,
  recordFailedAttempt,
  RATE_LIMIT_CONFIG,
} from "@/lib/auth/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  // G7-15A: rate-limit check BEFORE parsing the body. A flood of requests
  // from an already-rate-limited key should not consume the JSON-parse
  // budget or the constant-time-compare budget. The key does NOT trust
  // client-supplied forwarding headers by default (see rate-limit module).
  const rateLimitKey = getRateLimitKey(req);
  if (isRateLimited(rateLimitKey)) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "TOO_MANY_ATTEMPTS" as const,
          message: "Too many failed login attempts. Try again later.",
        },
      },
      {
        status: 429,
        headers: {
          // RFC 6585 §4: indicate the wait time in seconds. The window is
          // the limiter's default sliding window. We always report the
          // full window so an attacker cannot probe the exact expiry.
          "Retry-After": String(Math.ceil(RATE_LIMIT_CONFIG.windowMs / 1000)),
        },
      },
    );
  }

  // Parse the JSON body. Reject malformed bodies with 400.
  let body: { pin?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "INVALID_JSON" as const,
          message: "request body must be valid JSON",
        },
      },
      { status: 400 },
    );
  }

  // Validate the pin field is present and a non-empty string.
  const providedPin = typeof body.pin === "string" ? body.pin : "";
  if (providedPin.length === 0) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "MISSING_PIN" as const,
          message: "PIN is required",
        },
      },
      { status: 400 },
    );
  }

  // Resolve the expected PIN. In production without GENESIS_OPERATOR_PIN set,
  // fail closed.
  const expectedPin = getOperatorPin();
  if (!expectedPin) {
    // Production + no PIN configured: refuse to issue cookies. Do NOT leak
    // that the server is "misconfigured" vs "wrong PIN" — return 401 with
    // the same INVALID_PIN code so an attacker cannot distinguish.
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "INVALID_PIN" as const,
          message: "Invalid PIN.",
        },
      },
      { status: 401 },
    );
  }

  // Constant-time comparison to prevent timing attacks.
  if (!constantTimePinCompare(providedPin, expectedPin)) {
    // G7-15A: record the failed attempt. If this attempt pushes the key
    // over the limit, the NEXT request from this key will get 429 (the
    // current request still gets 401 so the attacker cannot distinguish
    // "wrong PIN" from "rate-limited" on the same response — which would
    // be a timing side-channel).
    recordFailedAttempt(rateLimitKey);
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "INVALID_PIN" as const,
          message: "Invalid PIN.",
        },
      },
      { status: 401 },
    );
  }

  // PIN is valid. Issue an authenticated cookie bound to the operator context.
  // Single-operator model: not multi-user isolation. All calls share the
  // gateway's callerId via GENESIS_API_KEY.
  const operatorId = "operator"; // single shared operator (no multi-user claim)
  const value = issueAuthenticatedCookie(operatorId);
  const headers = new Headers();
  headers.set("Set-Cookie", buildSetCookieHeader(value));
  // G7-15A: clear the rate-limit bucket for this key on successful login.
  // A legitimate operator who typos a few times then succeeds should NOT
  // be locked out on the next session. See the limiter module for the
  // "preserve legitimate development behavior" rationale.
  clearRateLimit(rateLimitKey);
  return NextResponse.json(
    { ok: true, status: "authenticated", operatorId },
    { status: 200, headers },
  );
}
