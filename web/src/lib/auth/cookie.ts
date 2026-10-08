/**
 * AgentCraft Genesis G7 — Minimal BFF Auth Boundary
 *
 * Per 04_GATEWAY_DISCOVERY_AND_ADAPTER_CONTRACT.md §Authentication and secrets
 * + 05_SECURITY_ACCESSIBILITY_AND_OPERATIONS.md §Security boundaries:
 *
 *   "If existing gateway only supports server-to-server keys, use a minimal
 *    secure server-side proxy."
 *
 *   "Browser authentication must match actual gateway architecture. If
 *    server-side API key proxy is necessary, make it minimal and protected;
 *    do not ship a shared privileged API key to every browser."
 *
 * This is NOT a full identity platform. It is the SMALLEST appropriate
 * authentication/authorization boundary for the current controlled environment:
 *
 *   - Server-side HMAC-signed cookie, auto-issued by /api/auth/setup.
 *   - HttpOnly + SameSite=Strict + Secure (when HTTPS) + Max-Age bounded.
 *   - All /api/genesis/* calls verify the cookie; reject 401 if missing/invalid.
 *   - Fail-closed: no anonymous calls to /api/genesis/*.
 *   - The Gateway's callerId semantics are preserved — the BFF maps all
 *     authenticated UI callers to the single GENESIS_API_KEY's callerId.
 *     This is acceptable for the controlled environment; multi-tenant RBAC
 *     is out of scope (10_OPERATOR_DECISIONS §Exclusions).
 *
 * The cookie secret is read from process.env.GENESIS_BFF_SECRET. If missing,
 * a per-process random secret is generated (sessions don't survive restart;
 * UI re-issues the cookie transparently on next /api/auth/setup call).
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export const BFF_COOKIE_NAME = "genesis_bff";
const COOKIE_TTL_SECONDS = 8 * 60 * 60; // 8 hours — bounded session
const COOKIE_MAX_AGE = COOKIE_TTL_SECONDS;

// Per-process fallback secret. Used ONLY when GENESIS_BFF_SECRET is unset
// (controlled environment). Logged loudly so the operator notices.
const FALLBACK_SECRET = process.env.GENESIS_BFF_SECRET
  ? process.env.GENESIS_BFF_SECRET
  : (() => {
      if (process.env.NODE_ENV === "production") {
        // Fail-closed in production: refuse to start without an explicit secret.
        // The /api/auth/setup route will refuse to issue cookies.
        console.error(
          "[genesis-bff] FATAL: GENESIS_BFF_SECRET is not set in production mode; refusing to issue cookies.",
        );
        return "";
      }
      console.error(
        "[genesis-bff] WARNING: GENESIS_BFF_SECRET not set; using a per-process random secret. Cookies will not survive restart.",
      );
      return createHmac("sha256", Math.random().toString())
        .digest("hex")
        .slice(0, 32);
    })();

const SECRET: string = FALLBACK_SECRET;

interface CookiePayload {
  /** ISO timestamp when issued. */
  readonly iat: string;
  /** Unix ms expiry timestamp. */
  readonly exp: number;
  /** Fixed scope — the BFF does not manage multiple roles. */
  readonly scope: "bff";
}

/**
 * Sign a payload with the server-side secret. Returns a base64url string
 * "payload.signature" where payload is also base64url-encoded JSON.
 *
 * The signature is HMAC-SHA256 with constant-time verification.
 */
function signToken(payload: CookiePayload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", SECRET).update(body).digest("base64url");
  return `${body}.${sig}`;
}

/**
 * Verify a token: parse, check signature (constant-time), check expiry.
 * Returns the payload on success, or null on any failure.
 */
function verifyToken(token: string): CookiePayload | null {
  if (!SECRET) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0 || dot === token.length - 1) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  // Compute expected signature.
  const expectedSig = createHmac("sha256", SECRET)
    .update(body)
    .digest("base64url");

  // Constant-time comparison.
  const a = Buffer.from(sig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length) return null;
  if (!timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8"),
    ) as CookiePayload;
    if (typeof payload.exp !== "number" || typeof payload.iat !== "string") {
      return null;
    }
    if (payload.scope !== "bff") return null;
    if (Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

/**
 * Issue a new BFF cookie value. Called by /api/auth/setup.
 */
export function issueBffCookieValue(): string {
  const now = Date.now();
  return signToken({
    iat: new Date(now).toISOString(),
    exp: now + COOKIE_MAX_AGE * 1000,
    scope: "bff",
  });
}

/**
 * Verify a BFF cookie value from the incoming request. Returns true if valid.
 */
export function isValidBffCookie(value: string | undefined | null): boolean {
  if (typeof value !== "string" || value.length === 0) return false;
  return verifyToken(value) !== null;
}

/**
 * Cookie attributes for Set-Cookie header. SameSite=Strict prevents CSRF.
 * HttpOnly prevents JavaScript access. Secure requires HTTPS (set in prod).
 */
export function getCookieAttributes(): {
  httpOnly: boolean;
  sameSite: "strict" | "lax" | "none";
  secure: boolean;
  path: string;
  maxAge: number;
} {
  return {
    httpOnly: true,
    sameSite: "strict",
    // In the sandbox preview, the connection may be plain HTTP — Secure would
    // cause the cookie to be dropped. In production with HTTPS, set Secure=true.
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  };
}

/**
 * Compute the Set-Cookie header value for the BFF cookie.
 */
export function buildSetCookieHeader(value: string): string {
  const attrs = getCookieAttributes();
  const parts = [
    `${BFF_COOKIE_NAME}=${value}`,
    `Path=${attrs.path}`,
    `Max-Age=${attrs.maxAge}`,
    `SameSite=${attrs.sameSite}`,
  ];
  if (attrs.httpOnly) parts.push("HttpOnly");
  if (attrs.secure) parts.push("Secure");
  return parts.join("; ");
}

/**
 * Cookie attributes to send on a deletion (Set-Cookie with Max-Age=0).
 */
export function buildClearCookieHeader(): string {
  return `${BFF_COOKIE_NAME}=; Path=/; Max-Age=0; SameSite=Strict`;
}
