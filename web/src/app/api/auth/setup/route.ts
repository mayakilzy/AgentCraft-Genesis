/**
 * AgentCraft Genesis G7 — BFF Auth Setup Endpoint
 *
 * Issues (or refreshes) the BFF session cookie. Called once on AppShell mount
 * to ensure the cookie is present before any /api/genesis/* call is made.
 *
 * Per 05_SECURITY_ACCESSIBILITY_AND_OPERATIONS.md §Security boundaries:
 *   "make it minimal and protected; do not ship a shared privileged API key
 *    to every browser."
 *
 * This endpoint is intentionally trivial: it does NOT authenticate a user
 * against an identity store (there is none in the controlled environment).
 * It only issues a server-side HMAC-signed cookie that /api/genesis/* requires.
 *
 * Production hardening (deferred — out of G7-01 scope):
 *   - Add a real identity provider integration when GENESIS_BFF_PIN is set.
 *   - Add CSRF token rotation if multi-step forms are introduced.
 *   - Add rate limiting if exposed to untrusted networks.
 */

import { type NextRequest, NextResponse } from "next/server";
import {
  buildSetCookieHeader,
  issueBffCookieValue,
  isValidBffCookie,
  BFF_COOKIE_NAME,
} from "@/lib/auth/cookie";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return handleSetup(req);
}

export async function POST(req: NextRequest) {
  return handleSetup(req);
}

async function handleSetup(req: NextRequest) {
  // Idempotent: if a valid cookie is already present, return 200 without
  // re-issuing (avoids churn on every AppShell mount).
  const existing = req.cookies.get(BFF_COOKIE_NAME)?.value;
  if (existing && isValidBffCookie(existing)) {
    return NextResponse.json(
      { ok: true, status: "existing", scope: "bff" },
      { status: 200 },
    );
  }

  // Issue a fresh cookie.
  const value = issueBffCookieValue();
  if (!value) {
    // Secret is unset in production — fail closed.
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "BFF_SECRET_MISSING",
          message:
            "GENESIS_BFF_SECRET is not configured on the server. The BFF refuses to issue cookies.",
        },
      },
      { status: 503 },
    );
  }

  const headers = new Headers();
  headers.set("Set-Cookie", buildSetCookieHeader(value));
  // Same-origin only: no CORS, no Allow-Origin header.
  // The cookie is bound to this origin; cross-origin callers will not receive it.
  return NextResponse.json(
    { ok: true, status: "issued", scope: "bff" },
    { status: 200, headers },
  );
}
