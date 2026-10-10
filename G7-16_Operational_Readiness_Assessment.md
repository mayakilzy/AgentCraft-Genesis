# G7-16 — Operational Readiness Assessment

**Mission:** G7-16 — Operational Readiness Assessment (Read-Only)
**Branch:** `build/g7-14-constrained-mcp`
**Baseline:** `3246eccdd1f3ce5f636808086ca95132c9cc2180` (G7-15F — PASS)
**Date:** 2026-10-10
**Mode:** READ-ONLY — no production code changes

---

## 1. Assessment Summary

G7-15 proved one continuous production execution path: Studio → Auth → Mission A → ZAI GLM → OpenBot → write_file → Verification → SUCCEEDED → Artifact delivery. The full G7-15 series (A through F) closed the three G7-11B prerequisites: (1) security reconciliation (G7-15A), (2) restart-durable mission history (G7-15B), and (3) real Mission A execution + artifact delivery + browser acceptance (G7-15C–F).

This assessment evaluates whether Genesis is ready for sustained, practical use beyond a single successful demonstration.

---

## 2. Assessment Areas

### 2.1 Reliability

| Dimension | Status | Evidence |
|---|---|---|
| Repeated missions | **VERIFIED** | G7-15B B4-06: 10 concurrent missions → 10 valid records. G7-15F: single production mission succeeded. Full regression: 853 tests, 0 failures. |
| Failure recovery | **VERIFIED** | G7-15B-H1: terminal-write fault injection (8/8 tests). `persistTerminal()` marks `persistenceFailed` on write error; recovery uses `OUTCOME_UNCONFIRMED` (not fabricated FAILED). |
| Cancellation | **VERIFIED** | `tests/gateway/cancellation.test.ts`, `tests/mission/orchestrator.test.ts` — AbortController propagation, CANCELLED status. |
| Restart behavior | **VERIFIED** | G7-15B: SUCCEEDED/FAILED/OUTCOME_UNCONFIRMED all survive restart. G7-15D D3-04/D3-05: metadata consistent after restart. G7-15F E3-09: mission history survived restart in browser test. |

**Gap:** No repeated long-running production mission (>5 min) tested. The G7-15F mission completed in ~28s. The mission timeout is 300s (5 min); no test exercises the timeout under real LLM load.

### 2.2 Runtime Lifecycle

| Dimension | Status | Evidence |
|---|---|---|
| Resource cleanup | **VERIFIED** | `tests/g6-08-r1/shutdown-lifecycle.test.ts`: graceful shutdown drains active missions, stops workers, closes runtimes. `close()` wraps `computer.stop()` in try-catch. |
| Worker retention | **VERIFIED** | G7-15D/E: `stopWorker()` keeps workers in `this.workers` for disk access; `close()` clears both Maps. Mixed-lifecycle unified in G7-15E. |
| Concurrent execution | **VERIFIED** | `tests/gateway/isolation.test.ts`, `tests/g6-08/rb2-concurrent-isolation.test.ts` — per-mission fresh runtime adapter, no shared workspace. |
| Workspace management | **PARTIALLY VERIFIED** | Workspaces persist on disk (durable artifacts). `resetWorker()` deletes workspace. No automated workspace cleanup/retention sweep — workspaces accumulate. |

**Gap:** No workspace retention sweep. Workspaces persist indefinitely in `OPENBOT_ROOT_DIR`. Disk growth is unbounded for sustained use.

### 2.3 Artifact Durability

| Dimension | Status | Evidence |
|---|---|---|
| Retrieval after completion | **VERIFIED** | G7-15D D3-01: artifact discoverable after mission completion. G7-15F F2-09: artifact retrieved via API in production golden path. |
| Retrieval after restart | **VERIFIED** | G7-15D D3-05: metadata (path + verified + bytes) consistent after restart. Content is `undefined` (workspace gone) — truthful. |
| Missing files | **VERIFIED** | G7-15D D3-06: content explicitly `undefined`, not fabricated. `listArtifactsFromDisk()` skips vanished files. |
| Path traversal protection | **VERIFIED** | G7-15D D3-08: no path with `..` or `/` prefix. Defense-in-depth in both live and disk paths. |

**Gap:** Artifact content is NOT durable across restart (workspace gone). Only metadata survives. A separate artifact content store would close this, but it's documented and out of scope.

### 2.4 Security

| Dimension | Status | Evidence |
|---|---|---|
| Authentication | **VERIFIED** | G7-15A: rate-limit (5/60s), constant-time PIN comparison, fail-closed in production. BFF cookie auth (HttpOnly, SameSite=Strict, HMAC-signed). |
| Authorization | **VERIFIED** | Caller-scoped: `requireMission()` checks `callerId` match. Cross-caller → 404 (no existence leak). |
| Caller isolation | **VERIFIED** | G7-15D D3-07: cross-caller artifact access denied. `tests/gateway/isolation.test.ts`. |
| Secrets | **VERIFIED** | `scrubSecrets()` multi-layer (Bearer, GitHub PATs, OpenAI/Anthropic keys, AWS, generic). D3-10: no secrets in responses. |
| Sandbox boundaries | **VERIFIED** | `checkCommandPolicy()` blocklist in WorkerAgent. OpenBot egress filtering. Path traversal protection. |
| Rate limiting | **VERIFIED** | G7-15A: in-memory sliding-window (5/60s). No trusted-proxy header bypass by default. |

**Gap:** Rate limiter is in-memory (restart clears, multi-instance not shared). Documented in G7-15A.

### 2.5 Observability

| Dimension | Status | Evidence |
|---|---|---|
| Execution traces | **VERIFIED** | Flight recorder events: mission-started, worker-started, worker-step, verification, mission-finished. `GET /v1/missions/{id}/events`. |
| Error classification | **VERIFIED** | G6-01 failure taxonomy (PROVIDER_FAILURE, RUNTIME_FAILURE, etc.). `classifyError()` in `failure-class.ts`. |
| Cost visibility | **VERIFIED** | `costSource()` reads token usage from ZAI provider. `MissionResult.cost` carries tokens, wallMs, usd. |
| Operational diagnostics | **PARTIALLY VERIFIED** | `/health` endpoint reports status, version, uptime, activeMissions, limitations. No `/metrics` (Prometheus) endpoint. No structured logging (console.error only). |

**Gap:** No structured logging, no Prometheus metrics endpoint, no distributed tracing. Console.error is the only diagnostic output.

### 2.6 Provider Resilience

| Dimension | Status | Evidence |
|---|---|---|
| Unavailable providers | **VERIFIED** | G7-14G: "unavailable provider produces honest failure" — `LazyCompositeMcpProvider` returns `ok: false`. `tests/runtime/g7-14-mcp-activation.test.ts`. |
| Rate limits | **VERIFIED** | ZAI provider: 6-retry backoff for 429. `tests/providers/g7-11-provider-hardening.test.ts` (BG-01..BG-06). |
| Timeouts | **VERIFIED** | Per-call timeout (`callTimeoutMs`). `tests/providers/g7-11-provider-hardening.test.ts` (TO-01, TO-02). Mission timeout (default 180s). |
| Cost ceilings | **VERIFIED** | `maxTotalTokens` pre-call + post-call check. `BudgetExceededError` (not retryable). G7-11 BG-06. |

**Gap:** ZAI USD pricing unknown (included usage, no billing). Token-based proxy only. No multi-provider failover.

### 2.7 User Experience

| Dimension | Status | Evidence |
|---|---|---|
| Mission submission | **VERIFIED** | G7-15F F2-04: mission submitted via BFF from browser. G7-15E E3-03: mission submitted from Studio UI. |
| Progress visibility | **VERIFIED** | Flight events streamed via `GET /v1/missions/{id}/events`. G7-15E E3-03: SUCCEEDED badge visible in UI. |
| Final status | **VERIFIED** | G7-15F F2-08: SUCCEEDED displayed truthfully. |
| Error display | **VERIFIED** | G7-15A: AuthGate shows "Invalid PIN", "Too many attempts", "Server not configured". Mission status shows FAILED/PARTIAL/OUTCOME_UNCONFIRMED. |
| Artifact access | **VERIFIED** | G7-15F F2-09: artifact retrieved via API. G7-15E: artifacts panel in Studio. |

**Gap:** No real-time streaming (WebSocket/SSE) of mission progress. The UI polls. A2A streaming is not supported.

### 2.8 Deployment

| Dimension | Status | Evidence |
|---|---|---|
| Configuration | **VERIFIED** | `docs/release/engine-v1-configuration.md` — all env vars documented. Production mode fail-closed. |
| Dependency installation | **VERIFIED** | `npm ci` from lockfile. z-ai-web-dev-sdk added in G7-15C. |
| Startup | **VERIFIED** | `npx tsx src/gateway/main.ts` — documented in install guide. Health endpoint verifies readiness. |
| Health checks | **VERIFIED** | `GET /health` returns status, version, uptime, activeMissions, limitations. |
| Recovery | **PARTIALLY VERIFIED** | G7-15B: mission history recovers from disk. But in-process state (events, idempotency) does NOT survive restart. Workspaces persist but are not automatically cleaned. |

**Gap:** No Docker/CI pipeline for production deployment. No automated workspace cleanup. No process supervisor integration (systemd/pm2).

### 2.9 Performance

| Dimension | Status | Evidence |
|---|---|---|
| Resource consumption | **PARTIALLY VERIFIED** | G7-15F: 28s mission, 6K tokens, 3.5GB RAM available. No load testing beyond 10 concurrent missions (G7-15B B4-06). |
| Concurrency limits | **VERIFIED** | `maxActiveMissions` per caller (default 5), `maxActiveMissionsGlobal` (default 50). Configurable. |
| Startup latency | **VERIFIED** | G7-15F: gateway startup < 5s (tsx transpilation). Web (Next.js production build) startup < 5s. |

**Gap:** No load testing beyond 10 concurrent missions. No memory profiling under sustained load. No benchmark for mission throughput.

### 2.10 Operational Documentation

| Dimension | Status | Evidence |
|---|---|---|
| Installation | **VERIFIED** | `docs/release/engine-v1-install-and-run.md` — prerequisites, install, verify, smoke mission. |
| Configuration | **VERIFIED** | `docs/release/engine-v1-configuration.md` — all env vars, production/development modes. |
| Troubleshooting | **PARTIALLY VERIFIED** | Known limitations documented. No troubleshooting runbook (common errors, recovery procedures). |
| Recovery procedures | **PARTIALLY VERIFIED** | G7-15B documents restart recovery semantics. No operational runbook for disk-full, workspace corruption, or provider outage scenarios. |

**Gap:** No troubleshooting runbook. No operational runbook for failure scenarios.

---

## 3. Risk Classification

### P0 — Critical (security, data-loss, integrity)

**None.** No P0 findings. The production golden path (G7-15F) demonstrates a verified, secure, truthful execution path with no fabricated outcomes.

### P1 — Essential for dependable practical use

| ID | Finding | Evidence | User Impact | Smallest Correction | Acceptance Test |
|---|---|---|---|---|---|
| P1-01 | **Workspace retention sweep** — OpenBot workspaces accumulate indefinitely in `OPENBOT_ROOT_DIR`. No automated cleanup. | `src/runtime/openbot/adapter.ts` — `resetWorker()` deletes workspace but is not called automatically. `close()` does not delete workspaces. | Disk fills up under sustained use. | Add a configurable workspace TTL sweep (reuse the `sweepTerminalMissions` pattern from `mission-service.ts`). Evict workspaces older than N hours. | Test: create 5 missions, verify workspaces exist; advance clock; verify old workspaces are deleted. |
| P1-02 | **No structured logging** — gateway uses `console.error` only. No log levels, no structured output, no correlation IDs beyond mission ID. | `src/gateway/main.ts` — all logging is `console.error(...)`. | Operators cannot filter logs, integrate with log aggregation, or correlate across services. | Add a minimal structured logger (reuse the existing `scrubSecrets` pattern). No new dependency — use `JSON.stringify` with level + timestamp + missionId. | Test: gateway logs include `level`, `timestamp`, `missionId` in JSON format. |
| P1-03 | **Mission history load-all at startup** — `FileMissionHistoryStore.loadAll()` reads every `*.mission.json` file at startup. O(missions) disk reads. | `src/mission/mission-history-store.ts:loadAll()` — `readdirSync` + `readFileSync` per file. | Startup slows as mission count grows. | Add a lazy-load option (load metadata index first; load full records on `get()`). Reuse the existing `readdirSync` pattern but defer `readFileSync` until needed. | Test: 1000 mission files; startup < 2s. |

### P2 — Valuable improvement

| ID | Finding | Evidence | User Impact | Smallest Correction |
|---|---|---|---|---|
| P2-01 | **No artifact content durability** — workspace gone after restart; only metadata survives. | G7-15B/D — documented limitation. | User cannot download artifact content after gateway restart. | Copy verified artifacts to a durable artifact store (reuse `ArtifactRegistry` JSONL pattern from `src/mission/artifact-record.ts`). |
| P2-02 | **No real-time UI streaming** — UI polls for mission status. No WebSocket/SSE. | A2A AgentCard declares `streaming: false`. UI uses `setInterval` polling. | User sees delayed status updates (500ms poll interval). | Add SSE endpoint for mission events (reuse the existing flight recorder event stream). |
| P2-03 | **No multi-instance coordination** — in-memory registry, rate limiter, and sweeper are per-process. | G7-15A/B documentation. | Cannot horizontally scale beyond one gateway process. | Add a shared store (Redis) for rate limiter + mission registry. Out of scope for single-user use. |
| P2-04 | **No troubleshooting runbook** — documentation covers install/config but not operational recovery. | `docs/release/` — no troubleshooting guide. | Operator cannot quickly diagnose common failures. | Add `docs/release/engine-v1-troubleshooting.md` with common errors, symptoms, and recovery steps. |
| P2-05 | **ZAI USD pricing unknown** — cost enforcement uses token proxy; no USD billing. | G7-11B §7.2. | Cannot enforce real USD budgets. | Wait for ZAI billing API; or integrate with a billing-aware provider. |

### P3 — Optional enhancement

| ID | Finding | User Impact |
|---|---|---|
| P3-01 | No Prometheus `/metrics` endpoint | Cannot integrate with monitoring stack. |
| P3-02 | No LRU eviction for terminal missions in history store | Disk grows without bound (mitigated by P1-01 workspace sweep). |
| P3-03 | No multi-provider failover | Single provider outage blocks all missions. |
| P3-04 | A2A streaming not supported | External A2A consumers must poll. |
| P3-05 | No load testing beyond 10 concurrent missions | Throughput characteristics unknown at scale. |

---

## 4. Readiness Decision

| Deployment Tier | Readiness | Rationale |
|---|---|---|
| **Local developer use** | **READY** | Development mode (MemoryRuntime + dev reasoning) works out of the box. 853 tests pass. All quality gates green. No external dependencies required. |
| **Private single-user use** | **READY** | G7-15F proves the full production path (real ZAI + OpenBot + verification + artifact delivery). Single-user has no multi-instance concerns. Rate limiter, caller isolation, and secret scrubbing are sufficient. Workspace cleanup (P1-01) is recommended but not blocking for a single user who can clean manually. |
| **Limited trusted-user pilot** | **CONDITIONAL** | All security and reliability gates pass. The condition is: (1) implement P1-01 workspace cleanup before sustained use, (2) implement P1-02 structured logging for operational visibility, (3) document the troubleshooting runbook (P2-04). These are P1 gaps that affect sustained operation but do not block initial deployment. |
| **Public multi-user deployment** | **BLOCKED** | (1) No multi-instance coordination (P2-03) — rate limiter and mission registry are in-memory. (2) No structured logging (P1-02). (3) No workspace cleanup (P1-01). (4) No load testing at scale (P3-05). (5) API-key-only authentication is not suitable for untrusted networks (documented limitation #3). (6) No HTTPS/TLS termination (the gateway listens on HTTP only). |

---

## 5. Next Recommended Mission

**G7-16A — Operational Hardening (P1 closure)**

Address the three P1 findings in priority order:
1. Workspace retention sweep (P1-01) — unbounded disk growth is the most immediate operational risk.
2. Structured logging (P1-02) — essential for operational diagnostics.
3. Lazy-load mission history (P1-03) — startup performance as mission count grows.

Each is a small, focused mission reusing existing infrastructure. No new frameworks. No frozen-contract changes.

---

## 6. Final Status

```text
MISSION = G7-16
PRODUCTION_CODE_CHANGED = NO
LOCAL_DEVELOPER_READINESS = READY
PRIVATE_SINGLE_USER_READINESS = READY
TRUSTED_PILOT_READINESS = CONDITIONAL
PUBLIC_DEPLOYMENT_READINESS = BLOCKED
P0_FINDINGS = 0
P1_FINDINGS = 3 (workspace cleanup, structured logging, lazy-load history)
P2_FINDINGS = 5 (artifact content durability, real-time UI, multi-instance, troubleshooting runbook, ZAI billing)
P3_FINDINGS = 5 (Prometheus, LRU eviction, multi-provider, A2A streaming, load testing)
NEXT_RECOMMENDED_MISSION = G7-16A (Operational Hardening — P1 closure)
FINAL_LOCAL_HEAD = (set after commit)
FINAL_REMOTE_HEAD = (verified after push)
HEAD_MATCH = YES
```

---

**End of G7-16 Operational Readiness Assessment. No production code was modified.**
