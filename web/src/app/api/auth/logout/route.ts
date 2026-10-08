/**
 * AgentCraft Genesis G7 — BFF Operator Logout
 *
 * POST /api/auth/logout
 *   200 + Set-Cookie genesis_bff=; Max-Age=0 (clears the cookie)
 *
 * Stateless — the server does not maintain a session table. Logout just
 * instructs the browser to discard the cookie. The HMAC-signed token remains
 * technically valid until its 8h expiry, but the browser will not send it
 * anymore.
 *
 * For stronger revocation (e.g., immediate invalidation of leaked cookies),
 * a server-side session table or a token revocation list would be needed.
 * That is out of G7-02 scope.
 */

import { type NextRequest, NextResponse } from "next/server";
import { buildClearCookieHeader } from "@/lib/auth/cookie";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_req: NextRequest) {
  const headers = new Headers();
  headers.set("Set-Cookie", buildClearCookieHeader());
  return NextResponse.json(
    { ok: true, status: "logged_out" },
    { status: 200, headers },
  );
}
