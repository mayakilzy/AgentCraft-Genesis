/**
 * AgentCraft Genesis G7-15A — Rate-limit unit tests.
 *
 * Tests the pure logic of the in-memory rate limiter WITHOUT HTTP. The
 * limiter module is `web/src/lib/auth/rate-limit.ts`; only its pure-logic
 * functions are exercised here (the `getRateLimitKey(req)` function takes
 * a `NextRequest` and is covered by the integration test in
 * `scripts/g7-15a-auth-security-tests.cjs`).
 *
 * Run: npx tsx scripts/g7-15a-rate-limit-unit-tests.ts
 */

import {
  clearRateLimit,
  getRateLimitKey,
  getRateLimitStateForTests,
  isRateLimited,
  recordFailedAttempt,
  resetRateLimiterForTests,
  RATE_LIMIT_CONFIG,
} from "../web/src/lib/auth/rate-limit";

interface TestResult {
  id: string;
  name: string;
  pass: boolean;
  detail?: string;
}

const results: TestResult[] = [];

function record(r: TestResult) {
  results.push(r);
  const mark = r.pass ? "✓" : "✗";
  console.log(`${mark}  ${r.id}  ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
}

// ---------------------------------------------------------------------------
// RL-01: empty limiter never rate-limits
// ---------------------------------------------------------------------------
function rl01_emptyLimiterNeverLimits() {
  resetRateLimiterForTests();
  const actual = isRateLimited("any-key");
  record({
    id: "RL-01",
    name: "empty limiter never rate-limits",
    pass: actual === false,
    detail: `isRateLimited=${actual}`,
  });
}

// ---------------------------------------------------------------------------
// RL-02: under the limit — record N-1 attempts, NOT rate-limited
// ---------------------------------------------------------------------------
function rl02_underLimitNotLimited() {
  resetRateLimiterForTests();
  const now = 1_000_000;
  for (let i = 0; i < RATE_LIMIT_CONFIG.maxAttempts - 1; i++) {
    const over = recordFailedAttempt("k", now + i);
    if (over) {
      record({
        id: "RL-02",
        name: "under the limit — not rate-limited",
        pass: false,
        detail: `recordFailedAttempt returned over=true at i=${i}`,
      });
      return;
    }
  }
  const limited = isRateLimited("k", now + 999);
  record({
    id: "RL-02",
    name: "under the limit — not rate-limited",
    pass: limited === false,
    detail: `isRateLimited=${limited} (maxAttempts=${RATE_LIMIT_CONFIG.maxAttempts})`,
  });
}

// ---------------------------------------------------------------------------
// RL-03: at the limit — 5 attempts → next check rate-limited
// ---------------------------------------------------------------------------
function rl03_atLimitRateLimited() {
  resetRateLimiterForTests();
  const now = 2_000_000;
  for (let i = 0; i < RATE_LIMIT_CONFIG.maxAttempts; i++) {
    recordFailedAttempt("k", now + i);
  }
  const limited = isRateLimited("k", now + 999);
  record({
    id: "RL-03",
    name: "at the limit — rate-limited",
    pass: limited === true,
    detail: `isRateLimited=${limited}`,
  });
}

// ---------------------------------------------------------------------------
// RL-04: sliding window — old timestamps expire
// ---------------------------------------------------------------------------
function rl04_slidingWindowExpires() {
  resetRateLimiterForTests();
  const t0 = 3_000_000;
  // 5 attempts at t0
  for (let i = 0; i < RATE_LIMIT_CONFIG.maxAttempts; i++) {
    recordFailedAttempt("k", t0);
  }
  // Confirm rate-limited
  if (!isRateLimited("k", t0 + 1_000)) {
    record({ id: "RL-04", name: "sliding window expires old timestamps", pass: false, detail: "not limited immediately after 5 attempts" });
    return;
  }
  // Advance past the window
  const after = t0 + RATE_LIMIT_CONFIG.windowMs + 1;
  const limited = isRateLimited("k", after);
  record({
    id: "RL-04",
    name: "sliding window expires old timestamps",
    pass: limited === false,
    detail: `isRateLimited after windowMs=${limited} (window=${RATE_LIMIT_CONFIG.windowMs}ms)`,
  });
}

// ---------------------------------------------------------------------------
// RL-05: clearRateLimit removes the bucket
// ---------------------------------------------------------------------------
function rl05_clearRateLimit() {
  resetRateLimiterForTests();
  const now = 4_000_000;
  for (let i = 0; i < RATE_LIMIT_CONFIG.maxAttempts; i++) {
    recordFailedAttempt("k", now + i);
  }
  if (!isRateLimited("k", now + 999)) {
    record({ id: "RL-05", name: "clearRateLimit removes the bucket", pass: false, detail: "setup: not limited" });
    return;
  }
  clearRateLimit("k");
  const limited = isRateLimited("k", now + 1_000);
  record({
    id: "RL-05",
    name: "clearRateLimit removes the bucket",
    pass: limited === false,
    detail: `isRateLimited after clear=${limited}`,
  });
}

// ---------------------------------------------------------------------------
// RL-06: independent keys — one bucket overflowing does NOT affect another
// ---------------------------------------------------------------------------
function rl06_independentKeys() {
  resetRateLimiterForTests();
  const now = 5_000_000;
  for (let i = 0; i < RATE_LIMIT_CONFIG.maxAttempts; i++) {
    recordFailedAttempt("attacker", now + i);
  }
  // A different key should NOT be rate-limited
  const otherLimited = isRateLimited("other", now + 999);
  record({
    id: "RL-06",
    name: "independent keys — overflow on one does not affect another",
    pass: otherLimited === false,
    detail: `isRateLimited(other)=${otherLimited}`,
  });
}

// ---------------------------------------------------------------------------
// RL-07: getRateLimitKey with NO trusted-proxy env → "default"
// (Header-trust bypass test — the spec's "Prevent untrusted client-supplied
// headers from bypassing the limiter" requirement.)
// ---------------------------------------------------------------------------
function rl07_noTrustedProxyHeaderReturnsDefault() {
  const saved = process.env.GENESIS_TRUSTED_PROXY_HEADER;
  delete process.env.GENESIS_TRUSTED_PROXY_HEADER;
  try {
    // Construct a fake request-like object with forged X-Forwarded-For.
    // The limiter should IGNORE it and return "default".
    const fakeReq = {
      headers: new Headers({
        "x-forwarded-for": "1.2.3.4, 5.6.7.8",
        "x-real-ip": "9.9.9.9",
      }),
    } as unknown as import("next/server").NextRequest;
    const key = getRateLimitKey(fakeReq);
    record({
      id: "RL-07",
      name: "no trusted-proxy env → ignores forged forwarding headers → 'default'",
      pass: key === "default",
      detail: `key=${key} (forged X-Forwarded-For and X-Real-IP present but not trusted)`,
    });
  } finally {
    if (saved !== undefined) process.env.GENESIS_TRUSTED_PROXY_HEADER = saved;
  }
}

// ---------------------------------------------------------------------------
// RL-08: getRateLimitKey WITH trusted-proxy env reads ONLY that header
// (the operator has explicitly configured X-Real-IP; the limiter trusts it)
// ---------------------------------------------------------------------------
function rl08_trustedProxyHeaderReadsIt() {
  const saved = process.env.GENESIS_TRUSTED_PROXY_HEADER;
  process.env.GENESIS_TRUSTED_PROXY_HEADER = "X-Real-IP";
  try {
    const fakeReq = {
      headers: new Headers({
        "x-real-ip": "10.0.0.5",
        // Forged X-Forwarded-For should be IGNORED — only X-Real-IP is trusted.
        "x-forwarded-for": "1.2.3.4, 5.6.7.8",
      }),
    } as unknown as import("next/server").NextRequest;
    const key = getRateLimitKey(fakeReq);
    record({
      id: "RL-08",
      name: "trusted-proxy env set → reads ONLY that header (forged X-Forwarded-For ignored)",
      pass: key === "10.0.0.5",
      detail: `key=${key}`,
    });
  } finally {
    if (saved !== undefined) process.env.GENESIS_TRUSTED_PROXY_HEADER = saved;
    else delete process.env.GENESIS_TRUSTED_PROXY_HEADER;
  }
}

// ---------------------------------------------------------------------------
// RL-09: trusted-proxy env set but header absent → falls back to "default"
// (fail-safe, not fail-open)
// ---------------------------------------------------------------------------
function rl09_trustedProxyHeaderAbsentFallsBackToDefault() {
  const saved = process.env.GENESIS_TRUSTED_PROXY_HEADER;
  process.env.GENESIS_TRUSTED_PROXY_HEADER = "X-Real-IP";
  try {
    const fakeReq = {
      headers: new Headers({
        // No X-Real-IP — direct local access bypassing the proxy.
        "x-forwarded-for": "1.2.3.4",
      }),
    } as unknown as import("next/server").NextRequest;
    const key = getRateLimitKey(fakeReq);
    record({
      id: "RL-09",
      name: "trusted-proxy env set but header absent → falls back to 'default' (fail-safe)",
      pass: key === "default",
      detail: `key=${key}`,
    });
  } finally {
    if (saved !== undefined) process.env.GENESIS_TRUSTED_PROXY_HEADER = saved;
    else delete process.env.GENESIS_TRUSTED_PROXY_HEADER;
  }
}

// ---------------------------------------------------------------------------
// RL-10: getRateLimitKey truncates long header values (memory bound)
// ---------------------------------------------------------------------------
function rl10_truncatesLongHeader() {
  const saved = process.env.GENESIS_TRUSTED_PROXY_HEADER;
  process.env.GENESIS_TRUSTED_PROXY_HEADER = "X-Real-IP";
  try {
    const longIp = "a".repeat(200);
    const fakeReq = {
      headers: new Headers({ "x-real-ip": longIp }),
    } as unknown as import("next/server").NextRequest;
    const key = getRateLimitKey(fakeReq);
    record({
      id: "RL-10",
      name: "long trusted-header value truncated to ≤64 chars",
      pass: key.length === 64,
      detail: `key.length=${key.length}`,
    });
  } finally {
    if (saved !== undefined) process.env.GENESIS_TRUSTED_PROXY_HEADER = saved;
    else delete process.env.GENESIS_TRUSTED_PROXY_HEADER;
  }
}

// ---------------------------------------------------------------------------
// RL-11: recordFailedAttempt returns true exactly when the limit is reached
// ---------------------------------------------------------------------------
function rl11_recordReturnsTrueAtLimit() {
  resetRateLimiterForTests();
  const now = 6_000_000;
  let overAtN: number | null = null;
  for (let i = 0; i < RATE_LIMIT_CONFIG.maxAttempts + 1; i++) {
    const over = recordFailedAttempt("k", now + i);
    if (over && overAtN === null) overAtN = i + 1; // 1-indexed
  }
  record({
    id: "RL-11",
    name: "recordFailedAttempt returns over=true exactly at maxAttempts",
    pass: overAtN === RATE_LIMIT_CONFIG.maxAttempts,
    detail: `over=true at attempt ${overAtN} (expected ${RATE_LIMIT_CONFIG.maxAttempts})`,
  });
}

// ---------------------------------------------------------------------------
// RL-12: bucket state inspection (defense-in-depth — verifies cleanup)
// ---------------------------------------------------------------------------
function rl12_stateInspection() {
  resetRateLimiterForTests();
  const now = 7_000_000;
  recordFailedAttempt("a", now);
  recordFailedAttempt("a", now);
  recordFailedAttempt("b", now);
  const state = getRateLimitStateForTests();
  const aBucket = state.get("a");
  const bBucket = state.get("b");
  record({
    id: "RL-12",
    name: "getRateLimitStateForTests returns current state",
    pass: aBucket?.length === 2 && bBucket?.length === 1 && state.size === 2,
    detail: `a=${aBucket?.length}, b=${bBucket?.length}, size=${state.size}`,
  });
}

// ---------------------------------------------------------------------------
// Run all tests
// ---------------------------------------------------------------------------
function run() {
  console.log("=== G7-15A rate-limit unit tests ===");
  rl01_emptyLimiterNeverLimits();
  rl02_underLimitNotLimited();
  rl03_atLimitRateLimited();
  rl04_slidingWindowExpires();
  rl05_clearRateLimit();
  rl06_independentKeys();
  rl07_noTrustedProxyHeaderReturnsDefault();
  rl08_trustedProxyHeaderReadsIt();
  rl09_trustedProxyHeaderAbsentFallsBackToDefault();
  rl10_truncatesLongHeader();
  rl11_recordReturnsTrueAtLimit();
  rl12_stateInspection();
  resetRateLimiterForTests();

  const passed = results.filter((r) => r.pass).length;
  const failed = results.length - passed;
  console.log(`\n${passed}/${results.length} PASS, ${failed} FAIL`);
  if (failed > 0) {
    console.log("\nFAILURES:");
    for (const r of results.filter((r) => !r.pass)) {
      console.log(`  ${r.id}: ${r.detail ?? r.name}`);
    }
    process.exit(1);
  }
}

run();
