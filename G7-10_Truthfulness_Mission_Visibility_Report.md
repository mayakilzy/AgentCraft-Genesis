# G7-10 — Truthfulness & Mission Visibility: Implementation Report

**Mission ID:** G7-10
**Mode:** IMPLEMENT + TEST + REPORT
**Implementation Branch:** `fix/g7-10-truthfulness-mission-visibility`
**Baseline Commit:** `cfd42bb181f9eab5402cb9ad024cf22c7193b2f8` (G7-08A)
**Authoritative References:** G7-09 Product Infrastructure Readiness Report + Implementation Decision Matrix

---

## 1. Preflight Reconciliation Findings

### 1.1 Selected Baseline

**Baseline commit:** `cfd42bb181f9eab5402cb9ad024cf22c7193b2f8`
**Baseline branch:** `fix/g7-08-reproducibility`

Rationale: `cfd42bb` is the newest commit across all repository branches
(2026-10-08T17:02:13Z). It is a descendant of:
- `bff7b0a` (build/group-06-productionization)
- `80de122` (build/group-07-product-experience)

No commits exist after `cfd42bb` on any branch. The G7-10 implementation
branch was created directly from this commit.

### 1.2 Branch Topology

```
cfd42bb (fix/g7-08-reproducibility, G7-10 baseline) ← newest
  └── 0142288 (G7-08: yaml dep)
       └── 034fd3d (G7-08: web reproducibility)
            └── 80de122 (build/group-07-product-experience)
                 └── ... (G7-01 through G7-06)
                      └── bff7b0a (build/group-06-productionization)
```

### 1.3 G7-08C/D Preview Changes (Z.ai Preview only)

The G7-09 report (§L.2) documented preview-only changes in the Z.ai Preview
workspace that were NOT pushed to GitHub:

| Change | GitHub status at cfd42bb |
|---|---|
| `next.config.mjs` `allowedDevOrigins` | NOT present in tracked file |
| `web/src/lib/auth/rate-limit.ts` | NOT tracked (file does not exist) |
| `AuthGate.tsx` `devModeHint` removal | NOT applied (4 occurrences remain) |
| `.env.local` | NOT tracked (gitignore `*.env.local` working) |

**Conclusion:** The GitHub repository is a clean baseline. G7-08C/D changes
live only in the Z.ai Preview workspace and could not be accessed from the
GitHub clone. G7-10 was built on the clean GitHub baseline.

### 1.4 Secret Safety Verification

- `web/.env.local`: NOT tracked (gitignore `*.env.local` at line 17 is active).
- `web/.env.local`: does not exist on disk (was never committed).
- `web/.env.example`: safe template only (no real credential values).
- No secrets found in any tracked file.
- The GitHub PAT obtained for repository access was stored in a secure file
  outside the repository (`/home/z/my-project/secure/.git_token`, chmod 600)
  and was NEVER written into any tracked file, commit, test fixture, or report.

### 1.5 Baseline Test Results (before any G7-10 change)

| Check | Result |
|---|---|
| Engine vitest | 590 passed, 9 skipped, 0 failed (69 files) |
| Engine typecheck (`tsc --noEmit`) | PASS |
| Engine lint (`eslint .`) | PASS (0 errors) |
| Web typecheck (`tsc --noEmit`) | PASS |
| Web lint (`eslint .`) | PASS (0 errors, 4 pre-existing warnings) |

### 1.6 Protected Changes

No existing valid work was overwritten, discarded, or silently reverted. The
G7-10 branch is purely additive (new files) or modifying (existing files with
backward-compatible changes). No commits were rebased or amended.

---

## 2. Files Modified and Created

### 2.1 Modified Files (10)

| File | Workstream | Change Summary |
|---|---|---|
| `src/gateway/http-server.ts` | B | Added `GET /v1/missions` (list) route + `handleList()` handler; updated route comment |
| `src/gateway/mission-service.ts` | B | Added `listMissions()` method + `toListSummary()` helper (redacted view) |
| `src/gateway/types.ts` | B | Added `MissionListSummary` + `MissionListResult` types (additive, no frozen contract change) |
| `web/src/app/api/genesis/[...path]/route.ts` | B | Extended `VERIFIED_PATTERNS` to allow `GET` on `/v1/missions` |
| `web/src/lib/genesis/client.ts` | B | Implemented `listMissions()` (replaced `undefined as never` placeholder) |
| `web/src/lib/genesis/types.ts` | B | Added `MissionListSummary`, `MissionListResult`, `INVALID_LIMIT` error code |
| `web/src/components/genesis/MissionList.tsx` | B | Rewrote to use server-authoritative list + local fallback + stale-state disclosure |
| `web/src/components/genesis/sections/Sections.tsx` | B | Updated Mission list card description (removed "no list endpoint" claim) |
| `web/src/components/genesis/InsightsSection.tsx` | A | Replaced `deriveWorkerCount` with `extractWorkers`; added "Goal Satisfaction: NOT MEASURED" metric |
| `web/src/components/genesis/MissionControlDetail.tsx` | A | Added controlled-demo truthfulness disclosure (execution status / artifact verification / goal satisfaction) |

### 2.2 Created Files (4)

| File | Workstream | Purpose |
|---|---|---|
| `docs/g7-10/goal-satisfaction-verification-design.md` | C | Design document for future goal-satisfaction verification |
| `tests/gateway/mission-list.test.ts` | B (tests) | 13 tests covering B1-B9 + extras |
| `tests/g7-10-worker-count-consistency.test.ts` | A (tests) | 9 tests covering A4/A5 (worker-count consistency) |
| `G7-10_Truthfulness_Mission_Visibility_Report.md` | deliverable | This report |

**Total diff:** 10 files modified, 4 files created, +640 lines, -84 lines.

---

## 3. Implemented Behavior

### 3.1 Workstream A — UI Truthfulness

**A1 — Controlled-demo disclosure:**
`MissionControlDetail.tsx` now renders a truthfulness disclosure card below
the Outcome card when a mission is terminal. The disclosure distinguishes:
- **Execution status:** whether the execution workflow completed.
- **Artifact verification:** which checks ran on produced artifacts (and that
  `VerificationResult.ok` checks existence/integrity, not goal alignment).
- **Goal satisfaction:** `NOT MEASURED` — with controlled-demo caveat when
  `genesisMode !== 'live'`, or deferred-to-future-phase note otherwise.

**A2 — Verification semantics:**
The disclosure explicitly states that the gateway's `VerificationResult.ok`
checks artifact existence/integrity, NOT goal alignment. It does NOT claim
the goal definitely failed unless a real check established that (none exists
in G7-10).

**A3 — Insights "NOT MEASURED" metric:**
`InsightsSection.tsx` now includes a `goalSatisfaction` metric row with
`kind: NOT_AVAILABLE` and display value `NOT MEASURED`. The note explains:
- Controlled demo: "goal alignment is not evaluated"
- Non-controlled: "acceptance criteria wiring is deferred (G7-11+)"

**A4 — Worker-count unification:**
`deriveWorkerCount` (plan-created only) was REMOVED from `InsightsSection.tsx`.
All worker-count derivation now uses `extractWorkers` (the canonical utility
in `events.ts` that reads 6 event types). This matches `MissionControlDetail.tsx`
and `AgentSection` which already used `extractWorkers`.

**A5 — UI scope limits:**
No `MissionResult.status` change. No frozen `core.ts` contract change. No
`VerificationLoop` rewrite. No LLM evaluator. No development reasoning fallback
modification. No claim of real AI execution in controlled mode.

### 3.2 Workstream B — Mission Visibility

**B1 — Service method:**
`MissionService.listMissions(caller, options)` returns `MissionListResult`
with `missions: readonly MissionListSummary[]` and `nextCursor: string | null`.
Each summary contains only authoritative fields: missionId, status, terminal,
acceptedAt, finishedAt?, label?, outcomePreview (scrubbed + truncated).

**B2 — Authorization and ownership:**
The list is filtered by `rt.callerId === caller.callerId` BEFORE building
summaries. A caller cannot enumerate or infer the existence of another caller's
missions. Tested explicitly (B2 test).

**B3 — Pagination:**
Cursor-based. The cursor is the missionId of the last item on the previous
page. Deterministic sort: descending `acceptedAt`, then descending `missionId`
(stable tiebreaker). Bounded page size: 1-100, default 10. Invalid cursors
return an empty page (not an error) — caller restarts pagination.

**B4 — HTTP and BFF integration:**
- `src/gateway/http-server.ts`: `GET /v1/missions` route added before the
  `{missionId}` regex (order matters — `/v1/missions` without a trailing
  segment would otherwise 404).
- `web/src/app/api/genesis/[...path]/route.ts`: `VERIFIED_PATTERNS` extended
  to allow `GET` on `/^\/v1\/missions$/` (alongside the existing `POST`).
- `web/src/lib/genesis/client.ts`: `listMissions()` implemented (replaced
  `undefined as never`).

**B5 — MissionList integration:**
`MissionList.tsx` rewritten to:
1. Load server-authoritative list on mount via `genesisApi.listMissions()`.
2. Poll every 4s while visible (skips when `document.visibilityState !== 'visible'`).
3. Fall back to local `knownMissions` (Zustand) ONLY for records not present
   in the server list.
4. Mark local-only records as "Local-only (not confirmed by server)".
5. Provide a manual Refresh button.

**B6 — Stale-state disclosure:**
When the gateway is unavailable (503/UNAVAILABLE) or unauthorized (401), the
component shows a "Last known — connection unavailable" warning. Cached
records remain visible but are marked stale (reduced opacity + aria-label).

**B7 — Persistence disclosure:**
A permanent disclosure card states: "Server-owned, in-process. This mission
list is maintained by the running Gateway. Completed missions may be removed
after the configured retention period (5 minutes), and the list is not
preserved across Gateway restarts." The 5-minute value is verified against
`DEFAULT_TERMINAL_RETENTION_MS` in `mission-service.ts`.

**B8 — Restart behavior:**
After a gateway restart, the in-memory registry is empty. `GET /v1/missions`
returns `{ missions: [], nextCursor: null }`. The UI shows the empty state
with the persistence disclosure. Stale local records (if any) are marked
"Local-only" — never presented as current server state. Tested explicitly
(B8 test).

### 3.3 Workstream C — Goal Satisfaction Design

`docs/g7-10/goal-satisfaction-verification-design.md` defines:
- Three verification levels (Execution Success, Artifact Integrity, Goal
  Satisfaction) with authorities and evidence references.
- Existing infrastructure that can be reused (`AcceptanceCheck` union,
  `MissionOrchestratorOptions.checks` seam, `GoalCompiler` extraction point).
- Three future implementation paths (A: caller-supplied criteria, B:
  GoalCompiler extraction, C: LLM evaluator).
- Recommendation: Path A for G7-11 (no frozen contract change).
- Contract boundary: no frozen contract modified in G7-10.
- Tracked requirement: Goal Satisfaction Verification remains explicit for
  G7-11 or a separately approved follow-up.

---

## 4. API Contract for Mission Listing

### `GET /v1/missions`

**Authentication:** Bearer token (API key) — same as all `/v1/missions/*` routes.

**Query parameters:**
| Parameter | Type | Default | Range | Description |
|---|---|---|---|---|
| `limit` | integer | 10 | 1-100 | Page size. Invalid (<1, >100, NaN) → 400 `INVALID_LIMIT`. |
| `cursor` | string | null | any | Pagination cursor (missionId from previous page's last item). Evicted/invalid cursor → empty page. |

**Response 200:**
```json
{
  "missions": [
    {
      "missionId": "uuid",
      "status": "SUCCEEDED",
      "terminal": true,
      "acceptedAt": "2026-10-08T17:02:13.000Z",
      "finishedAt": "2026-10-08T17:02:14.000Z",
      "label": "optional-caller-label",
      "outcomePreview": "scrubbed + truncated goal text (120 chars)"
    }
  ],
  "nextCursor": "uuid-of-last-item" | null
}
```

**Errors:**
| Status | Code | Condition |
|---|---|---|
| 401 | `UNAUTHENTICATED` | Missing/invalid API key |
| 400 | `INVALID_LIMIT` | `limit` < 1, > 100, or non-numeric |
| 500 | `INTERNAL_ERROR` | Unexpected service failure |

**Ownership:** The response is filtered to the caller's missions. A caller
cannot enumerate another caller's missions.

**Durability:** Server-owned, in-process. NOT restart-durable. Terminal
missions are evicted after 5 minutes (configurable via
`terminalMissionRetentionMs`).

---

## 5. Worker-Count Reconciliation

**Before G7-10:**
- `InsightsSection.tsx` used `deriveWorkerCount(events)` — reads ONLY the
  `plan-created` event and returns `workers.length`. Returns 0 if no
  `plan-created` event (e.g., truncated by 100-event cap).
- `MissionControlDetail.tsx` and `AgentSection` used `extractWorkers(events)`
  — reads 6 event types (plan-created, genomes-compiled, worker-started,
  worker-step, worker-finished, worker-retry) and deduplicates by workerId.

**Inconsistency:** When a verifier worker (`mission-verifier-1`) was
auto-added by the orchestrator (appears in `worker-started` but NOT in
`plan-created`), Insights showed N workers while Mission Control / Agent
showed N+1.

**After G7-10:**
- `deriveWorkerCount` REMOVED from `InsightsSection.tsx`.
- All three components (`InsightsSection`, `MissionControlDetail`, `AgentSection`)
  now use `extractWorkers(events)` → `Object.keys(...).length`.
- Same mission → same worker count across all views.
- Tested: `tests/g7-10-worker-count-consistency.test.ts` (9 tests covering
  distinct counting, repeated-event resilience, verifier consistency,
  shuffle invariance).

---

## 6. Test Results

### 6.1 Engine Tests

| Suite | Tests | Result |
|---|---|---|
| `tests/g7-10-worker-count-consistency.test.ts` (NEW) | 9 | PASS |
| `tests/gateway/mission-list.test.ts` (NEW) | 13 | PASS |
| All existing engine tests (regression) | 590 passed, 9 skipped | PASS |
| **Engine total** | **612 passed, 9 skipped, 0 failed** | **PASS** |

### 6.2 Type Checks

| Project | Command | Result |
|---|---|---|
| Engine | `tsc --noEmit` | PASS |
| Web | `tsc --noEmit` | PASS |

### 6.3 Lint

| Project | Command | Result |
|---|---|---|
| Engine | `eslint .` | PASS (0 errors) |
| Web | `eslint .` | PASS (0 errors, 4 pre-existing warnings) |

### 6.4 Acceptance Evidence

See `G7-10_Acceptance_Evidence.md` for the full A1-A6, B1-B9, C1-C3 matrix.

---

## 7. Known Limitations

1. **Restart-durability:** The mission list is in-process only. A gateway
   restart loses the entire registry. This is documented in the UI (B7
   disclosure) and is an explicit deferral — full restart-durable history
   is a future phase.

2. **Terminal mission retention:** Terminal missions are evicted after 5
   minutes (`DEFAULT_TERMINAL_RETENTION_MS`). This is documented in the UI
   and is configurable via `MissionServiceOptions.terminalMissionRetentionMs`.

3. **Pagination cursor on evicted missions:** If the cursor mission is
   evicted between page requests, the next page returns empty (`missions: [],
   nextCursor: null`). The caller must restart pagination from the beginning.
   This is the safest deterministic behavior — it avoids inventing a position
   or returning duplicates.

4. **Goal satisfaction not measured:** G7-10 makes this limitation visible
   (UI disclosure + `NOT MEASURED` metric) but does NOT implement goal-
   satisfaction verification. This is tracked in the design document for
   G7-11 or a follow-up.

5. **Z.ai Preview sync:** G7-08C/D preview changes (rate-limiting, AuthGate
   hardening) were NOT applied to the GitHub repository and are NOT part of
   G7-10. If the Z.ai Preview needs these changes, they must be applied
   separately.

6. **No push to production Docker:** Per the frozen constraint, no production
   deployment occurred.

---

## 8. Deferred Requirements

| Requirement | Target Phase | Reason |
|---|---|---|
| Goal Satisfaction Verification (implementation) | G7-11 or follow-up | Requires Path A/B/C decision + possible frozen contract change |
| Restart-durable mission history | Future phase | Requires persistence layer decision |
| Production mode wiring (real ZAI + OpenBot) | G7-11 | Requires credentials + budget enforcement |
| `Goal.acceptanceCriteria` contract field | G7-11 (Path B) | Requires frozen-contract approval |
| `buildChecks()` producing `expectIncludes`/`expectHash` | G7-11 | Requires real reasoning provider |
| Conversational Home | G7-12 | Per roadmap |
| Projects Repository | G7-13 | Per roadmap |
| Constrained Plugins / MCP | G7-14 | Per roadmap |

---

## 9. Final Commit SHA

The implementation is committed on branch `fix/g7-10-truthfulness-mission-visibility`.
The final commit SHA is recorded in the Acceptance Evidence document and the
final response format.

**No merge into main. No automatic push** (push authorization was unclear;
the local commit is provided and its status reported).

---

## 10. Constraints Compliance Summary

| Constraint | Status |
|---|---|
| Reuse existing components and utilities | PASS — `extractWorkers`, `scrubSecrets`, existing BFF pattern reused |
| No new dependencies | PASS — 0 new deps |
| No second MissionService | PASS — `listMissions()` added to existing service |
| No engine or Orchestrator rewrite | PASS — 0 changes to `orchestrator.ts` |
| No frozen contract modifications | PASS — `src/contracts/core.ts` unchanged (verified by git diff) |
| No new persistence framework | PASS — in-process Map reused |
| No project repository implementation | PASS — deferred to G7-13 |
| No conversational Home implementation | PASS — deferred to G7-12 |
| No plugin installation implementation | PASS — deferred to G7-14 |
| No deployment to production Docker | PASS — no deployment |
| No production credential exposure | PASS — no secrets in tracked files |
| No unrelated UI redesign | PASS — only truthfulness + mission list changes |
| No invented progress or verification claims | PASS — `NOT MEASURED` disclosed |
| No unnecessary file proliferation | PASS — 4 new files, all purposeful |
| No broad refactoring | PASS — 10 files modified, all scoped |

---

**End of Report.**
