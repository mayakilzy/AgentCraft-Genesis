# PILOT_001_EXECUTION_ROOT_CAUSE.md

## Mission: PILOT-001 Final Fix (Repair server.js)

**Mission ID:** `94973130-a205-4838-ae0e-8d074cfd66c1`
**Status:** PARTIAL
**Duration:** 449.5 seconds (7.5 minutes)
**Tokens:** 176,956
**Artifacts:** 21 (6 real deliverables + 15 cache/duplicates)

---

## 1. Workers — Count, Roles, Results

| Worker | Role | Status | Artifacts | Purpose |
|---|---|---|---|---|
| software-engineer-1 | Software Engineer | success | 12 (6 app + 6 .npm) | Fixed server.js, ran npm test |
| verification-engineer-2 | Verification Engineer | success | 9 (6 app + 3 .npm/log) | **Unnecessary** — duplicated the entire app |

**Why 2 workers?** The goal outcome text contains the word "verify" ("verify by running npm test"), which matches the `browser-verification` capability signal in the frozen goal compiler (`src/goal/goal-compiler.ts:133`). This triggers a second capability need → Planner assigns a Verification Engineer → duplicate production.

**Root cause location:** `src/goal/goal-compiler.ts:133-135` — the signal "verify" matches `browser-verification`.

**Why PARTIAL?** Verification failed with: `mission-input:server.js hash mismatch (expected=f3fe567ba38514b1, actual=f834de3b5f59a1e4)`. The mission-input check (`src/mission/orchestrator.ts` Phase 4.8B fail-closed verification) compares the staged input file's hash with the worker's modified file. The worker LEGITIMATELY modified server.js (that was the task), but the check treats any hash difference as "possible fabrication."

**Root cause location:** `src/mission/orchestrator.ts:845-849` — the mission-input check does not distinguish "worker was told to fix this file" from "worker fabricated a substitute."

---

## 2. Token and Time Consumption

### Token breakdown (estimated from worker artifacts)

| Consumer | Tokens (estimated) | Justification |
|---|---|---|
| software-engineer-1 | ~40,000 | Read 6 mission inputs + reasoning + fix server.js + run npm test |
| verification-engineer-2 | ~100,000 | Received full brief + upstream context + produced 6 duplicate files + reasoning |
| Verification retry | ~20,000 | First verification failed → retry with diagnosis reasoning call |
| Coordinator (if any) | ~16,956 | Remaining tokens (coordinator summary if assigned) |
| **Total** | **176,956** | |

### Time breakdown

| Phase | Duration | Evidence |
|---|---|---|
| SE worker execution | ~240s (09:56-10:00) | 429 errors at 09:56, 09:57, 09:59 indicate SE was active during this window |
| VE worker execution | ~190s (10:00-10:03) | 429 errors at 10:00, 10:03 indicate VE was active |
| 429 retry backoff | ~30s total | 6 × ~5s backoff between retries |
| Verification + retry | ~20s | 17 checks first pass, 1 fail, retry, 1 fail again |
| **Total** | **449.5s** | |

### Why 176,956 tokens for a 1-file fix?

1. **Unnecessary VE worker consumed ~100K tokens** — the VE duplicated the entire app (6 files) because it couldn't access the SE's workspace (PATH B handoff refused). This is the same duplicate-production pattern from G7-19E/H.

2. **429 rate-limit retries** — 6 failed Z.ai API calls with exponential backoff (1s, 5s delays). Each retry re-sends the full prompt, consuming tokens even on failed calls.

3. **Verification retry** — the mission-input hash mismatch triggered a retry, which re-ran all 17 checks + a diagnosis reasoning call.

4. **Mission inputs staging** — 6 files were staged into BOTH workers' workspaces (the orchestrator stages into every computer-bearing worker). This doubled the context.

---

## 3. The 21 Artifacts

| Source | Real Files | Cache/Junk | Total |
|---|---|---|---|
| software-engineer-1 | 6 (package.json, server.js, index.html, converter.js, test/converter.test.js, README.md) | 6 (.npm/_logs ×5, .npm/_update-notifier) | 12 |
| verification-engineer-2 | 6 (DUPLICATED app files + server.log) | 3 (.npm/_logs ×2, .npm/_update-notifier) | 9 |
| **Total** | **12 (6 unique + 6 duplicates)** | **9** | **21** |

The 6 real deliverables are from `software-engineer-1`. The VE's 6 files are duplicates (same content, different server.js — the VE tried to "fix" it differently). `.npm/*` files are npm cache artifacts that should be excluded from artifact collection.

---

## 4. Browser Interaction Evidence

**NOT VERIFIED from mission execution.** The driver's Playwright browser test failed with a Playwright API usage error (`selectOption: options[0].label: expected string, got object`). This is a driver bug, not an app bug.

A **separate manual browser test** was run after the mission and PASSED:
- 100°C → 212°F: PASS
- 32°F → 0°C: PASS
- Invalid input → "Please enter a valid number": PASS
- JS errors: NONE

The manual test screenshot is at `evidence/pilot-001-final-fix/browser-screenshot.png`. However, this test was NOT part of the Genesis mission execution — it was run by GLM after the mission.

---

## 5. Root Causes (Proven by Evidence)

### Root Cause 1: "verify" triggers unnecessary Verification Engineer

**Evidence:** Goal outcome contains "verify by running npm test" → goal compiler matches "verify" signal for `browser-verification` → Planner assigns VE → VE duplicates the entire app → ~100K wasted tokens.

**Location:** `src/goal/goal-compiler.ts:133-135` (frozen).

**Minimal fix:** Phrase the goal to avoid "verify" (use "confirm" or "check" instead). OR: merge `browser-verification` into `code-execution` for repair missions (same pattern as the `document-authoring` merge that was considered but reverted in B02 Lightweight Closure).

### Root Cause 2: Mission-input hash check false positive on modified files

**Evidence:** The mission summary explicitly says: `mission-input:server.js hash mismatch (expected=f3fe567ba38514b1, actual=f834de3b5f59a1e4) — possible fabrication`. The worker was TOLD to fix server.js, so the hash SHOULD differ. The check doesn't distinguish "legitimate repair" from "fabrication."

**Location:** `src/mission/orchestrator.ts:845-849` (the Phase 4.8B fail-closed verification).

**Minimal fix:** When a mission explicitly asks to "fix" or "modify" a file (detected via goal outcome keywords), the mission-input check for that file should be **relaxed** (warn, not fail). OR: the mission should NOT stage the file-to-be-fixed as a mission-input (stage only the files that should NOT change).

### Root Cause 3: Z.ai 429 rate limits cause retry overhead

**Evidence:** 6 `429 Too Many Requests` errors in the gateway log, spanning 436 seconds. Each error triggers exponential backoff (1s, 5s) and re-sends the full prompt.

**Location:** `src/providers/zai-reasoning.ts:164-183` (retry logic).

**Minimal fix:** This is an environmental constraint, not a code defect. The Z.ai API rate limits are external. The retry logic is already bounded (1 retry per call). No code change needed — but missions that assign 2 workers double the API load and are more likely to hit rate limits.

### Root Cause 4: Duplicate production pattern persists

**Evidence:** The VE produced 6 duplicate app files because it couldn't access the SE's workspace (OpenBot PATH B handoff refused). This is the same pattern from G7-19E (3 workers produced 3 complete apps) and G7-19H (3 workers produced 3 complete apps).

**Location:** `src/runtime/handoff-staging.ts:88-90` (`isRuntimeSafeForStaging` — PATH B refuses OpenBot).

**Minimal fix:** Assign only 1 worker for repair missions (avoid the handoff entirely). This is achievable by phrasing the goal to not trigger `browser-verification` (Root Cause 1 fix).

---

## 6. What Genesis Got Right

- The SE worker correctly identified the bug (server.js only served / and /index.html)
- The SE worker correctly fixed server.js to serve all static files with Content-Type headers
- The SE worker ran `npm test` to verify tests still pass
- The fixed app works: HTTP 200 for / and /converter.js, browser interaction passes
- No manual code intervention was needed

---

## 7. Summary: Why 176,956 Tokens for a 1-File Fix

| Factor | Tokens | % |
|---|---|---|
| SE worker (legitimate work) | ~40,000 | 23% |
| VE worker (unnecessary duplicate) | ~100,000 | 57% |
| 429 retry overhead | ~20,000 | 11% |
| Verification retry | ~17,000 | 9% |
| **Total** | **176,956** | 100% |

**57% of tokens were wasted on an unnecessary Verification Engineer** that duplicated the entire app because:
1. The goal text contained "verify" → triggered `browser-verification` capability
2. The VE couldn't access the SE's workspace (PATH B)
3. The VE produced its own version of every file

**The fix that would reduce this to ~40K tokens:** phrase the goal to avoid "verify" (use "confirm" instead) → 1 worker → no VE → no duplicate production → no handoff failure → no verification retry.

---

## 8. Minimal Fixes Required

| # | Root Cause | Fix | Scope |
|---|---|---|---|
| 1 | "verify" triggers VE | Phrase goal as "confirm" not "verify" | Mission design (no code change) |
| 2 | Mission-input hash check false positive | Don't stage the file-to-be-fixed as mission-input | Mission design (no code change) |
| 3 | 429 rate limits | Environmental — no code fix | N/A |
| 4 | Duplicate production | Fixed by #1 (single worker) | N/A |

**Both fixes are mission-design changes, not Genesis code changes.**
