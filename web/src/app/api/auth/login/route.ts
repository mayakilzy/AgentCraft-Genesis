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
 * Production hardening (out of G7-02 scope):
 *   - Add rate limiting (e.g., 5 attempts per minute per IP).
 *   - Add IP allow-listing for operator networks.
 *   - Add mTLS or OAuth for untrusted network exposure.
 *   - Rotate the PIN regularly; use a long random value (not "dev-local-pin").
 */

import { type NextRequest, NextResponse } from "next/server";
import {
  buildSetCookieHeader,
  constantTimePinCompare,
  getOperatorPin,
  issueAuthenticatedCookie,
} from "@/lib/auth/cookie";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
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
  return NextResponse.json(
    { ok: true, status: "authenticated", operatorId },
    { status: 200, headers },
  );
}
