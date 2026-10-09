# G7-11 — Real Execution Qualification Report

**Mission ID:** G7-11
**Mode:** AUDIT → QUALIFY → REPAIR → VERIFY → REPORT
**Implementation Branch:** `qualify/g7-11-real-execution`
**Baseline:** `35f180732e5c0dbf163a9f19455ed981aa83211f` (G7-10 HEAD)

---

## 1. Executive Summary

G7-11 audited the complete real-execution path, identified 3 P1 defects (plus
1 shared root cause), fixed all of them with minimal additive changes, and
verified the fixes with 21 new tests. Real-provider execution (Mission A) is
**BLOCKED** because the ZAI SDK and OpenBot runtime are unavailable in this
environment. The hardening fixes are verified via mock/stub tests and are
ready for real-provider qualification when credentials are provisioned.

**No frozen contracts were modified. No production deployment occurred.**

---

## 2. Audit Findings (Phase 0)

### 2.1 Real-Execution Path Audit

The complete path was traced and inspected:

```
User Goal → Gateway → GoalCompiler → OrganizationPlanner → GenomeCompiler
  → MissionOrchestrator → WorkerAgent → ReasoningProvider → Runtime
  → Artifact Production → buildChecks() → VerificationLoop → MissionResult
```

**Finding:** The path is structurally wired correctly. Production mode
fail-closes at startup if providers are missing (`main.ts:316-346`). No silent
fallback to dev fixtures.

### 2.2 Environment Availability

| Component | Available? |
|---|---|
| ZAI SDK (`z-ai-web-dev-sdk`) | NO — not in node_modules, not global, `ZAI_SDK_PATH`/`ZAI_API_KEY` unset |
| OpenBot checkout | NO — `OPENBOT_CHECKOUT_DIR`/`OPENBOT_ROOT_DIR` unset, no checkout on disk |
| Stub reasoning provider | YES (for tests only — NOT real AI) |
| MemoryRuntime | YES (for tests only — NOT real runtime) |

**Conclusion:** Real execution is BLOCKED. See `docs/g7-11/production-failure-mode-matrix.md`
for the full audit.

### 2.3 Failure-Mode Matrix Summary

| Severity | Count | Status |
|---|---|---|
| P0 | 0 | — |
| P1 | 3 (FM-02, FM-07/08, FM-12) | ALL FIXED |
| P2 | 13 | Acceptable/documented |

---

## 3. P1 Hardening Fixes (Phase 2 + Phase 4)

### 3.1 FM-07/FM-08 — Acceptance Criteria Wiring

**Root cause:** `buildChecks()` emitted only file-existence checks; no mechanism
for callers to specify expected filename/content/hash.

**Fix (smallest compatible):**
- Added `acceptanceCriteria?: readonly AcceptanceCheckInput[]` to `MissionSubmission` (transport type, NOT frozen `Goal`).
- Added `AcceptanceCheckInput` union (file, content-in-artifacts, hash-match) to gateway types.
- Modified `buildChecks()` to merge caller criteria with the structural floor.
- Modified `parseSubmission()` to parse the new field from POST body.
- Added matching types to web client.

**Files changed:** `src/gateway/types.ts`, `src/gateway/mission-service.ts`, `src/gateway/http-server.ts`, `web/src/lib/genesis/types.ts`.

**Verification:** 13 tests in `tests/gateway/g7-11-acceptance-criteria.test.ts` — all PASS.

### 3.2 FM-02 — Provider Per-Call Timeout

**Root cause:** `ZAIReasoningProvider.attemptReason()` had no per-call timeout; a single hung SDK call could consume the entire mission budget.

**Fix:**
- Added `callTimeoutMs?: number` to `ZAIReasoningOptions`.
- Pass `AbortSignal.timeout(callTimeoutMs)` in the SDK request params.

**Files changed:** `src/providers/zai-reasoning.ts`.

**Verification:** 2 tests (TO-01, TO-02) in `tests/providers/g7-11-provider-hardening.test.ts` — PASS.

### 3.3 FM-12 — Budget Enforcement

**Root cause:** `WorkerBudget.maxUsd` was advisory (recorded, not enforced). No mechanism to stop a runaway mission.

**Fix:**
- Added `maxTotalTokens?: number` to `ZAIReasoningOptions` (token proxy for USD — SDK does not expose pricing).
- Pre-call check: if `totalTokens >= maxTotalTokens`, throw `BudgetExceededError` BEFORE consuming resources.
- Post-call check: if the call pushed `totalTokens` over the ceiling, throw immediately.
- `BudgetExceededError` is NOT retryable (not a 429) — propagates to orchestrator → mission FAILED.

**Files changed:** `src/providers/zai-reasoning.ts`.

**Verification:** 6 tests (BG-01..BG-06) — all PASS.

---

## 4. Qualification Missions

### 4.1 Mission A — Exact Artifact Creation

**Status: BLOCKED**

**Reason:** ZAI SDK and OpenBot runtime are unavailable. No real provider can
be instantiated. Per mission rules: "If live execution is blocked, report
qualification as BLOCKED—not PASS."

**What would be tested (when unblocked):**
- Submit a mission requiring `genesis_demo.md` with 8 section headings.
- Use `acceptanceCriteria` to verify exact filename + content.
- Confirm the real LLM produces original content (not a scripted template).
- Confirm no development fallback was used.

**Acceptance criteria ready:** The `acceptanceCriteria` wiring is implemented
and verified with stub providers. When real credentials are provisioned,
Mission A can be executed by submitting:
```json
{
  "outcome": "Create genesis_demo.md with sections: Project Overview, Objectives, System Architecture, Agent Organization, Execution Workflow, Verification Strategy, Risks and Mitigations, Expected Deliverables.",
  "acceptanceCriteria": [
    { "kind": "file", "label": "genesis_demo.md exists", "path": "genesis_demo.md" },
    { "kind": "content-in-artifacts", "label": "has Project Overview", "expectIncludes": "Project Overview" },
    { "kind": "content-in-artifacts", "label": "has Objectives", "expectIncludes": "Objectives" }
  ]
}
```

### 4.2 Mission B — Negative Verification

**Status: PASS (13 tests)**

All negative cases are verified in `tests/gateway/g7-11-acceptance-criteria.test.ts`:
- AC-02: wrong filename → verification FAILS.
- AC-04: wrong content (expectIncludes mismatch) → FAILS.
- AC-05: content-in-artifacts with absent substring → FAILS.
- AC-06: hash-match with wrong hash → FAILS.
- AC-08: multiple criteria, one fails → overall FAILS.

Every invalid case fails its relevant acceptance check. No false-positive
verification.

### 4.3 Mission C — Bounded Recovery

**Status: PASS (4 tests)**

Verified in `tests/gateway/g7-11-acceptance-criteria.test.ts` (Mission C section):
- RC-01: mission reaches terminal state (no infinite hang).
- RC-02: cancellation produces terminal status.
- RC-03: retry is bounded (single retry, then terminal).
- RC-04: concurrent missions are isolated.

---

## 5. Provider Usage & Cost Evidence

| Metric | Value |
|---|---|
| Real provider calls | 0 (BLOCKED — no real provider available) |
| Mock provider calls (tests) | ~30 (deterministic, no cost) |
| Token usage (real) | 0 (no real calls) |
| Token usage (mock tests) | Tracked in test assertions |
| Estimated cost USD | $0 (no paid calls made) |
| Budget enforcement | IMPLEMENTED (`maxTotalTokens`) — verified via mock tests |

**No paid provider calls were made.** The $2 budget ceiling was not consumed.
Budget enforcement is verified via mock tests (BG-01..BG-06).

---

## 6. Test Results

### 6.1 Engine Test Suite

| Metric | Count |
|---|---|
| Test files | 74 |
| Tests passed | 657 |
| Tests skipped | 9 (pre-existing) |
| Tests failed | 0 |

### 6.2 New G7-11 Tests

| Suite | Tests | Result |
|---|---|---|
| `tests/gateway/g7-11-acceptance-criteria.test.ts` | 13 (AC-01..09 + RC-01..04) | PASS |
| `tests/providers/g7-11-provider-hardening.test.ts` | 8 (TO-01..02 + BG-01..06) | PASS |
| **Total new** | **21** | **PASS** |

### 6.3 Type Checks

| Project | Result |
|---|---|
| Engine | PASS |
| Web | PASS |

### 6.4 Lint

| Project | Result |
|---|---|
| Engine | PASS (0 errors) |
| Web | PASS (0 errors, 4 pre-existing warnings) |

### 6.5 Frozen Contracts

| Contract | Status |
|---|---|
| `src/contracts/core.ts` | UNCHANGED |
| `src/mission/verification.ts` | UNCHANGED |
| `src/mission/orchestrator.ts` | UNCHANGED |
| `src/goal/goal-compiler.ts` | UNCHANGED |

---

## 7. Files Modified and Created

### 7.1 Modified (5)

| File | Change |
|---|---|
| `src/gateway/types.ts` | Added `acceptanceCriteria` to `MissionSubmission` + `AcceptanceCheckInput` union |
| `src/gateway/mission-service.ts` | Wired `acceptanceCriteria` to `buildChecks()`; stored on `MissionRuntime` |
| `src/gateway/http-server.ts` | Parse `acceptanceCriteria` in `parseSubmission()` |
| `src/providers/zai-reasoning.ts` | Added `callTimeoutMs` (FM-02) + `maxTotalTokens` (FM-12) + `BudgetExceededError` |
| `web/src/lib/genesis/types.ts` | Added `acceptanceCriteria` + `AcceptanceCheckInput` to web types |

### 7.2 Created (5)

| File | Purpose |
|---|---|
| `docs/g7-11/production-failure-mode-matrix.md` | Phase 0 failure-mode audit |
| `docs/g7-11/launch-readiness-decision.md` | Launch readiness decision |
| `G7-11_Real_Execution_Qualification_Report.md` | This report |
| `G7-11_Acceptance_Evidence.md` | Acceptance evidence matrix |
| `tests/gateway/g7-11-acceptance-criteria.test.ts` | 13 tests (Mission B + C) |
| `tests/providers/g7-11-provider-hardening.test.ts` | 8 tests (FM-02 + FM-12) |

**Total diff:** 5 files modified, 6 files created, +183 lines (code) + ~1000 lines (docs/tests).

---

## 8. Known Limitations

1. **Real execution BLOCKED:** ZAI SDK + OpenBot unavailable. Mission A not executed.
2. **Budget proxy:** `maxTotalTokens` enforces token ceiling; USD pricing unavailable from SDK.
3. **G7-08C/D not reconciled:** Rate-limiting + AuthGate hardening still in Z.ai Preview only.
4. **Semantic verification deferred:** LLM-based goal satisfaction evaluator (Path C) not implemented; Paths A (implemented) + B (future) are sufficient for objectively testable criteria.
5. **No production deployment:** Per frozen constraint.

---

## 9. Final Commit SHA

The implementation is committed on branch `qualify/g7-11-real-execution`.
The final commit SHA is recorded in the final response.

**No merge into main. No production deployment.**

---

**End of Report.**
