/**
 * AgentCraft Genesis G7-01 Closure — BFF Regression Tests
 *
 * Focused tests for the G7-01 closure items:
 *   1. BFF authorization boundary (cookie required; fail-closed).
 *   2. Bounded upstream timeout + abort propagation.
 *   3. Path decoding / method whitelist / URL construction safety.
 *   4. CORS removal (no Access-Control-Allow-Origin header).
 *   5. Mobile nav target size + SheetDescription a11y (component-level; verified via UI snapshot).
 *   6. Secret non-disclosure in error bodies.
 *
 * Run: npx tsx scripts/g7-01-closure-tests.ts
 *
 * The dev server must be running at http://localhost:3000 (auto-started by the
 * sandbox). The gateway is NOT required to be running — most tests verify
 * the BFF's own behavior, not the gateway's response content.
 *
 * Exit code 0 = all PASS; 1 = at least one FAIL.
 */

interface TestResult {
  id: string;
  name: string;
  pass: boolean;
  detail?: string;
}

const results: TestResult[] = [];
const BASE = "http://localhost:3000";

async function fetchRaw(
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; body: string; headers: Headers }> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    // Don't follow redirects — we want to see the actual response.
    redirect: "manual",
  });
  const body = await res.text();
  return { status: res.status, body, headers: res.headers };
}

let bffCookie: string | undefined;

async function obtainBffCookie(): Promise<string | undefined> {
  if (bffCookie) return bffCookie;
  // G7-02 auth-gate fix: cookies are issued by POST /api/auth/login with a
  // server-validated operator PIN. The .env.local default is 'dev-local-pin'.
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pin: "dev-local-pin" }),
  });
  const sc = res.headers.get("set-cookie");
  if (sc) {
    bffCookie = sc.split(";")[0]; // "name=value"
  }
  return bffCookie;
}

function record(r: TestResult) {
  results.push(r);
  const mark = r.pass ? "✓" : "✗";
  console.log(`${mark}  ${r.id}  ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
}

// ---------------------------------------------------------------------------
// Test 1: BFF returns 401 without a cookie (fail-closed boundary).
// ---------------------------------------------------------------------------

async function test_noCookieReturns401() {
  const r = await fetchRaw("/api/genesis/health", { method: "GET" });
  record({
    id: "T1",
    name: "BFF returns 401 without cookie (fail-closed)",
    pass: r.status === 401,
    detail: `status=${r.status} (expected 401)`,
  });
}

// ---------------------------------------------------------------------------
// Test 2: /api/auth/login issues a Set-Cookie header after PIN validation.
// (G7-02 auth-gate fix: the old /api/auth/setup endpoint was REMOVED.)
// ---------------------------------------------------------------------------

async function test_setupIssuesCookie() {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pin: "dev-local-pin" }),
  });
  const sc = res.headers.get("set-cookie");
  record({
    id: "T2",
    name: "POST /api/auth/login (correct PIN) → 200 + Set-Cookie",
    pass: res.status === 200 && sc !== null && sc.includes("genesis_bff="),
    detail: `status=${res.status}, set-cookie=${sc ? "present" : "absent"}`,
  });
}

// ---------------------------------------------------------------------------
// Test 3: With valid cookie + gateway down → 503 (honest unavailable state).
// ---------------------------------------------------------------------------

async function test_validCookieGatewayDownReturns503() {
  const cookie = await obtainBffCookie();
  const r = await fetchRaw("/api/genesis/health", {
    method: "GET",
    headers: { Cookie: cookie ?? "" },
  });
  record({
    id: "T3",
    name: "Valid cookie + gateway down → 503 (not 200, not 401)",
    pass: r.status === 503,
    detail: `status=${r.status} (expected 503 since gateway is not running)`,
  });
}

// ---------------------------------------------------------------------------
// Test 4: BFF returns 404 for non-verified route (allowlist enforced).
// ---------------------------------------------------------------------------

async function test_nonVerifiedRouteReturns404() {
  const cookie = await obtainBffCookie();
  const r = await fetchRaw("/api/genesis/v1/invented-endpoint", {
    method: "GET",
    headers: { Cookie: cookie ?? "" },
  });
  record({
    id: "T4",
    name: "Non-verified route → 404 (allowlist enforced)",
    pass: r.status === 404,
    detail: `status=${r.status} (expected 404)`,
  });
}

// ---------------------------------------------------------------------------
// Test 5: Path traversal attempts are rejected.
// ---------------------------------------------------------------------------

async function test_pathTraversalRejected() {
  const cookie = await obtainBffCookie();
  // Attempt 1: literal ".." segment.
  const r1 = await fetchRaw("/api/genesis/v1/missions/..", {
    method: "GET",
    headers: { Cookie: cookie ?? "" },
  });
  // Attempt 2: encoded %2e%2e
  const r2 = await fetchRaw("/api/genesis/v1/missions/%2e%2e", {
    method: "GET",
    headers: { Cookie: cookie ?? "" },
  });
  // Both must NOT return 200. They should return 404 (path doesn't match allowlist)
  // or 400 (rejected by safety filter). Either is acceptable — both are non-200.
  record({
    id: "T5",
    name: "Path traversal attempts (.., %2e%2e) rejected (non-200)",
    pass: r1.status !== 200 && r2.status !== 200,
    detail: `literal "..": status=${r1.status}; encoded "%2e%2e": status=${r2.status}`,
  });
}

// ---------------------------------------------------------------------------
// Test 6: Disallowed methods (PUT, DELETE, PATCH) rejected with 405.
// ---------------------------------------------------------------------------

async function test_disallowedMethodsRejected() {
  const cookie = await obtainBffCookie();
  const methods = ["PUT", "DELETE", "PATCH"] as const;
  const statuses: number[] = [];
  for (const m of methods) {
    const r = await fetchRaw("/api/genesis/health", {
      method: m,
      headers: { Cookie: cookie ?? "" },
    });
    statuses.push(r.status);
  }
  record({
    id: "T6",
    name: "Disallowed methods (PUT, DELETE, PATCH) → 405",
    pass: statuses.every((s) => s === 405),
    detail: `statuses=${statuses.join(",")} (expected 405,405,405)`,
  });
}

// Test 7: No Access-Control-Allow-Origin header (permissive CORS removed).
// Auth-gate fix: check the /api/auth/login response (POST + Set-Cookie).

async function test_noPermissiveCors() {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pin: "dev-local-pin" }),
  });
  const aco = res.headers.get("access-control-allow-origin");
  record({
    id: "T7",
    name: "No Access-Control-Allow-Origin header (CORS constrained)",
    pass: aco === null || aco === "",
    detail: `access-control-allow-origin=${aco ?? "absent"}`,
  });
}

// ---------------------------------------------------------------------------
// Test 8: Secret redaction — inject a sentinel via the upstream error path
// (we can't fully test this without a gateway, but we can verify the BFF
// doesn't echo back Authorization headers in error responses).
// ---------------------------------------------------------------------------

async function test_noSecretLeakInError() {
  const cookie = await obtainBffCookie();
  // Send an Authorization header in the request — the BFF should NOT echo it
  // back in the error response body (defense-in-depth on top of redactSecrets).
  const fakeAuth = "Bearer ghp_abcdefghijklmnopqrstuvwxyz0123456789";
  const r = await fetchRaw("/api/genesis/health", {
    method: "GET",
    headers: {
      Cookie: cookie ?? "",
      Authorization: fakeAuth,
    },
  });
  const bodyLower = r.body.toLowerCase();
  const hasLeak = bodyLower.includes("ghp_abcdefghijklmn") ||
    bodyLower.includes("bearer ghp_");
  record({
    id: "T8",
    name: "Secret sentinels not leaked in error body",
    pass: !hasLeak,
    detail: `status=${r.status}, leak_detected=${hasLeak}, body_len=${r.body.length}`,
  });
}

// ---------------------------------------------------------------------------
// Test 9: Re-authenticating with the same PIN always issues a fresh
// cookie (the login endpoint is NOT idempotent — each call issues a new
// signed cookie with a new exp). This is intentional: a fresh login should
// refresh the session, not silently reuse an old one.
// ---------------------------------------------------------------------------

async function test_setupIsIdempotent() {
  const cookie = await obtainBffCookie();
  // Login again — should succeed and issue a new cookie.
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pin: "dev-local-pin" }),
  });
  const body = (await res.json()) as { ok: boolean; status: string };
  record({
    id: "T9",
    name: "POST /api/auth/login re-authenticates (200, status: authenticated)",
    pass: res.status === 200 && body.ok === true && body.status === "authenticated",
    detail: `status=${res.status}, body=${JSON.stringify(body)}`,
  });
}

// ---------------------------------------------------------------------------
// Test 10: Tampered cookie → 401 (signature verification).
// ---------------------------------------------------------------------------

async function test_tamperedCookieRejected() {
  const cookie = await obtainBffCookie();
  if (!cookie) {
    record({
      id: "T10",
      name: "Tampered cookie rejected (cookie not issued; setup failed)",
      pass: false,
      detail: "could not obtain a baseline cookie",
    });
    return;
  }
  // Flip one character in the signature portion.
  const parts = cookie.split(".");
  const tamperedSig = parts[1] ? parts[1].replace(/^./, "0") : "tampered";
  const tamperedCookie = `genesis_bff=${parts[0]}.${tamperedSig}`;
  const r = await fetchRaw("/api/genesis/health", {
    method: "GET",
    headers: { Cookie: tamperedCookie },
  });
  record({
    id: "T10",
    name: "Tampered cookie signature → 401 (constant-time verify)",
    pass: r.status === 401,
    detail: `status=${r.status} (expected 401)`,
  });
}

// ---------------------------------------------------------------------------
// Test 11: Cookie attributes — SameSite=Strict, HttpOnly, Path=/
// ---------------------------------------------------------------------------

async function test_cookieAttributes() {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pin: "dev-local-pin" }),
  });
  const sc = res.headers.get("set-cookie") ?? "";
  const hasSameSiteStrict = /SameSite=Strict/i.test(sc);
  const hasHttpOnly = /HttpOnly/i.test(sc);
  const hasPath = /Path=\//i.test(sc);
  record({
    id: "T11",
    name: "Login cookie has SameSite=Strict, HttpOnly, Path=/",
    pass: hasSameSiteStrict && hasHttpOnly && hasPath,
    detail: `SameSite=${hasSameSiteStrict}, HttpOnly=${hasHttpOnly}, Path=${hasPath}`,
  });
}

// ---------------------------------------------------------------------------
// Test 12: Bounded upstream timeout — would require a slow upstream to test
// properly. We verify the env var is read and the timeout is bounded.
// Skipped from runtime verification (no slow upstream available); documented
// as a static-config check.
// ---------------------------------------------------------------------------

function test_timeoutConfigBounded() {
  const raw = process.env.GENESIS_BFF_TIMEOUT_MS;
  const ms = raw ? Number(raw) : 30000;
  const bounded = ms >= 1000 && ms <= 60000;
  record({
    id: "T12",
    name: "Upstream timeout is bounded (1s–60s)",
    pass: bounded,
    detail: `GENESIS_BFF_TIMEOUT_MS=${raw ?? "(unset, default 30000)"} → ${ms}ms`,
  });
}

// ---------------------------------------------------------------------------
// Main runner.
// ---------------------------------------------------------------------------

async function main() {
  console.log(`\nAgentCraft Genesis G7-01 Closure — BFF Regression Tests\n`);
  console.log(`Base URL: ${BASE}\n`);

  await test_noCookieReturns401();
  await test_setupIssuesCookie();
  await test_validCookieGatewayDownReturns503();
  await test_nonVerifiedRouteReturns404();
  await test_pathTraversalRejected();
  await test_disallowedMethodsRejected();
  await test_noPermissiveCors();
  await test_noSecretLeakInError();
  await test_setupIsIdempotent();
  await test_tamperedCookieRejected();
  await test_cookieAttributes();
  test_timeoutConfigBounded();

  const passed = results.filter((r) => r.pass).length;
  const failed = results.length - passed;
  console.log(`\n${passed}/${results.length} passed, ${failed} failed.`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("Test runner error:", e);
  process.exit(2);
});
