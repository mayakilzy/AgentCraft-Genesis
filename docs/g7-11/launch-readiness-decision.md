# G7-11 — Launch Readiness Decision

**Mission:** G7-11 — Real Execution Qualification & Production Hardening Gate
**Decision Date:** 2026-10-09
**Decision:** **EXECUTION QUALIFIED WITH LIMITATIONS** (real-provider execution BLOCKED; hardening verified)

---

## 1. Decision Summary

| Dimension | Status |
|---|---|
| Real execution qualified | **BLOCKED** — ZAI SDK and OpenBot runtime unavailable in this environment |
| Execution qualified with limitations | **YES** — hardening (acceptance criteria, budget enforcement, timeout) verified via mock/stub tests |
| Qualification blocked | YES for Mission A (real artifact); NO for Missions B + C |
| Execution not qualified | NO — the architecture is sound; the blocker is environmental, not structural |

**The real execution foundation is architecturally qualified but operationally blocked by missing provider credentials/runtime. The hardening fixes (P1 defects FM-02, FM-07, FM-08, FM-12) are implemented and verified.**

---

## 2. Real Execution Qualification

### 2.1 What Was Verified

The complete real-execution path was audited end-to-end (Phase 0b). Every
transition from User Goal → Gateway → Provider → Runtime → Verification →
Outcome was inspected against actual source code. The architecture is sound:

- **Production mode fail-closed:** `main.ts:316-346` — refuses to start without
  real providers; no silent fallback to dev fixtures.
- **Provider isolation:** per-mission fresh runtime adapter (`main.ts:209-218`).
- **Verification clean-room:** artifacts copied to a separate verifier computer
  before examination (`verification.ts:7-23`).
- **Bounded retry:** single retry on verification failure (`orchestrator.ts:727-797`).
- **Mission timeout:** `setTimeout` + `AbortController` (`orchestrator.ts:375-377`).
- **Concurrent mission limits:** per-caller + global caps (`mission-service.ts:600-613`).
- **Secret redaction:** multi-layer scrubbing (`mission-service.ts:64-99`).
- **Caller isolation:** ownership-filtered list + cross-caller 404 (`mission-service.ts:869-881`).

### 2.2 What Is Blocked

**Mission A (real artifact creation) is BLOCKED** because:

1. **ZAI SDK not installed:** `z-ai-web-dev-sdk` is absent from node_modules,
   global modules, and `ZAI_SDK_PATH` is unset. `ZAI_API_KEY` is unset.
2. **OpenBot checkout unavailable:** `OPENBOT_CHECKOUT_DIR` and
   `OPENBOT_ROOT_DIR` are unset; no OpenBot repository checkout exists on disk.

Per the mission rules: "If live execution is blocked, report qualification as
BLOCKED—not PASS." Mission A is reported as **BLOCKED**.

### 2.3 What Was Hardened (P1 Fixes)

Three P1 defects identified in the failure-mode matrix were fixed:

| Defect | Fix | Verification |
|---|---|---|
| FM-07/FM-08: wrong filename / incomplete content not detected | Added `acceptanceCriteria` to `MissionSubmission`; wired to `buildChecks()` via existing `checks` seam | 13 tests in `tests/gateway/g7-11-acceptance-criteria.test.ts` — all PASS |
| FM-02: no per-call provider timeout | Added `callTimeoutMs` to `ZAIReasoningOptions`; wraps SDK call in `AbortSignal.timeout()` | 2 tests (TO-01, TO-02) in `tests/providers/g7-11-provider-hardening.test.ts` — PASS |
| FM-12: budget not enforced (advisory only) | Added `maxTotalTokens` to `ZAIReasoningOptions`; pre-call + post-call checks; `BudgetExceededError` (not retryable) | 6 tests (BG-01..BG-06) — all PASS |

**No frozen contracts were modified.** All fixes use:
- Transport types (`MissionSubmission`, `AcceptanceCheckInput`) — not `Goal`.
- Provider options (`ZAIReasoningOptions`) — not `ReasoningProvider` contract.
- Existing seams (`MissionOrchestratorOptions.checks`, `costSource`).

---

## 3. Three Independent Truth Levels

G7-11 established the mechanism to distinguish:

| Level | Question | Authority | G7-11 Status |
|---|---|---|---|
| Level 1 — Execution Completion | Did the workflow complete? | `MissionResult.status` | Already implemented (G7-10 disclosed in UI) |
| Level 2 — Artifact Integrity | Was the expected artifact produced and did its checks pass? | `VerificationResult.ok` + `outcomes[]` | Already implemented; `buildChecks()` structural floor |
| Level 3 — Goal Satisfaction | Did the result satisfy the approved, objectively testable requirements? | Caller-supplied `acceptanceCriteria` → `AcceptanceCheck` evaluation | **G7-11 IMPLEMENTED** — `acceptanceCriteria` wired through transport → `buildChecks()` → `VerificationLoop` |

A missing acceptance criterion is NOT interpreted as success. The structural
floor (file existence) always applies. When caller-supplied criteria are
present, they are evaluated against the actual artifact by the existing
`VerificationLoop` — no new verification engine.

---

## 4. Unresolved P0/P1 Issues

| ID | Severity | Issue | Status |
|---|---|---|---|
| FM-02 | P1 | Provider per-call timeout | **FIXED** (callTimeoutMs) |
| FM-07 | P1 | Wrong filename not detected | **FIXED** (acceptanceCriteria) |
| FM-08 | P1 | Incomplete content not detected | **FIXED** (acceptanceCriteria) |
| FM-12 | P1 | Budget not enforced | **FIXED** (maxTotalTokens) |
| — | P0 | None | 0 P0 issues |

**All P1 issues are resolved. No P0 issues exist.**

---

## 5. Requirements Deferred to G7-12 through G7-15

| Requirement | Target Phase | Reason |
|---|---|---|
| Real-provider execution (Mission A) | G7-12 or credential provisioning | Requires ZAI SDK + OpenBot checkout |
| Conversational Home | G7-12 | Per roadmap |
| Projects Repository | G7-13 | Per roadmap |
| Constrained Plugins / MCP | G7-14 | Per roadmap |
| Integrated Product Acceptance | G7-15 | Per roadmap |
| G7-08C/D preview changes reconciliation | Before G7-12 | Rate-limiting + AuthGate hardening still in Z.ai Preview only |
| Restart-durable mission history | Future phase | Requires persistence layer decision |
| LLM-based goal satisfaction evaluator (Path C) | Deferred indefinitely | Paths A (implemented) + B (future) sufficient |

---

## 6. Operational Readiness Assessment

### 6.1 Resource Control

| Control | Status |
|---|---|
| Bounded provider calls | YES — `maxTotalTokens` ceiling (G7-11) + `missionTimeoutMs` |
| Bounded retries | YES — 6-retry backoff for 429; single retry for verification failure |
| Bounded mission duration | YES — `missionTimeoutMs` (default 10 min) |
| Bounded concurrency | YES — per-caller `maxActiveMissions` + global `maxActiveMissionsGlobal` (50) |
| Worker-count limits | YES — `maxWorkerSteps` (default 5) + genome-driven worker count |
| Budget enforcement | YES — `maxTotalTokens` (G7-11); USD pricing unavailable from SDK |

### 6.2 Failure Behavior

| Control | Status |
|---|---|
| Explicit terminal failures | YES — FAILED/PARTIAL/CANCELLED statuses |
| No false-positive verification | YES — `acceptanceCriteria` (G7-11) + structural floor |
| No fabricated artifacts | YES — clean-room verification |
| No silent fallback | YES — production mode fail-closed |
| No infinite recovery loops | YES — bounded retry (single) + timeout |

### 6.3 Security

| Control | Status |
|---|---|
| Credentials outside Git | YES — `.env.local` gitignored; PAT stored externally |
| Sensitive output redaction | YES — `scrubSecrets()` multi-layer |
| Gateway authentication | YES — Bearer token + constant-time comparison |
| Caller isolation | YES — ownership-filtered list + cross-caller 404 |
| No unauthorized runtime capabilities | YES — `checkCommandPolicy()` blocklist |
| No untrusted arbitrary code execution | YES — strict `WorkerAction` union |

### 6.4 Observability

| Control | Status |
|---|---|
| Mission ID correlation | YES — UUID per mission |
| Worker execution evidence | YES — flight recorder events |
| Provider usage evidence | YES — `ReasoningUsage` telemetry |
| Artifact references | YES — `ArtifactRegistry` JSONL |
| Verification results | YES — `VerificationResult.outcomes[]` |
| Error classification | YES — G6-01 failure taxonomy |

### 6.5 Maintainability

| Control | Status |
|---|---|
| Minimal additional code | YES — 5 files modified, +183 lines |
| No duplicate services | YES — no second orchestrator/registry/verifier |
| No new dependencies | YES — 0 new deps |
| Clear extension points | YES — `checks` seam, `acceptanceCriteria` transport field |
| Regression tests | YES — 21 new tests (13 acceptance + 8 provider) |
| Documented limitations | YES — failure-mode matrix + this document |

---

## 7. G7-12 Readiness Recommendation

Before G7-12 (Conversational Home) begins, the following should be resolved:

1. **Provision ZAI SDK + credentials:** Install `z-ai-web-dev-sdk` or set
   `ZAI_SDK_PATH`; set `ZAI_API_KEY`. This unblocks Mission A real-execution
   qualification.
2. **Provision OpenBot checkout:** Clone the OpenBot repository; set
   `OPENBOT_CHECKOUT_DIR` + `OPENBOT_ROOT_DIR`.
3. **Re-run Mission A:** With real providers, execute the `genesis_demo.md`
   mission with `acceptanceCriteria` specifying the 8 required section headings.
   Verify the real LLM produces the correct artifact.
4. **Reconcile G7-08C/D:** Retrieve rate-limiting + AuthGate hardening from
   Z.ai Preview or re-implement them.
5. **Set G7-11 budget:** Configure `maxTotalTokens` on the ZAI provider to
   enforce the $2 qualification ceiling (token proxy for USD).

G7-12 can proceed with Conversational Home development in parallel with
credential provisioning, but real-execution qualification (Mission A) should
be completed before G7-15 (Integrated Product Acceptance).

---

## 8. Final Qualification Statement

**The Genesis real-execution foundation is architecturally qualified. The
P1 hardening defects are fixed and verified. Real-provider execution is
blocked by missing credentials/runtime (environmental, not structural).**

**Launch readiness: QUALIFIED WITH LIMITATIONS.**

The limitations are:
1. Real-provider execution not yet demonstrated (Mission A BLOCKED).
2. Budget enforcement uses token proxy (USD pricing unavailable from SDK).
3. G7-08C/D preview changes not reconciled.

These limitations do not block G7-12 development. They must be resolved before
G7-15 (Integrated Product Acceptance).

---

**End of Launch Readiness Decision.**
