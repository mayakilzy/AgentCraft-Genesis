# G7-11 — Acceptance Evidence

**Mission:** G7-11
**Branch:** `qualify/g7-11-real-execution`
**Baseline:** `35f180732e5c0dbf163a9f19455ed981aa83211f`

---

## Mission A — Exact Artifact Creation

| Criterion | Result | Evidence |
|---|---|---|
| Real provider-backed mission executed | **BLOCKED** | ZAI SDK not installed; OpenBot checkout unavailable |
| genesis_demo.md produced | **BLOCKED** | No real provider to produce it |
| 8 section headings present | **BLOCKED** | N/A — no artifact produced |
| Model-generated content (not scripted) | **BLOCKED** | N/A |
| No development fallback used | **BLOCKED** | N/A — cannot run real mission |
| Provider usage recorded | **BLOCKED** | 0 real calls |

**Mission A verdict: BLOCKED** — environmental blocker (missing credentials/runtime), not a structural defect.

---

## Mission B — Negative Verification

| Test ID | Scenario | Expected | Result | Evidence |
|---|---|---|---|---|
| AC-02 | Wrong filename (`genesis_demo.md` required, `output.md` produced) | Verification FAILS | **PASS** | `tests/gateway/g7-11-acceptance-criteria.test.ts:AC-02` — status not SUCCEEDED |
| AC-04 | Wrong content (`# Project Overview` required, absent) | Verification FAILS | **PASS** | `tests/gateway/g7-11-acceptance-criteria.test.ts:AC-04` — status not SUCCEEDED |
| AC-05 | content-in-artifacts with absent substring | Verification FAILS | **PASS** | `tests/gateway/g7-11-acceptance-criteria.test.ts:AC-05` — status not SUCCEEDED |
| AC-06 | hash-match with wrong hash | Verification FAILS | **PASS** | `tests/gateway/g7-11-acceptance-criteria.test.ts:AC-06` — status not SUCCEEDED |
| AC-08 | Multiple criteria, one fails | Overall FAILS | **PASS** | `tests/gateway/g7-11-acceptance-criteria.test.ts:AC-08` — status not SUCCEEDED |

**Mission B verdict: PASS** — all negative cases correctly fail verification. No false-positive goal-satisfaction claim.

---

## Mission C — Bounded Recovery

| Test ID | Scenario | Expected | Result | Evidence |
|---|---|---|---|---|
| RC-01 | Mission reaches terminal state | No infinite hang | **PASS** | `tests/gateway/g7-11-acceptance-criteria.test.ts:RC-01` — terminal=true |
| RC-02 | Cancellation produces terminal status | CANCELLED or terminal | **PASS** | `tests/gateway/g7-11-acceptance-criteria.test.ts:RC-02` — terminal=true |
| RC-03 | Retry is bounded (single retry) | Mission terminates after retry | **PASS** | `tests/gateway/g7-11-acceptance-criteria.test.ts:RC-03` — awaitCompletion returns (not hung) |
| RC-04 | Concurrent missions isolated | Both complete independently | **PASS** | `tests/gateway/g7-11-acceptance-criteria.test.ts:RC-04` — both terminal, different IDs |

**Mission C verdict: PASS** — recovery is bounded, no infinite loops, concurrent isolation works.

---

## P1 Fix Verification

### FM-07/FM-08 — Acceptance Criteria Wiring

| Test ID | Scenario | Result | Evidence |
|---|---|---|---|
| AC-01 | Correct filename + file check → PASSES | **PASS** | `tests/gateway/g7-11-acceptance-criteria.test.ts:AC-01` |
| AC-03 | Correct content + expectIncludes → PASSES | **PASS** | `tests/gateway/g7-11-acceptance-criteria.test.ts:AC-03` |
| AC-07 | No criteria → structural floor applies | **PASS** | `tests/gateway/g7-11-acceptance-criteria.test.ts:AC-07` |
| AC-09 | Malformed criteria silently skipped | **PASS** | `tests/gateway/g7-11-acceptance-criteria.test.ts:AC-09` |

### FM-02 — Provider Per-Call Timeout

| Test ID | Scenario | Result | Evidence |
|---|---|---|---|
| TO-01 | callTimeoutMs wraps SDK call with AbortSignal | **PASS** | `tests/providers/g7-11-provider-hardening.test.ts:TO-01` |
| TO-02 | No callTimeoutMs → no signal | **PASS** | `tests/providers/g7-11-provider-hardening.test.ts:TO-02` |

### FM-12 — Budget Enforcement

| Test ID | Scenario | Result | Evidence |
|---|---|---|---|
| BG-01 | Calls under ceiling succeed | **PASS** | `tests/providers/g7-11-provider-hardening.test.ts:BG-01` |
| BG-02 | Post-call ceiling exceeded → BudgetExceededError | **PASS** | `tests/providers/g7-11-provider-hardening.test.ts:BG-02` |
| BG-03 | Pre-call ceiling reached → refuse before consuming resources | **PASS** | `tests/providers/g7-11-provider-hardening.test.ts:BG-03` |
| BG-04 | BudgetExceededError not retryable | **PASS** | `tests/providers/g7-11-provider-hardening.test.ts:BG-04` |
| BG-05 | Error carries token usage details | **PASS** | `tests/providers/g7-11-provider-hardening.test.ts:BG-05` |
| BG-06 | No maxTotalTokens → no enforcement (backward compatible) | **PASS** | `tests/providers/g7-11-provider-hardening.test.ts:BG-06` |

---

## Three Truth Levels

| Level | Question | Mechanism | Verified |
|---|---|---|---|
| Level 1 — Execution Completion | Did the workflow complete? | `MissionResult.status` | YES (existing + G7-10 UI disclosure) |
| Level 2 — Artifact Integrity | Was the expected artifact produced? | `VerificationResult.ok` + structural floor | YES (existing `buildChecks()` file-existence) |
| Level 3 — Goal Satisfaction | Did the result satisfy approved criteria? | Caller `acceptanceCriteria` → `AcceptanceCheck` evaluation | **YES (G7-11)** — 13 tests verify |

---

## Regression Test Results

| Suite | Tests | Result |
|---|---|---|
| All existing engine tests | 590 passed, 9 skipped | **PASS** |
| G7-10 tests (worker-count, mission-list, UI acceptance) | 46 passed | **PASS** |
| G7-11 new tests (acceptance criteria, provider hardening) | 21 passed | **PASS** |
| **Engine total** | **657 passed, 9 skipped, 0 failed** | **PASS** |
| Engine typecheck | — | **PASS** |
| Engine lint | — | **PASS** (0 errors) |
| Web typecheck | — | **PASS** |
| Web lint | — | **PASS** (0 errors, 4 pre-existing warnings) |

---

## Frozen Contracts Verification

| Contract | git diff vs baseline | Status |
|---|---|---|
| `src/contracts/core.ts` | empty | **UNCHANGED** |
| `src/mission/verification.ts` | empty | **UNCHANGED** |
| `src/mission/orchestrator.ts` | empty | **UNCHANGED** |
| `src/goal/goal-compiler.ts` | empty | **UNCHANGED** |

---

## Credential Safety

| Check | Result |
|---|---|
| GitHub PAT in tracked files | NO |
| ZAI_API_KEY in tracked files | NO |
| .env.local tracked | NO (gitignore active) |
| Production credentials exposed | NONE |
| Test mocks use real credentials | NO (all mocks use fake data) |

---

**End of Acceptance Evidence.**
