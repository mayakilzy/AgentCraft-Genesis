/**
 * AgentCraft Genesis G7 — Minimal BFF Auth Boundary (Operator PIN model)
 *
 * G7-02 Independent Review correction. The previous model (any caller could
 * obtain a signed cookie via GET /api/auth/setup) was a design flaw: a signed
 * cookie is not authorization if anonymous callers can mint one on demand.
 *
 * The new model:
 *   - The BFF cookie is ONLY issued by POST /api/auth/login, which requires
 *     a server-validated operator PIN.
 *   - The PIN is read from process.env.GENESIS_OPERATOR_PIN. In dev mode
 *     (NODE_ENV !== 'production') the default dev PIN 'dev-local-pin' is
 *     used so the operator can authenticate locally without friction.
 *     In production, GENESIS_OPERATOR_PIN MUST be set or /api/auth/login
 *     fails closed (503 BFF_PIN_NOT_CONFIGURED) — refusing to issue cookies.
 *   - The cookie payload includes the claim `op: "operator"` + an
 *     `operatorId` bound to the authenticated context. Cookies without these
 *     claims are REJECTED by the BFF.
 *
 * Trust boundary (residual, documented):
 *   - Anyone with the operator PIN can mint a BFF session.
 *   - The PIN is a shared secret — single-factor. Suitable for controlled
 *     environments with operator-only network access. NOT for untrusted
 *     network exposure without additional layers (rate limiting, IP allow-list,
 *     mTLS, OAuth).
 *   - All BFF sessions share the single GENESIS_API_KEY's callerId. We do NOT
 *     claim multi-user isolation. The `operatorId` field records WHICH
 *     operator authenticated via PIN (for audit logging only).
 *   - Cookies are HttpOnly + SameSite=Strict + Secure (in production) +
 *     Max-Age=8h. They do NOT survive server restart unless
 *     GENESIS_BFF_SECRET is set (otherwise a per-process random secret is
 *     used and old cookies become invalid).
 *
 * This is NOT a full identity platform. It is the SMALLEST appropriate
 * authentication mechanism for the current controlled environment that
 * does not rely solely on NODE_ENV, CORS, or SameSite for security.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export const BFF_COOKIE_NAME = "genesis_bff";
const COOKIE_TTL_SECONDS = 8 * 60 * 60; // 8 hours — bounded session

// Default dev PIN. Used ONLY when GENESIS_OPERATOR_PIN is unset AND
// NODE_ENV !== 'production'. In production, GENESIS_OPERATOR_PIN MUST be set
// or /api/auth/login fails closed (503 BFF_PIN_NOT_CONFIGURED).
export const DEFAULT_DEV_PIN = "dev-local-pin";

const FALLBACK_SECRET = process.env.GENESIS_BFF_SECRET
  ? process.env.GENESIS_BFF_SECRET
  : (() => {
      if (process.env.NODE_ENV === "production") {
        // Fail-closed in production: refuse to issue cookies without an
        // explicit secret. The /api/auth/login route will detect this and
        // return 503 BFF_PIN_NOT_CONFIGURED.
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

/**
 * Get the expected operator PIN.
 * Returns null in production when GENESIS_OPERATOR_PIN is unset (fail-closed).
 */
export function getOperatorPin(): string | null {
  if (process.env.GENESIS_OPERATOR_PIN) {
    return process.env.GENESIS_OPERATOR_PIN;
  }
  if (process.env.NODE_ENV === "production") {
    return null; // fail closed
  }
  return DEFAULT_DEV_PIN; // local dev convenience
}

export interface CookiePayload {
  /** ISO timestamp when issued. */
  readonly iat: string;
  /** Unix ms expiry timestamp. */
  readonly exp: number;
  /** Fixed scope — the BFF does not manage multiple roles. */
  readonly scope: "bff";
  /**
   * Operator authorization claim. Cookies without `op: "operator"` are
   * REJECTED by the BFF. This is the critical difference from the G7-01
   * closure's flawed model: a signed cookie without this claim is NOT
   * privileged.
   */
  readonly op: "operator";
  /**
   * The operator identity this session is bound to. NOT multi-user isolation
   * — all BFF calls still use the single GENESIS_API_KEY's callerId. This
   * field just records WHICH operator authenticated via PIN, for audit.
   */
  readonly operatorId: string;
}

function signToken(payload: CookiePayload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", SECRET).update(body).digest("base64url");
  return `${body}.${sig}`;
}

/**
 * Verify a token with an explicit secret. Exported for unit testing so tests
 * can sign tokens with a known secret and verify them without depending on
 * the production SECRET constant.
 */
export function verifyTokenWithSecret(
  token: string,
  secret: string,
): CookiePayload | null {
  if (!secret) return null;
  if (typeof token !== "string" || token.length === 0) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0 || dot === token.length - 1) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  const expectedSig = createHmac("sha256", secret)
    .update(body)
    .digest("base64url");

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
    // CRITICAL: cookies without the operator claim are NOT privileged.
    if (payload.op !== "operator") return null;
    if (
      typeof payload.operatorId !== "string" ||
      payload.operatorId.length === 0
    ) {
      return null;
    }
    if (Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

function verifyToken(token: string): CookiePayload | null {
  return verifyTokenWithSecret(token, SECRET);
}

/**
 * Issue an authenticated cookie for the given operator. Called by
 * /api/auth/login AFTER the PIN has been validated.
 */
export function issueAuthenticatedCookie(operatorId: string): string {
  const now = Date.now();
  return signToken({
    iat: new Date(now).toISOString(),
    exp: now + COOKIE_TTL_SECONDS * 1000,
    scope: "bff",
    op: "operator",
    operatorId,
  });
}

/**
 * Verify an incoming cookie. Returns true iff the cookie has a valid
 * signature, the operator claim, and has not expired.
 */
export function isValidAuthenticatedCookie(
  value: string | undefined | null,
): boolean {
  if (typeof value !== "string" || value.length === 0) return false;
  return verifyToken(value) !== null;
}

/**
 * Decode an authenticated cookie and return its payload. Used by the BFF to
 * bind the request to the operator context (e.g., for audit logging).
 */
export function decodeAuthenticatedCookie(
  value: string | undefined | null,
): CookiePayload | null {
  if (typeof value !== "string" || value.length === 0) return null;
  return verifyToken(value);
}

/**
 * Constant-time string comparison. Returns true iff the strings are equal
 * in length and content. Compares all bytes (does not short-circuit).
 *
 * Used for PIN comparison to avoid timing attacks that could reveal the PIN
 * length or prefix.
 */
export function constantTimePinCompare(a: string, b: string): boolean {
  if (a.length === 0 || b.length === 0) return false;
  if (a.length !== b.length) {
    // Still do a comparison to avoid leaking length via timing.
    timingSafeEqual(Buffer.from(a), Buffer.from(a));
    return false;
  }
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

/**
 * Cookie attributes for Set-Cookie header. SameSite=Strict prevents CSRF.
 * HttpOnly prevents JavaScript access. Secure requires HTTPS (set in prod).
 *
 * G7-12D: GENESIS_COOKIE_SECURE env var allows overriding the Secure flag
 * for local HTTP testing (e.g., Playwright browser tests against http://localhost).
 * In production, GENESIS_COOKIE_SECURE is NOT set — the default (NODE_ENV=production
 * → secure=true) applies. This is configuration-only, not a security weakening.
 */
export function getCookieAttributes(): {
  httpOnly: boolean;
  sameSite: "strict" | "lax" | "none";
  secure: boolean;
  path: string;
  maxAge: number;
} {
  const secureOverride = process.env.GENESIS_COOKIE_SECURE;
  const secure = secureOverride !== undefined
    ? secureOverride === "true" || secureOverride === "1"
    : process.env.NODE_ENV === "production";
  return {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: COOKIE_TTL_SECONDS,
  };
}

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

export function buildClearCookieHeader(): string {
  return `${BFF_COOKIE_NAME}=; Path=/; Max-Age=0; SameSite=Strict`;
}
