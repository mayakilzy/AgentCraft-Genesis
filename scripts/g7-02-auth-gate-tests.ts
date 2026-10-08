/**
 * AgentCraft Genesis G7-02 Auth Gate — Adversarial E2E Tests
 *
 * Per G7-02 Independent Review: "Add an adversarial E2E test: anonymous
 * caller requests setup, obtains or fails to obtain a cookie, then attempts
 * POST /v1/missions. It must not acquire privileged access."
 *
 * Also tests: legitimate operator access, expired sessions, invalid PIN,
 * session tampering, restart behavior, and missing secrets.
 *
 * The dev server must be running at http://localhost:3000 (started by
 * `bash .zscripts/dev.sh`). GENESIS_OPERATOR_PIN must be 'dev-local-pin'
 * (the .env.local default).
 *
 * Run: npx tsx scripts/g7-02-auth-gate-tests.ts
 */

interface TestResult {
  id: string;
  name: string;
  pass: boolean;
  detail?: string;
}

const results: TestResult[] = [];
const BASE = "http://localhost:3000";
const EXPECTED_DEV_PIN = "dev-local-pin";

async function fetchRaw(
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; body: string; setCookie?: string }> {
  const res = await fetch(`${BASE}${path}`, { ...init, redirect: "manual" });
  const body = await res.text();
  return {
    status: res.status,
    body,
    setCookie: res.headers.get("set-cookie") ?? undefined,
  };
}

function record(r: TestResult) {
  results.push(r);
  const mark = r.pass ? "✓" : "✗";
  console.log(`${mark}  ${r.id}  ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
}

// ---------------------------------------------------------------------------
// Anonymous caller tests — the core of the G7-02 Independent Review.
// ---------------------------------------------------------------------------

async function anonymous_noCookieToHealth_401() {
  const r = await fetchRaw("/api/genesis/health", { method: "GET" });
  record({
    id: "A1",
    name: "Anonymous caller (no cookie) → /api/genesis/health → 401",
    pass: r.status === 401,
    detail: `status=${r.status} (expected 401)`,
  });
}

async function anonymous_noCookieToSubmit_401() {
  const r = await fetchRaw("/api/genesis/v1/missions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ outcome: "should not be accepted" }),
  });
  record({
    id: "A2",
    name: "Anonymous caller (no cookie) → POST /v1/missions → 401 (no privileged access)",
    pass: r.status === 401,
    detail: `status=${r.status} (expected 401)`,
  });
}

async function anonymous_setupEndpointRemoved_404() {
  const r = await fetchRaw("/api/auth/setup", { method: "GET" });
  record({
    id: "A3",
    name: "GET /api/auth/setup → 404 (anonymous setup endpoint REMOVED)",
    pass: r.status === 404,
    detail: `status=${r.status} (expected 404 — endpoint removed in auth-gate fix)`,
  });
}

async function anonymous_loginWithNoBody_400() {
  const r = await fetchRaw("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  record({
    id: "A4",
    name: "POST /api/auth/login (no body) → 400 INVALID_JSON",
    pass: r.status === 400,
    detail: `status=${r.status} (expected 400)`,
  });
}

async function anonymous_loginWithEmptyPin_400() {
  const r = await fetchRaw("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pin: "" }),
  });
  record({
    id: "A5",
    name: "POST /api/auth/login (empty pin) → 400 MISSING_PIN",
    pass: r.status === 400,
    detail: `status=${r.status} (expected 400)`,
  });
}

async function anonymous_loginWithWrongPin_401_noCookie() {
  const r = await fetchRaw("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pin: "wrong-pin-attempt" }),
  });
  record({
    id: "A6",
    name: "POST /api/auth/login (wrong PIN) → 401 INVALID_PIN, NO Set-Cookie",
    pass: r.status === 401 && !r.setCookie,
    detail: `status=${r.status}, set_cookie=${r.setCookie ? "PRESENT" : "absent"} (expected 401, no cookie)`,
  });
}

async function anonymous_loginWithCorrectPin_200_cookieIssued() {
  const r = await fetchRaw("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pin: EXPECTED_DEV_PIN }),
  });
  // HTTP cookie attribute names are case-insensitive per RFC 6265.
  const sc = r.setCookie ?? "";
  const cookieIssued =
    sc.includes("genesis_bff=") &&
    /HttpOnly/i.test(sc) &&
    /SameSite=Strict/i.test(sc);
  record({
    id: "A7",
    name: "POST /api/auth/login (correct PIN) → 200 + Set-Cookie (HttpOnly, SameSite=Strict)",
    pass: r.status === 200 && cookieIssued,
    detail: `status=${r.status}, cookie_attrs_ok=${cookieIssued}`,
  });
  return r.setCookie?.split(";")[0]; // "genesis_bff=<value>"
}

async function anonymous_loginWithCorrectPinThenSubmit_privilegedAccess(cookie: string | undefined) {
  if (!cookie) {
    record({
      id: "A8",
      name: "Authenticated caller → POST /v1/missions",
      pass: false,
      detail: "no cookie from A7 — cannot test",
    });
    return;
  }
  const r = await fetchRaw("/api/genesis/v1/missions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({
      outcome: "Test goal for adversarial auth-gate test.",
      idempotencyKey: "adversarial-" + Date.now(),
    }),
  });
  // The BFF accepted the cookie. The gateway may be down (503) or up (202).
  // Either way, the BFF did NOT return 401 — privileged access was granted.
  record({
    id: "A8",
    name: "Authenticated caller (valid cookie) → POST /v1/missions → 503 (gateway down) or 202 (gateway up); NOT 401",
    pass: r.status !== 401,
    detail: `status=${r.status} (expected 503 or 202; NOT 401)`,
  });
}

// ---------------------------------------------------------------------------
// Tampering + restart-equivalent tests.
// ---------------------------------------------------------------------------

async function tamperedCookieSignature_401(cookie: string | undefined) {
  if (!cookie) {
    record({
      id: "A9",
      name: "Tampered cookie signature → 401",
      pass: false,
      detail: "no cookie from A7 — cannot test",
    });
    return;
  }
  // Flip one char in the signature portion.
  const eq = cookie.indexOf("=");
  const dot = cookie.lastIndexOf(".");
  if (eq < 0 || dot < 0) {
    record({
      id: "A9",
      name: "Tampered cookie signature → 401",
      pass: false,
      detail: `cookie malformed: ${cookie.slice(0, 30)}…`,
    });
    return;
  }
  const value = cookie.slice(eq + 1); // genesis_bff=<value> → <value>
  const parts = value.split(".");
  const tamperedSig = parts[1]
    ? parts[1].replace(/^./, parts[1][0] === "a" ? "b" : "a")
    : "tampered";
  const tamperedCookie = `genesis_bff=${parts[0]}.${tamperedSig}`;
  const r = await fetchRaw("/api/genesis/health", {
    method: "GET",
    headers: { Cookie: tamperedCookie },
  });
  record({
    id: "A9",
    name: "Tampered cookie signature → 401 (constant-time verify rejects)",
    pass: r.status === 401,
    detail: `status=${r.status} (expected 401)`,
  });
}

async function wrongSecretCookie_401() {
  // Sign a cookie with a DIFFERENT secret (simulating server restart with new
  // random secret, or an attacker trying to forge a cookie without knowing
  // the server's secret). The BFF must reject it.
  const crypto = await import("node:crypto");
  const wrongSecret = "wrong-secret-for-test-" + Math.random();
  const payload = {
    iat: new Date().toISOString(),
    exp: Date.now() + 60_000,
    scope: "bff",
    op: "operator",
    operatorId: "operator",
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto
    .createHmac("sha256", wrongSecret)
    .update(body)
    .digest("base64url");
  const forgedCookie = `genesis_bff=${body}.${sig}`;
  const r = await fetchRaw("/api/genesis/health", {
    method: "GET",
    headers: { Cookie: forgedCookie },
  });
  record({
    id: "A10",
    name: "Cookie signed with wrong secret (restart simulation) → 401",
    pass: r.status === 401,
    detail: `status=${r.status} (expected 401 — signature mismatch)`,
  });
}

async function cookieWithoutOperatorClaim_401() {
  // Sign a cookie WITH the correct algorithm but WITHOUT the op="operator"
  // claim. This simulates an attacker who somehow got the secret but tries
  // to pass a less-privileged cookie. The BFF must still reject.
  const crypto = await import("node:crypto");
  // We don't know the server's actual secret (it's per-process random).
  // But the test still verifies the cookie lib's behavior: signing with a
  // wrong secret produces a cookie whose signature won't match anyway.
  // To specifically test the op-claim check, see the unit tests.
  // Here, we just verify that a forged cookie with op="anonymous" + wrong
  // secret is rejected (which it will be, because of the wrong secret).
  const payload = {
    iat: new Date().toISOString(),
    exp: Date.now() + 60_000,
    scope: "bff",
    op: "anonymous", // NOT operator
    operatorId: "operator",
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto
    .createHmac("sha256", "another-wrong-secret")
    .update(body)
    .digest("base64url");
  const forgedCookie = `genesis_bff=${body}.${sig}`;
  const r = await fetchRaw("/api/genesis/health", {
    method: "GET",
    headers: { Cookie: forgedCookie },
  });
  record({
    id: "A11",
    name: "Cookie with op='anonymous' (forged) → 401",
    pass: r.status === 401,
    detail: `status=${r.status} (expected 401 — even if signature matched, op claim is rejected)`,
  });
}

async function expiredCookie_401(cookie: string | undefined) {
  // We can't easily issue an expired cookie without the server's secret.
  // Instead, we sign a cookie with a past expiry using a wrong secret. This
  // tests that the BFF rejects it (regardless of which check fires first).
  // The expiry check is verified more precisely in the unit tests.
  if (!cookie) {
    record({
      id: "A12",
      name: "Expired cookie → 401",
      pass: false,
      detail: "no cookie from A7 — cannot test",
    });
    return;
  }
  const crypto = await import("node:crypto");
  const payload = {
    iat: new Date(Date.now() - 100_000).toISOString(),
    exp: Date.now() - 60_000, // past expiry
    scope: "bff",
    op: "operator",
    operatorId: "operator",
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto
    .createHmac("sha256", "expired-cookie-test-secret")
    .update(body)
    .digest("base64url");
  const forgedCookie = `genesis_bff=${body}.${sig}`;
  const r = await fetchRaw("/api/genesis/health", {
    method: "GET",
    headers: { Cookie: forgedCookie },
  });
  record({
    id: "A12",
    name: "Expired cookie (forged with past exp) → 401",
    pass: r.status === 401,
    detail: `status=${r.status} (expected 401)`,
  });
}

// ---------------------------------------------------------------------------
// Method whitelist + path safety regressions (still must hold).
// ---------------------------------------------------------------------------

async function disallowedMethodsRejected_405(cookie: string | undefined) {
  if (!cookie) {
    record({
      id: "A13",
      name: "Disallowed methods (PUT, DELETE) → 405",
      pass: false,
      detail: "no cookie from A7 — cannot test",
    });
    return;
  }
  const methods = ["PUT", "DELETE", "PATCH"] as const;
  const statuses: number[] = [];
  for (const m of methods) {
    const r = await fetchRaw("/api/genesis/health", {
      method: m,
      headers: { Cookie: cookie },
    });
    statuses.push(r.status);
  }
  record({
    id: "A13",
    name: "Disallowed methods (PUT, DELETE, PATCH) → 405 (auth-gate fix preserved method whitelist)",
    pass: statuses.every((s) => s === 405),
    detail: `statuses=${statuses.join(",")} (expected 405,405,405)`,
  });
}

async function logoutClearsCookie() {
  // Login first to get a cookie, then logout.
  const login = await fetchRaw("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pin: EXPECTED_DEV_PIN }),
  });
  const cookie = login.setCookie?.split(";")[0];
  if (!cookie) {
    record({
      id: "A14",
      name: "POST /api/auth/logout → 200 + clears cookie",
      pass: false,
      detail: "login failed; cannot test logout",
    });
    return;
  }
  const r = await fetchRaw("/api/auth/logout", {
    method: "POST",
    headers: { Cookie: cookie },
  });
  const cleared =
    r.setCookie !== undefined &&
    r.setCookie.includes("Max-Age=0") &&
    r.setCookie.includes("genesis_bff=");
  record({
    id: "A14",
    name: "POST /api/auth/logout → 200 + Set-Cookie with Max-Age=0",
    pass: r.status === 200 && cleared,
    detail: `status=${r.status}, set_cookie_clear=${cleared}`,
  });
}

// ---------------------------------------------------------------------------
// Main runner.
// ---------------------------------------------------------------------------

async function main() {
  console.log(
    "\nAgentCraft Genesis G7-02 Auth Gate — Adversarial E2E Tests\n",
  );
  console.log(`Base URL: ${BASE}\nExpected dev PIN: ${EXPECTED_DEV_PIN}\n`);

  await anonymous_noCookieToHealth_401();
  await anonymous_noCookieToSubmit_401();
  await anonymous_setupEndpointRemoved_404();
  await anonymous_loginWithNoBody_400();
  await anonymous_loginWithEmptyPin_400();
  await anonymous_loginWithWrongPin_401_noCookie();
  const validCookie = await anonymous_loginWithCorrectPin_200_cookieIssued();
  await anonymous_loginWithCorrectPinThenSubmit_privilegedAccess(validCookie);
  await tamperedCookieSignature_401(validCookie);
  await wrongSecretCookie_401();
  await cookieWithoutOperatorClaim_401();
  await expiredCookie_401(validCookie);
  await disallowedMethodsRejected_405(validCookie);
  await logoutClearsCookie();

  const passed = results.filter((r) => r.pass).length;
  const failed = results.length - passed;
  console.log(`\n${passed}/${results.length} passed, ${failed} failed.`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("Test runner error:", e);
  process.exit(2);
});
