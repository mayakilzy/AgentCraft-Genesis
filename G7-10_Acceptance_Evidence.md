# G7-10 — Acceptance Evidence

**Mission ID:** G7-10
**Implementation Branch:** `fix/g7-10-truthfulness-mission-visibility`
**Baseline Commit:** `cfd42bb181f9eab5402cb9ad024cf22c7193b2f8`

This document records the results of acceptance tests A1-A6, B1-B9, and C1-C3
as defined in the G7-10 mission specification. Every result is backed by
actual test execution or source inspection evidence.

---

## Workstream A — UI Truthfulness

### A1 — Controlled-demo disclosure

**Requirement:** A controlled-mode mission reporting execution success displays
the contextual warning near its result.

**Evidence:**
- Source: `web/src/components/genesis/MissionControlDetail.tsx` lines 287-324
  (truthfulness disclosure card rendered when `snapshot?.terminal` is true).
- The disclosure is rendered for ALL terminal missions. When
  `genesisMode !== 'live'` (controlled mode), it displays:
  "Controlled Demo: execution completed, but satisfaction of the user's
  requested outcome has not been verified. Generated artifacts may be
  simulated."
- When `genesisMode === 'live'`, it displays:
  "acceptance criteria wiring is deferred to a future phase (see G7-10 design
  document)."

**Result:** PASS — disclosure is present and contextually correct.

---

### A2 — No unsupported failure assertion

**Requirement:** The UI does not claim the goal definitely failed unless a
real check established that result.

**Evidence:**
- Source: `web/src/components/genesis/MissionControlDetail.tsx` lines 315-321.
- The disclosure states "Goal satisfaction: NOT MEASURED" — it does NOT claim
  the goal failed. It explicitly says satisfaction "has not been verified."
- The `MissionControlDetail` outcome card (lines 241-285) shows the actual
  `MissionResult.status` (which may be SUCCEEDED/FAILED/PARTIAL/CANCELLED)
  but the truthfulness disclosure clarifies that this is execution status,
  not goal satisfaction.

**Result:** PASS — no unsupported failure assertion.

---

### A3 — Goal satisfaction metric

**Requirement:** Insights displays `NOT MEASURED` where no goal-satisfaction
evaluation exists.

**Evidence:**
- Source: `web/src/components/genesis/InsightsSection.tsx` lines 103-110
  (metric metadata) + lines 311-318 (metric row rendered).
- The `goalSatisfaction` metric has `kind: NOT_AVAILABLE` and display value
  `NOT MEASURED`.
- The note explains: "Controlled demo — goal alignment is not evaluated"
  (controlled mode) or "Acceptance criteria wiring is deferred (G7-11+)"
  (live mode).

**Result:** PASS — `NOT MEASURED` displayed with context.

---

### A4 — Worker-count consistency

**Requirement:** The same mission produces consistent worker identity counts
across all applicable sections.

**Evidence:**
- Source change: `web/src/components/genesis/InsightsSection.tsx` —
  `deriveWorkerCount` REMOVED (was at lines 341-346); replaced with
  `Object.keys(extractWorkers(events)).length` at line 295.
- All three components now use `extractWorkers` from
  `web/src/lib/genesis/events.ts`:
  - `MissionControlDetail.tsx` line 140: `extractWorkers(events)`
  - `sections/Sections.tsx` line 186 (AgentSection): `extractWorkers(events)`
  - `InsightsSection.tsx` line 295: `Object.keys(extractWorkers(events)).length`
- Test: `tests/g7-10-worker-count-consistency.test.ts` — 9 tests, all PASS.
  - Test A4: "counts distinct workers from plan-created" — PASS
  - Test A4b: "workers in worker-started but NOT plan-created are counted" — PASS
  - Test A4c: "workers only in genomes-compiled are counted" — PASS
  - Test A4d: "verifier workers counted consistently" — PASS
  - Test A4e: "handoff events do NOT create spurious records" — PASS
  - Test A4g: "same mission consistent count regardless of event order" — PASS

**Result:** PASS — single canonical extraction strategy across all views.

---

### A5 — Repeated-event resilience

**Requirement:** Multiple events for one worker do not cause double counting.

**Evidence:**
- Source: `web/src/lib/genesis/events.ts` lines 322-462 (`extractWorkers`).
  The `update()` helper (lines 326-342) merges by workerId — repeated events
  for the same workerId update the existing record, they do not create new ones.
  `stepCount` and `retryCount` are incremented (not used for identity).
- Test: `tests/g7-10-worker-count-consistency.test.ts`:
  - Test A5: "repeated worker-step events do NOT inflate the count" — 4 steps,
    1 worker. PASS.
  - Test A5b: "repeated worker-retry events do NOT inflate the count" — 3
    retries, 1 worker. PASS.

**Result:** PASS — repeated events do not inflate the count.

---

### A6 — Production-mode semantics

**Requirement:** Non-controlled mode does not automatically claim goal
satisfaction without appropriate evidence.

**Evidence:**
- Source: `web/src/components/genesis/MissionControlDetail.tsx` lines 316-321.
  When `isControlled` is false (`genesisMode === 'live'`), the disclosure says:
  "Goal satisfaction: NOT MEASURED — acceptance criteria wiring is deferred
  to a future phase (see G7-10 design document)."
- It does NOT claim goal satisfaction in live mode. It states the same
  `NOT MEASURED` status, with a different note (deferred vs. controlled-demo).
- The `InsightsSection` goal satisfaction metric is `NOT_AVAILABLE` regardless
  of mode (lines 103-110).

**Result:** PASS — no automatic goal-satisfaction claim in any mode.

---

## Workstream B — Mission Visibility

### B1 — Mission listing

**Requirement:** Authenticated `GET /v1/missions?limit=10` returns a valid
response.

**Evidence:**
- Test: `tests/gateway/mission-list.test.ts` — test "B1: authenticated
  GET /v1/missions?limit=10 returns a valid response" — PASS.
  - Asserts status 200.
  - Asserts response has `missions` array and `nextCursor`.
  - Asserts each summary has `missionId`, `status`, `terminal`, `acceptedAt`,
    `outcomePreview`.
  - Asserts `missions.length > 0` and `<= 10`.
- Test: "B1b: unauthenticated request returns 401" — PASS.

**Result:** PASS.

---

### B2 — Caller isolation

**Requirement:** Caller A cannot enumerate Caller B's missions.

**Evidence:**
- Test: `tests/gateway/mission-list.test.ts` — test "B2: caller isolation —
  caller A cannot enumerate caller B missions" — PASS.
  - Submits one mission as caller A, one as caller B.
  - Asserts caller A's list contains idA but NOT idB.
  - Asserts caller B's list contains idB but NOT idA.
- Source: `src/gateway/mission-service.ts` `listMissions()` line 777:
  `if (rt.callerId !== caller.callerId) continue;` — ownership filter applied
  BEFORE building summaries.

**Result:** PASS.

---

### B3 — Pagination

**Requirement:** Multiple pages can be traversed without duplicates under
stable conditions.

**Evidence:**
- Test: `tests/gateway/mission-list.test.ts` — test "B3: pagination traverses
  all missions without duplicates" — PASS.
  - Traverses with `limit=2`, collecting all missionIds across pages.
  - Asserts no duplicate missionIds (`allIds.has(m.missionId)` is false for
    each new id).
  - Asserts at least one page traversed and total count > 0.

**Result:** PASS.

---

### B4 — Invalid input

**Requirement:** Malformed cursors and invalid page limits are handled safely.

**Evidence:**
- Test: "B4a: invalid limit (0) returns 400" — PASS (code `INVALID_LIMIT`).
- Test: "B4b: invalid limit (101) returns 400" — PASS (code `INVALID_LIMIT`).
- Test: "B4c: invalid limit (non-numeric) returns 400" — PASS (code `INVALID_LIMIT`).
- Test: "B4d: evicted/invalid cursor returns empty page (not error)" — PASS
  (status 200, `missions: []`, `nextCursor: null`).
- Source: `src/gateway/http-server.ts` `handleList()` lines 178-191 (limit
  validation) + `src/gateway/mission-service.ts` `listMissions()` lines 802-811
  (evicted cursor → empty page).

**Result:** PASS.

---

### B5 — UI loading

**Requirement:** MissionList retrieves current missions from the Gateway.

**Evidence:**
- Source: `web/src/components/genesis/MissionList.tsx` lines 66-92 (`fetchList`)
  + lines 98-114 (useEffect calls `fetchList()` on mount + polls every 4s).
- The component calls `genesisApi.listMissions({ limit: 50 })` on mount.
- Server records are rendered first (authoritative); local-only records
  (fallback) are rendered in a separate section marked "Local-only."

**Result:** PASS — server-authoritative loading implemented.

---

### B6 — Unavailable Gateway

**Requirement:** Cached records are visibly stale and are not presented as
current execution truth.

**Evidence:**
- Source: `web/src/components/genesis/MissionList.tsx` lines 130-145 (stale
  indicator) + lines 178-190 (local-only section header "Local-only (not
  confirmed by server)").
- When `loadState === 'stale'` or `'error'`, a warning box renders:
  "Last known — connection unavailable. Showing cached records which may be
  stale. Status is not current."
- Local-only records render with `opacity-60` and aria-label includes
  "Stale — not confirmed by server."

**Result:** PASS — stale records visibly marked.

---

### B7 — Terminal eviction

**Requirement:** Missions removed by the existing sweeper no longer appear in
the active registry listing.

**Evidence:**
- Test: `tests/gateway/mission-list.test.ts` — test "B7: terminal eviction —
  evicted missions disappear from the list" — PASS.
  - Submits a mission, confirms it appears in the list.
  - Calls `service.sweepTerminalMissions(Date.now() + 60 * 60 * 1000)` to
    force-evict all terminal missions.
  - Confirms the mission no longer appears in `GET /v1/missions`.

**Result:** PASS.

---

### B8 — Restart limitation

**Requirement:** Restarting the Gateway does not falsely restore active
mission records.

**Evidence:**
- Test: `tests/gateway/mission-list.test.ts` — test "B8: restart limitation —
  empty registry returns empty list" — PASS.
  - Creates a fresh `MissionService` (simulates restart — empty registry).
  - Calls `fresh.listMissions(CALLER_A, { limit: 10 })`.
  - Asserts `missions` is empty and `nextCursor` is null.
- UI: `MissionList.tsx` handles empty server list gracefully — shows
  `EmptyState` with persistence disclosure. Stale local records (if any) are
  marked "Local-only" — never presented as current server state.

**Result:** PASS.

---

### B9 — Existing endpoints

**Requirement:** Mission creation, retrieval, events, artifacts, and existing
BFF authentication remain functional.

**Evidence:**
- Test: `tests/gateway/mission-list.test.ts` — test "B9: existing endpoints
  remain functional (submit + get)" — PASS.
  - `POST /v1/missions` returns 202 with missionId.
  - `GET /v1/missions/{id}` returns 200 with snapshot.
  - Status is a valid `MissionStatus` value.
- Full regression: all 590 pre-existing engine tests PASS (0 failures).
  - `tests/gateway/e2e.test.ts` (E2E-01, E2E-02, FAIL-01, FAIL-02) — PASS.
  - `tests/gateway/isolation.test.ts` (ISO-01..ISO-04) — PASS.
  - `tests/gateway/execution-mode.test.ts` — PASS.
  - `tests/gateway/a2a-inbound.test.ts` — PASS.

**Result:** PASS — no regression in existing endpoints.

---

## Workstream C — Goal Satisfaction Design

### C1 — Design document

**Requirement:** The design document exists and explains the three
verification levels.

**Evidence:**
- File: `docs/g7-10/goal-satisfaction-verification-design.md` (exists, 8
  sections).
- Section 2 defines the three verification levels:
  - 2.1 Execution Success (authority: `MissionResult.status`)
  - 2.2 Artifact Integrity (authority: `VerificationResult.ok`)
  - 2.3 Goal Satisfaction (authority: none today; `NOT MEASURED`)
- Each level has a definition, authority, current behavior, and evidence
  references (file:line).

**Result:** PASS.

---

### C2 — Contract boundary

**Requirement:** No frozen contract is modified.

**Evidence:**
- `git diff cfd42bb -- src/contracts/core.ts` returns EMPTY (no changes).
- `src/mission/verification.ts` — NOT modified (AcceptanceCheck union frozen).
- `src/mission/orchestrator.ts` — NOT modified (checks seam frozen).
- `src/goal/goal-compiler.ts` — NOT modified.
- The only `src/` changes are additive types in `src/gateway/types.ts`
  (`MissionListSummary`, `MissionListResult`) and the `listMissions()` method
  in `src/gateway/mission-service.ts` — neither touches a frozen contract.

**Result:** PASS — no frozen contract modified.

---

### C3 — Tracked requirement

**Requirement:** Goal Satisfaction Verification remains an explicit requirement
for subsequent real-execution qualification.

**Evidence:**
- `docs/g7-10/goal-satisfaction-verification-design.md` Section 7:
  "Goal Satisfaction Verification remains an explicit requirement for
  subsequent real-execution qualification (G7-11 or a separately approved
  follow-up)."
- Section 5 recommends Path A (caller-supplied acceptance criteria) for G7-11.
- The G7-10 Implementation Report Section 8 lists "Goal Satisfaction
  Verification (implementation)" as deferred to G7-11 or follow-up.

**Result:** PASS — requirement is tracked and documented.

---

## Test Execution Summary

| Category | Suite | Tests | Result |
|---|---|---|---|
| A4/A5 | `tests/g7-10-worker-count-consistency.test.ts` | 9 | PASS |
| B1-B9 | `tests/gateway/mission-list.test.ts` | 13 | PASS |
| Regression | All existing engine tests | 590 passed, 9 skipped | PASS |
| **Total** | **71 files** | **612 passed, 9 skipped, 0 failed** | **PASS** |

| Check | Command | Result |
|---|---|---|
| Engine typecheck | `tsc --noEmit` | PASS |
| Engine lint | `eslint .` | PASS (0 errors) |
| Web typecheck | `tsc --noEmit` | PASS |
| Web lint | `eslint .` | PASS (0 errors, 4 pre-existing warnings) |

---

## Final Commit

**Branch:** `fix/g7-10-truthfulness-mission-visibility`
**Final commit SHA:** (recorded after `git commit` — see final response format)
**GitHub push status:** NOT_PUSHED (push authorization was unclear; local commit provided)

---

**End of Acceptance Evidence.**
