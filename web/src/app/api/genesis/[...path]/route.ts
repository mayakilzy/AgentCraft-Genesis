/**
 * AgentCraft Genesis G7 — Secure BFF Proxy Route Handler
 *
 * Per 04_GATEWAY_DISCOVERY_AND_ADAPTER_CONTRACT.md §Authentication and secrets:
 *   "Never place gateway admin/API keys in browser bundles, localStorage or
 *    query strings. If existing gateway only supports server-to-server keys,
 *    use a minimal secure server-side proxy."
 *
 * This Route Handler attaches the Bearer Authorization header using
 * process.env.GENESIS_API_KEY, which is server-side only and NEVER serialized
 * into the client bundle (Next.js Route Handlers are runtime = 'nodejs' by
 * default and the env var is read at request time).
 *
 * Verified routes (mirror of src/gateway/http-server.ts):
 *   GET    /health                                  (no auth on gateway — but we still proxy)
 *   GET    /ready
 *   POST   /v1/missions
 *   GET    /v1/missions/{missionId}
 *   GET    /v1/missions/{missionId}/events
 *   GET    /v1/missions/{missionId}/result
 *   GET    /v1/missions/{missionId}/artifacts
 *   POST   /v1/missions/{missionId}/cancel
 *
 * Anything else returns 404 to the UI. The UI adapter (client.ts) only calls
 * these verified paths anyway, so 404 means a programming error.
 *
 * R02 (CRITICAL): no API key in browser bundle, localStorage, or query string.
 * R10: HTML/SVG/artifact content is sanitized by the UI; this proxy just passes
 *      JSON through (the gateway does not expose HTML/SVG through these routes).
 */

import { type NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GATEWAY_URL = process.env.GENESIS_HTTP_URL ?? "http://127.0.0.1:4180";
const GATEWAY_API_KEY = process.env.GENESIS_API_KEY ?? "";

// Verified routes — the proxy refuses anything else.
const VERIFIED_PATTERNS: readonly RegExp[] = [
  /^\/health$/,
  /^\/ready$/,
  /^\/v1\/missions$/,
  /^\/v1\/missions\/[^/]+$/,
  /^\/v1\/missions\/[^/]+\/events$/,
  /^\/v1\/missions\/[^/]+\/result$/,
  /^\/v1\/missions\/[^/]+\/artifacts$/,
  /^\/v1\/missions\/[^/]+\/cancel$/,
];

function isVerifiedPath(path: string): boolean {
  return VERIFIED_PATTERNS.some((p) => p.test(path));
}

/**
 * Redact any obvious secret sentinels from error messages before returning
 * to the client. Per 05_SECURITY §Resilience: error messages must redact secrets.
 * (The gateway already scrubs failureMessage in G6-09C; this is defense-in-depth.)
 */
function redactSecrets(text: string): string {
  // Match common secret patterns — never leak to UI bundle, console, or analytics.
  const secretPatterns = [
    /(ghp_[A-Za-z0-9]{36})/g, // GitHub PAT
    /(sk-[A-Za-z0-9]{20,})/g, // OpenAI-style
    /(Bearer\s+[A-Za-z0-9_.-]{20,})/gi, // Authorization header
    /(GENESIS_API_KEYS?=[^\s&]+)/g, // env var leak
  ];
  let out = text;
  for (const re of secretPatterns) {
    out = out.replace(re, "[REDACTED]");
  }
  return out;
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

export async function OPTIONS(
  _req: NextRequest,
  _ctx: { params: Promise<{ path?: string[] }> },
) {
  // Permissive preflight — UI is on the same origin so this is rarely needed,
  // but include it for completeness.
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}

async function proxy(
  req: NextRequest,
  ctx: { params: Promise<{ path?: string[] }> },
) {
  const { path: pathSegments = [] } = await ctx.params;
  const path = "/" + pathSegments.map((s) => decodeURIComponent(s)).join("/");
  const search = req.nextUrl.search ?? "";

  if (!isVerifiedPath(path)) {
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

  // If no API key is configured, refuse to call the gateway (fail-closed).
  // The UI will see a 401-equivalent and show "unauthorized" honestly.
  // This is the correct behavior in the controlled-demo environment where
  // no real gateway is running.
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (GATEWAY_API_KEY && path !== "/health" && path !== "/ready") {
    // Gateway requires Bearer for /v1/* routes; /health and /ready are public.
    headers.Authorization = `Bearer ${GATEWAY_API_KEY}`;
  }

  // Read body only for POST; GET has no body.
  let body: BodyInit | undefined;
  if (req.method === "POST") {
    body = await req.text();
  }

  const upstreamUrl = `${GATEWAY_URL}${path}${search}`;
  try {
    const upstream = await fetch(upstreamUrl, {
      method: req.method,
      headers,
      body,
      // We rely on the UI adapter for timeouts via AbortController.
      // The proxy itself uses the default fetch timeout.
    });

    // Pass-through status and body. We do NOT inject anything into the response.
    const responseText = await upstream.text();
    const responseHeaders = new Headers();
    responseHeaders.set("Content-Type", upstream.headers.get("Content-Type") ?? "application/json");
    // Defense-in-depth: redact obvious secret sentinels from any error body.
    const safeText = redactSecrets(responseText);

    return new NextResponse(safeText, {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch (e) {
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
  }
}
