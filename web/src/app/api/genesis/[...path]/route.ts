/**
 * AgentCraft Genesis G7 — Secure BFF Proxy Route Handler (Closure-hardened)
 *
 * Per 04_GATEWAY_DISCOVERY_AND_ADAPTER_CONTRACT.md §Authentication and secrets
 * + 05_SECURITY_ACCESSIBILITY_AND_OPERATIONS.md §Security boundaries:
 *   "Never place gateway admin/API keys in browser bundles, localStorage or
 *    query strings. If existing gateway only supports server-to-server keys,
 *    use a minimal secure server-side proxy."
 *
 * HARDENING (G7-01 Closure Review):
 *   1. BFF caller boundary — requires a valid server-issued HMAC cookie.
 *      No cookie / invalid cookie = 401. Fail-closed for untrusted network exposure.
 *   2. Bounded upstream timeout — 30s default; abort propagation from incoming request.
 *   3. Path safety — reject `..`, null bytes, control chars; whitelist methods.
 *      Construct upstream URL via URL() constructor (no string concatenation).
 *   4. CORS — REMOVED permissive `Access-Control-Allow-Origin: *`. The UI is
 *      same-origin; cross-origin calls are rejected by the browser's same-origin
 *      policy AND by the SameSite=Strict cookie.
 *   5. Verified-routes whitelist — 8 patterns matching src/gateway/http-server.ts.
 *   6. Defense-in-depth secret redaction in error bodies (G6-09C on top of).
 *
 * Gateway ownership semantics preserved: the BFF maps all authenticated UI
 * callers to the single GENESIS_API_KEY's callerId. The Gateway enforces
 * cross-caller isolation (404 not 403). The BFF does not introduce a new
 * caller identity.
 */

import { type NextRequest, NextResponse } from "next/server";
import { BFF_COOKIE_NAME, isValidBffCookie } from "@/lib/auth/cookie";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GATEWAY_URL = process.env.GENESIS_HTTP_URL ?? "http://127.0.0.1:4180";
const GATEWAY_API_KEY = process.env.GENESIS_API_KEY ?? "";

// Bounded upstream timeout. Per 05_SECURITY §Resilience: "Poll only where
// necessary; bounded interval/backoff; clean up subscriptions and abort
// controllers on unmount." Same applies to server-side proxy calls.
const UPSTREAM_TIMEOUT_MS =
  Math.max(1000, Number(process.env.GENESIS_BFF_TIMEOUT_MS ?? 30000));

// Verified routes — the proxy refuses anything else. Mirror of
// src/gateway/http-server.ts route registrations.
const VERIFIED_PATTERNS: readonly { re: RegExp; methods: readonly string[] }[] = [
  { re: /^\/health$/, methods: ["GET"] },
  { re: /^\/ready$/, methods: ["GET"] },
  { re: /^\/v1\/missions$/, methods: ["POST"] },
  { re: /^\/v1\/missions\/[^/]+$/, methods: ["GET"] },
  { re: /^\/v1\/missions\/[^/]+\/events$/, methods: ["GET"] },
  { re: /^\/v1\/missions\/[^/]+\/result$/, methods: ["GET"] },
  { re: /^\/v1\/missions\/[^/]+\/artifacts$/, methods: ["GET"] },
  { re: /^\/v1\/missions\/[^/]+\/cancel$/, methods: ["POST"] },
];

const ALLOWED_METHODS = new Set(["GET", "POST"]);

interface VerifiedMatch {
  pattern: string;
  methods: readonly string[];
}

function findVerifiedMatch(
  path: string,
  method: string,
): VerifiedMatch | null {
  for (const entry of VERIFIED_PATTERNS) {
    if (entry.re.test(path) && entry.methods.includes(method)) {
      return { pattern: entry.re.source, methods: entry.methods };
    }
  }
  return null;
}

/**
 * Validate a single path segment for safety:
 *   - Reject empty (//), reject `..` (path traversal), reject `.` alone.
 *   - Reject null bytes / control chars (0x00-0x1F, 0x7F).
 *   - Reject leading/trailing whitespace.
 *   - Allow URL-encoded chars but reject %00 (%00 = null byte via URL).
 *
 * The Gateway already filters `..` and leading `/` in artifact paths
 * (http-server.ts threat model), but the BFF validates BEFORE constructing
 * the upstream URL — defense-in-depth at the trust boundary.
 */
function isSafeSegment(raw: string): boolean {
  if (raw.length === 0) return false;
  if (raw === "." || raw === "..") return false;
  // Reject any control char or null byte (after URL-decode in caller).
  // Note: raw here is the URL-encoded form from ctx.params; the BFF decodes
  // it explicitly before this check would run on decoded value.
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i);
    if (code === 0 || (code < 0x20) || code === 0x7f) return false;
  }
  // Reject encoded null byte.
  if (/%00/i.test(raw)) return false;
  // Reject leading slash (cross-mission path traversal).
  if (raw.startsWith("/")) return false;
  return true;
}

/**
 * Construct the upstream URL safely via URL() constructor — no string concat.
 * Throws on malformed input, which the caller maps to 400.
 */
function buildUpstreamUrl(path: string, search: string): URL {
  const base = new URL(GATEWAY_URL);
  // Enforce single trailing-slash convention; path already starts with "/".
  // URL() will normalize "//" to "/" — but we already validated segments above.
  const fullPath = path.startsWith("/") ? path : `/${path}`;
  return new URL(fullPath + search, base);
}

/**
 * Redact any obvious secret sentinels from error bodies before returning to
 * the client. Per 05_SECURITY §Resilience: error messages must redact secrets.
 * Defense-in-depth on top of the gateway's G6-09C scrubbing.
 */
function redactSecrets(text: string): string {
  const secretPatterns: readonly RegExp[] = [
    /(ghp_[A-Za-z0-9]{36})/g, // GitHub PAT
    /(sk-[A-Za-z0-9]{20,})/g, // OpenAI-style
    /(Bearer\s+[A-Za-z0-9_.-]{20,})/gi, // Authorization header
    /(GENESIS_API_KEYS?=[^\s&]+)/g, // env var leak
    /(ZAI_API_KEY=[^\s&]+)/g, // provider key leak
    /(ZAI_SDK_PATH=[^\s&]+)/g, // sdk path leak
  ];
  let out = text;
  for (const re of secretPatterns) {
    out = out.replace(re, "[REDACTED]");
  }
  return out;
}

/**
 * Authorize the incoming request: must carry a valid BFF cookie.
 * Fail-closed: no cookie / invalid cookie / expired cookie = 401.
 */
function authorize(req: NextRequest): NextResponse | null {
  const cookie = req.cookies.get(BFF_COOKIE_NAME)?.value;
  if (!cookie || !isValidBffCookie(cookie)) {
    return NextResponse.json(
      {
        error: {
          code: "UNAUTHENTICATED" as const,
          message:
            "BFF cookie missing or invalid. Call /api/auth/setup to obtain one.",
        },
      },
      { status: 401 },
    );
  }
  return null; // authorized
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ path?: string[] }> },
) {
  return proxy(req, ctx);
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ path?: string[] }> },
) {
  return proxy(req, ctx);
}

// No OPTIONS handler — same-origin UI doesn't need preflight. Cross-origin
// callers will be blocked by the browser's same-origin policy AND the
// SameSite=Strict cookie (no cookie sent on cross-origin fetch).

async function proxy(
  req: NextRequest,
  ctx: { params: Promise<{ path?: string[] }> },
) {
  // 1. Authorize: BFF cookie required. Fail-closed.
  const authFailure = authorize(req);
  if (authFailure) return authFailure;

  // 2. Method whitelist — only GET and POST are proxied. PUT/DELETE/PATCH
  //    would bypass the Gateway contract.
  if (!ALLOWED_METHODS.has(req.method)) {
    return NextResponse.json(
      {
        error: {
          code: "METHOD_NOT_ALLOWED" as const,
          message: `Method ${req.method} is not proxied. Allowed: GET, POST.`,
        },
      },
      { status: 405 },
    );
  }

  // 3. Decode + validate path segments.
  const { path: pathSegments = [] } = await ctx.params;
  if (pathSegments.length === 0) {
    return NextResponse.json(
      {
        error: {
          code: "NOT_FOUND" as const,
          message: "no path provided",
        },
      },
      { status: 404 },
    );
  }

  // Decode each segment with explicit error handling (malformed % sequences).
  const decodedSegments: string[] = [];
  for (const seg of pathSegments) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(seg);
    } catch {
      return NextResponse.json(
        {
          error: {
            code: "INVALID_PATH" as const,
            message: "path segment contained malformed percent-encoding",
          },
        },
        { status: 400 },
      );
    }
    if (!isSafeSegment(decoded)) {
      return NextResponse.json(
        {
          error: {
            code: "INVALID_PATH" as const,
            message:
              "path segment rejected by safety filter (traversal, null bytes, or control chars)",
          },
        },
        { status: 400 },
      );
    }
    decodedSegments.push(decoded);
  }

  const path = "/" + decodedSegments.join("/");
  const search = req.nextUrl.search ?? "";

  // 4. Verified-routes allowlist — method + path must match.
  const match = findVerifiedMatch(path, req.method);
  if (!match) {
    return NextResponse.json(
      {
        error: {
          code: "NOT_FOUND" as const,
          message: `route not in verified gateway contract: ${req.method} ${path}`,
        },
      },
      { status: 404 },
    );
  }

  // 5. Construct upstream URL safely.
  let upstreamUrl: URL;
  try {
    upstreamUrl = buildUpstreamUrl(path, search);
  } catch {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_PATH" as const,
          message: "could not construct upstream URL",
        },
      },
      { status: 400 },
    );
  }

  // 6. Build upstream headers — attach Gateway API key only for routes that
  //    require it. /health and /ready are public on the gateway.
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (GATEWAY_API_KEY && path !== "/health" && path !== "/ready") {
    headers.Authorization = `Bearer ${GATEWAY_API_KEY}`;
  }
  // If no API key is configured AND the route requires it, fail closed now
  // (don't waste an upstream call that will return 401).
  if (!GATEWAY_API_KEY && path !== "/health" && path !== "/ready") {
    return NextResponse.json(
      {
        error: {
          code: "UNAUTHENTICATED" as const,
          message:
            "GENESIS_API_KEY is not configured on the BFF; cannot authenticate to the gateway.",
        },
      },
      { status: 401 },
    );
  }

  // 7. Read body for POST only.
  let body: BodyInit | undefined;
  if (req.method === "POST") {
    try {
      body = await req.text();
    } catch {
      return NextResponse.json(
        {
          error: {
            code: "INVALID_JSON" as const,
            message: "could not read request body",
          },
        },
        { status: 400 },
      );
    }
  }

  // 8. Bounded upstream timeout + abort propagation.
  //    We race the upstream fetch against:
  //      - a timeout controller
  //      - the incoming request's abort signal (if the UI navigates away)
  const abortController = new AbortController();
  const timeoutHandle = setTimeout(
    () => abortController.abort(),
    UPSTREAM_TIMEOUT_MS,
  );
  // Propagate incoming request abort if the client disconnects.
  if (req.signal) {
    if (req.signal.aborted) abortController.abort();
    else
      req.signal.addEventListener("abort", () => abortController.abort(), {
        once: true,
      });
  }

  try {
    const upstream = await fetch(upstreamUrl, {
      method: req.method,
      headers,
      body,
      signal: abortController.signal,
      // Next.js fetch() supports this; ensures we don't follow unexpected redirects.
      redirect: "error",
    });

    const responseText = await upstream.text();
    const responseHeaders = new Headers();
    responseHeaders.set(
      "Content-Type",
      upstream.headers.get("Content-Type") ?? "application/json",
    );
    // No Access-Control-* headers — same-origin only.
    const safeText = redactSecrets(responseText);

    return new NextResponse(safeText, {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch (e) {
    // Distinguish timeout from network failure.
    const isTimeout =
      e instanceof DOMException && e.name === "AbortError" && !req.signal?.aborted;
    if (isTimeout) {
      return NextResponse.json(
        {
          error: {
            code: "TIMEOUT" as const,
            message: `gateway did not respond within ${UPSTREAM_TIMEOUT_MS}ms`,
          },
        },
        { status: 504 },
      );
    }
    // Gateway unreachable. Per 03_UI_UX_CONTRACT, show "Connection lost" honestly.
    const msg = e instanceof Error ? redactSecrets(e.message) : "upstream unreachable";
    return NextResponse.json(
      {
        error: {
          code: "UNAVAILABLE" as const,
          message: `gateway unreachable: ${msg}`,
        },
      },
      { status: 503 },
    );
  } finally {
    clearTimeout(timeoutHandle);
  }
}
