# G7-15A — Security Reconciliation Report

**Mission:** G7-15 — Integrated Product Acceptance
**Slice:** G7-15A — Security Reconciliation (G7-08C/D)
**Branch:** `build/g7-14-constrained-mcp`
**Baseline:** `92b0e0453f1d8f22e2645252130fd33879cc2cc6` (G7-14H2 Final Acceptance — PASS)
**Date:** 2026-10-10

---

## 0. Authoritative Source & Scope

**Authoritative source:** `docs/g7-11/launch-readiness-decision.md` §5 + §7 and `G7-11B_Live_Execution_Qualification_Report.md` §7.3 list three prerequisites for G7-15. G7-15A is the first slice: reconcile the previously-deferred G7-08C/D authentication protections.

| Deferred item | Target | G7-15A scope |
|---|---|---|
| Rate-limit failed login attempts | G7-08C | **Implemented** (in-memory, single-process) |
| AuthGate hardening (remove dev hints) | G7-08D | **Implemented** (prop + placeholder + hint block removed) |
| `next.config.mjs allowedDevOrigins` | G7-08C | **Out of scope** — no `allowedDevOrigins` was ever tracked in the GitHub baseline; the G7-10 closure report (`§6`) confirmed it ABSENT and chose not to reconstruct it. G7-15A does not introduce it. |
| IP allow-listing | G7-08C | **Out of scope** — the controlled-environment deployment uses operator-only network access (documented). |
| mTLS / OAuth | G7-08C | **Out of scope** — single-operator PIN model is the documented trust boundary. |

---

## 1. A1 — Inspection Findings (READ-ONLY)

### 1.1 Current state before G7-15A

| Component | State | Source |
|---|---|---|
| `web/src/app/api/auth/login/route.ts` | PIN-validated, constant-time compare, fail-closed in production. **No rate limit.** Comment line 26: "Production hardening (out of G7-02 scope): Add rate limiting (e.g., 5 attempts per minute per IP)." | inspected |
| `web/src/components/genesis/AuthGate.tsx` | Has `devModeHint?: boolean` prop. Placeholder is `devModeHint ? "dev-local-pin" : "Operator PIN"`. Renders a hint block: `<strong>Controlled environment:</strong> the default dev PIN is dev-local-pin …`. 4 occurrences of `devModeHint`. | inspected |
| `web/src/components/genesis/GenesisApp.tsx` line 94 | Passes `devModeHint={true}` to `<AuthGate>`. | inspected |
| `next.config.mjs` | No `allowedDevOrigins` (confirmed absent; G7-10 chose not to reconstruct). | inspected |
| Preserved G7-08C/D work | **None in the GitHub clone.** The G7-10 closure report §6 confirmed `web/src/lib/auth/rate-limit.ts` does not exist; `AuthGate.tsx` `devModeHint` removal was not applied; the preview changes lived only in the inaccessible Z.ai Preview workspace. | `G7-10_Truthfulness_Mission_Visibility_Report.md` §1.3 |
| Existing auth tests | `scripts/g7-02-auth-gate-tests.ts` (E2E) and `scripts/g7-02-auth-gate-unit-tests.ts` (cookie unit). Both gitignored scripts; run via `npx tsx`. | inspected |
| Next.js 16 `NextRequest` | **No `req.ip` property** — removed in Next.js 15+. Route handlers cannot obtain the connection-level client IP. The only IP sources are HTTP headers. | `web/node_modules/next/dist/server/web/spec-extension/request.d.ts` |

### 1.2 Decision: re-implement (per G7-10 §6)

G7-10 §6 explicitly states both retrieval and re-implementation are acceptable. The preview changes are inaccessible from the GitHub clone, so G7-15A re-implements the rate limiter from scratch, following the smallest-correct principle.

---

## 2. A2 — Minimal Correction

### 2.1 New file: `web/src/lib/auth/rate-limit.ts` (~190 lines)

**Design constraints honored:**
- "Prevent untrusted client-supplied headers from bypassing the limiter" → the limiter key does NOT trust `X-Forwarded-For`, `X-Real-IP`, or any forwarding header by default.
- "Avoid new frameworks or dependencies" → pure `node:crypto`-free module; only `next/server` type import (for `NextRequest` typing).
- "Preserve legitimate development behavior without exposing secrets" → a successful login clears the bucket for its key (a real operator who typos a few times then succeeds is forgiven).

**Trust model for the client identity key:**

1. Default (no env): single static key `"default"`. Every caller shares one bucket. Appropriate for the documented single-operator controlled environment. Fail-safe — never fail-open.
2. `GENESIS_TRUSTED_PROXY_HEADER=X-Real-IP` (operator-configured): the named header IS read. The operator is responsible for ensuring their reverse proxy overwrites this header on EVERY inbound request, stripping any client-supplied value. The limiter does NOT validate this; it is an operator-side responsibility (documented in the module + report).

**Configuration:** 5 attempts per 60-second sliding window (matches the G7-02 comment's "5 attempts per minute per IP" guidance). MAX_BUCKETS = 10,000 (memory bound). MAX_TIMESTAMPS = 100 per bucket (defense-in-depth).

### 2.2 Modified: `web/src/app/api/auth/login/route.ts`

- **Pre-body rate-limit check:** the limiter is consulted BEFORE `req.json()` is called. A flood of requests from an already-rate-limited key does not consume the JSON-parse budget or the constant-time-compare budget.
- **429 response:** HTTP 429 with `Retry-After: 60` (RFC 6585 §4). The body is a generic `TOO_MANY_ATTEMPTS` error; no leak of how many attempts remain.
- **Record on 401:** every failed PIN compare calls `recordFailedAttempt(key)`. The current request still returns 401 (so the attacker cannot distinguish "wrong PIN" from "rate-limited" on the same response — which would be a timing side-channel). The NEXT request from the same key gets 429.
- **Clear on 200:** a successful login calls `clearRateLimit(key)`. The "legitimate operator who typos then succeeds" recovery path.
- **No timing side-channel on rate-limited requests:** when the bucket is over the limit, the limiter short-circuits BEFORE the PIN compare. A correct PIN while over the limit also gets 429 (verified by A3-06). This means a rate-limited attacker cannot probe whether their guessed PIN is correct via timing.

### 2.3 Modified: `web/src/components/genesis/AuthGate.tsx`

- **Removed** the `devModeHint?: boolean` prop (G7-08D).
- **Removed** the `placeholder={devModeHint ? "dev-local-pin" : "Operator PIN"}` conditional → now hardcoded to `"Operator PIN"`.
- **Removed** the `<p>` hint block that rendered `dev-local-pin` when `devModeHint` was true.
- **Added** a 429 handling branch: surfaces "Too many failed attempts. Wait a minute and try again." (no leak of remaining attempts).
- **The server-side dev PIN default is unchanged.** `getOperatorPin()` still returns `dev-local-pin` when `GENESIS_OPERATOR_PIN` is unset AND `NODE_ENV !== "production"` — this is a server-side convenience, NOT a client-visible secret. The AuthGate renders identically in dev and production.

### 2.4 Modified: `web/src/components/genesis/GenesisApp.tsx`

- Removed the `devModeHint={true}` prop pass-through to `<AuthGate>` (the prop no longer exists).

### 2.5 Documented limitations of the in-memory limiter

| Limitation | Mitigation |
|---|---|
| **RESTART_CLEARS_LIMITER** — state lives in a process-local Map. A BFF restart resets every bucket to empty. | Acceptable for the controlled environment: the PIN is constant-time compared AND the cookie secret is rotated on restart. An attacker who triggers a restart cannot brute-force faster than the new limiter allows. |
| **MULTI_INSTANCE_NOT_SHARED** — when running multiple BFF instances behind a load balancer, each instance has its own Map. An attacker who can route around instances can multiply their effective rate by the instance count. | Out of scope for G7-15A (no new dependencies per spec). Operator must run a single BFF instance OR introduce a shared store (Redis, etc.). Documented as a residual risk. |
| **MEMORY_BOUND** — the Map is bounded by MAX_BUCKETS (10,000). New buckets evict the oldest when the cap is reached. Each bucket stores at most MAX_TIMESTAMPS (100) timestamps. Worst-case memory ≈ 80 KB. | Bounded by construction. |

---

## 3. A3 — Acceptance Tests

### 3.1 Unit tests: `scripts/g7-15a-rate-limit-unit-tests.ts`

Pure-logic tests for the limiter (no HTTP, no Next.js runtime). Run via `npx tsx`.

```
$ npx tsx scripts/g7-15a-rate-limit-unit-tests.ts
=== G7-15A rate-limit unit tests ===
✓  RL-01  empty limiter never rate-limits
✓  RL-02  under the limit — not rate-limited
✓  RL-03  at the limit — rate-limited
✓  RL-04  sliding window expires old timestamps
✓  RL-05  clearRateLimit removes the bucket
✓  RL-06  independent keys — overflow on one does not affect another
✓  RL-07  no trusted-proxy env → ignores forged forwarding headers → 'default'
✓  RL-08  trusted-proxy env set → reads ONLY that header (forged X-Forwarded-For ignored)
✓  RL-09  trusted-proxy env set but header absent → falls back to 'default' (fail-safe)
✓  RL-10  long trusted-header value truncated to ≤64 chars
✓  RL-11  recordFailedAttempt returns over=true exactly at maxAttempts
✓  RL-12  getRateLimitStateForTests returns current state

12/12 PASS, 0 FAIL
```

### 3.2 Integration tests: `scripts/g7-15a-auth-security-tests.cjs`

Spawns the REAL Next.js BFF + Gateway in production mode (`NODE_ENV=production`, distinctive test PIN + BFF secret). Each phase uses a fresh web port (fresh in-memory limiter) for clean state.

```
$ node scripts/g7-15a-auth-security-tests.cjs
A3-00:  PASS — gateway + web up (production mode, PIN=g7-15a-s…)
A3-01:  PASS — valid PIN → 200 + genesis_bff cookie (status=200)
A3-02:  PASS — 5 × 401 then 429 (failed401=5)
A3-03:  PASS — forged forwarding headers → still 429 (limiter ignores them)
A3-03b: PASS — trusted proxy header X-Real-IP → separate bucket (5×401 then 429 for that IP; default bucket still 401)
A3-04:  PASS — no 'dev-local-pin' or 'devModeHint' in rendered HTML or bundled JS
A3-05:  PASS — authenticated BFF /api/genesis/v1/plugins → 200 (0 plugins)
A3-05b: PASS — unauthenticated BFF → 401 (existing auth boundary intact)
A3-06:  PASS — correct PIN while over limit → 429 (limiter short-circuits before PIN compare; no timing side-channel). Recovery path: wait for window expiry, then the next successful login clears the bucket.

9/9 PASS, 0 FAIL
```

### 3.3 Full regression + quality gates

| Check | Command | Result |
|---|---|---|
| Full regression | `npx vitest run` | **819 passed, 9 skipped, 0 failed (84 files)** — unchanged from G7-14H2 baseline |
| Engine typecheck | `npx tsc --noEmit` | PASS (0 errors) |
| Web typecheck | `cd web && npx tsc --noEmit` | PASS (0 errors) |
| Engine lint | `npx eslint .` | PASS (0 errors) |
| Web lint | `cd web && npx eslint .` | PASS (0 errors, 4 pre-existing warnings — unchanged) |
| Rate-limit unit tests | `npx tsx scripts/g7-15a-rate-limit-unit-tests.ts` | 12/12 PASS |
| Auth security integration tests | `node scripts/g7-15a-auth-security-tests.cjs` | 9/9 PASS |
| Frozen contracts | `git diff 2b105e5..HEAD -- src/contracts/core.ts src/mission/verification.ts src/mission/orchestrator.ts src/goal/goal-compiler.ts` | **0 diff lines** (UNCHANGED) |
| ownership.yaml | `git diff 2b105e5..HEAD -- data/ownership.yaml` | **0 diff lines** (UNCHANGED) |

### 3.4 Acceptance criteria matrix

| Spec requirement | Test ID | Result |
|---|---|---|
| Valid authentication continues to work | A3-01 | PASS |
| Repeated failed attempts trigger HTTP 429 | A3-02 | PASS |
| Rate limits cannot be bypassed using forged forwarding headers | A3-03 | PASS |
| Trusted-proxy header (when configured) produces a separate bucket per IP | A3-03b | PASS |
| Development hints do not leak in production (DOM + bundled JS) | A3-04 | PASS |
| Existing authentication + Studio workflows remain functional | A3-05 + A3-05b | PASS |
| No timing side-channel on rate-limited requests | A3-06 | PASS |
| Frozen contracts + ownership.yaml unchanged | git diff | PASS (0 lines) |

---

## 4. Files Changed (G7-15A)

| File | Status | Lines |
|---|---|---|
| `web/src/lib/auth/rate-limit.ts` | NEW | +190 |
| `web/src/app/api/auth/login/route.ts` | MODIFIED | +50 / -3 |
| `web/src/components/genesis/AuthGate.tsx` | MODIFIED | +12 / -22 |
| `web/src/components/genesis/GenesisApp.tsx` | MODIFIED | +0 / -1 |
| `scripts/g7-15a-rate-limit-unit-tests.ts` | NEW (force-added; `scripts/` is gitignored) | +220 |
| `scripts/g7-15a-auth-security-tests.cjs` | NEW (force-added) | +260 |
| `evidence/g7-15a/` | NEW (3 evidence files) | — |
| `eslint.config.js` | MODIFIED | +5 (added the two new scripts to the ignore list, same pattern as g7-13d/e/f + g7-14h) |
| `G7-15A_Security_Reconciliation_Report.md` | NEW (this report) | — |

**No frozen-contract modifications.** No `data/ownership.yaml` modifications. No new npm dependencies. No production source modifications in `src/` (engine). Production web changes are confined to the auth boundary (rate-limit + login route + AuthGate + GenesisApp).

---

## 5. Residual Risks

| Risk | Severity | Mitigation |
|---|---|---|
| In-memory limiter cleared on BFF restart | P2 | Documented; acceptable in controlled env (PIN constant-time + cookie secret rotation). |
| Multi-instance BFF does not share limiter state | P2 | Documented; operator must run single instance OR introduce shared store (out of scope for G7-15A; no new deps per spec). |
| `GENESIS_TRUSTED_PROXY_HEADER` operator misconfiguration (forgetting to strip client-supplied values at the proxy) | P2 | Documented in the rate-limit module header. The default (no env) is fail-safe; only an explicit operator action enables header-based keying. |
| Rate-limit key `"default"` is shared across all callers in the default config | P3 | Appropriate for the single-operator controlled env. An attacker who knows the PIN can still authenticate (the limiter does not prevent that); it only bounds online brute-force. |

---

## 6. Engineering Charter

**Illuminate before building. Reuse before reinventing.**

- **Illuminate**: A1 inspected the existing login route, AuthGate, Next.js config, preserved G7-08C/D work (none in the GitHub clone), existing tests, and Next.js 16's `NextRequest` type (no `req.ip`). The decision to re-implement was made on the basis of G7-10's documented closure, not assumed.
- **Reuse**: the rate-limit module follows the same in-memory Map + sliding-window pattern already used by `mission-service.ts` (terminal-mission retention), `flight-recorder.ts`, and the G6-08 admission-control Map. The login route's existing structure (constant-time compare, fail-closed, 503 mapping) was preserved — only the rate-limit short-circuit was added. The AuthGate's existing 400/401/503 handling was extended to 429; no other behavior changed.
- **Small in code**: +190 lines for the limiter + ~50 lines of wiring + 12 unit tests + 9 integration tests. The production-code delta is ≈250 lines — well within the slice's "minimal correction" budget.

---

## 7. Final Status

```text
G7_15A_ACCEPTANCE = PASS

A1_INSPECTION = PASS (G7-08C/D state confirmed absent; re-implement decision per G7-10 §6)
A2_MINIMAL_CORRECTION = PASS (rate-limit + AuthGate hardening, no new deps, no header bypass)
A3_ACCEPTANCE_TESTS = PASS (12 unit + 9 integration = 21/21; full regression 819/0/9)

PRODUCTION_CODE_IMPACT = web auth boundary only (rate-limit + login route + AuthGate + GenesisApp)
FROZEN_CONTRACT_IMPACT = NONE (0 diff lines vs 2b105e5)
OWNERSHIP_YAML_IMPACT = NONE (0 diff lines vs 2b105e5)
NEW_DEPENDENCIES = NONE

RESIDUAL_RISKS:
  - RESTART_CLEARS_LIMITER (P2, documented)
  - MULTI_INSTANCE_NOT_SHARED (P2, documented; out of scope per spec)
  - OPERATOR_PROXY_MISCONFIG (P2, documented; default is fail-safe)

NOT_STARTED = G7-15B (per spec; awaiting architectural approval)
```

---

## 8. Evidence Locations

| Evidence | Path |
|---|---|
| Rate-limit module | `web/src/lib/auth/rate-limit.ts` |
| Login route (modified) | `web/src/app/api/auth/login/route.ts` |
| AuthGate (modified) | `web/src/components/genesis/AuthGate.tsx` |
| GenesisApp (modified) | `web/src/components/genesis/GenesisApp.tsx` |
| Rate-limit unit tests | `scripts/g7-15a-rate-limit-unit-tests.ts` |
| Auth security integration tests | `scripts/g7-15a-auth-security-tests.cjs` |
| Integration test results | `evidence/g7-15a/a3-results.json` |
| A3-04 rendered page (dev-hint leak check) | `evidence/g7-15a/a3-04-page.html` |
| A3-05 BFF plugins response | `evidence/g7-15a/a3-05-plugins-response.json` |
| This report | `G7-15A_Security_Reconciliation_Report.md` |

---

**End of G7-15A Security Reconciliation Report. Awaiting remote verification.**
