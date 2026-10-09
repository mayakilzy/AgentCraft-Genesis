# G7-15B — Durable Mission History Report

**Mission:** G7-15 — Integrated Product Acceptance
**Slice:** G7-15B — Durable Mission History
**Branch:** `build/g7-14-constrained-mcp`
**Baseline:** `76e4c96ec465b777499634aa494570c37d81c18e` (G7-15A Security Reconciliation — PASS)
**Date:** 2026-10-10

---

## 0. Authoritative Source & Scope

**Authoritative source:** `docs/g7-11/launch-readiness-decision.md` §5 lists "Restart-durable mission history" as a future-phase prerequisite for G7-15. `G7-11B_Live_Execution_Qualification_Report.md` §7.3 explicitly lists it as prerequisite #2 for G7-15 (Integrated Product Acceptance). `docs/g7-11/production-failure-mode-matrix.md` FM-15 documents the current limitation: `RESTART_RECOVERY = UNSUPPORTED` — the in-process `Map` is lost on restart.

G7-15B closes FM-15 by adding a durable mission history store, without introducing a new storage framework or modifying any frozen contract.

---

## 1. B1 — Inspection Findings (READ-ONLY)

### 1.1 Existing persistence patterns inspected

| Pattern | File | Reuse decision |
|---|---|---|
| JSONL append-only (flight events, artifact records) | `src/mission/flight-recorder.ts:384`, `src/mission/artifact-record.ts:147` | NOT reused — MissionService uses `MemoryFlightRecorder` (not the file variant); the gateway does not persist the full event stream. Reusing JSONL for mission history would duplicate the event stream unnecessarily (violates B3). |
| Atomic rewrite-by-id (single JSON file per entity) | `src/project/project-store.ts:1030-1082` | **REUSED** — the mission history store mirrors this pattern: `writeFileSync(tmp)` + `renameSync(tmp, final)` for atomic replacement; corrupt files preserved on disk; temp files use `.tmp.{id}.{pid}.{timestamp}` naming. |
| JSONL append + rewrite-by-id split (conversations) | `src/conversation/conversation-store.ts` | NOT reused — conversations have an append-only message stream; mission history has no event stream (only a fixed-shape terminal snapshot). The single-file atomic pattern from FileProjectStore is the correct match. |

### 1.2 MissionService lifecycle inspected

- **`start()`** creates a `MissionRuntime` in an in-process `Map` and starts the orchestrator. The `runPromise.then()/catch()` handlers update the runtime to a terminal status.
- **`get()`** throws `MissionNotFoundError` when the mission is not in the in-process registry.
- **`listMissions()`** iterates the in-process `Map` only — no durable history.
- **`getEvents()`** reads from `MemoryFlightRecorder.events` — in-process only.
- **`getArtifacts()`** reads from the runtime adapter or the legacy `computers` Map — in-process only.
- **`sweepTerminalMissions()`** evicts terminal missions from the in-process registry after a retention window (default 5 minutes).

### 1.3 Status contracts verified (B2)

The existing `MissionStatus` taxonomy (`src/gateway/types.ts:41-48`) CAN represent interruption correctly:
- Terminal states: `SUCCEEDED`, `FAILED`, `PARTIAL`, `CANCELLED`.
- Non-terminal states: `ACCEPTED`, `RUNNING`, `CANCELLATION_REQUESTED`.

**Decision (B2): interrupted missions recover as `FAILED` with `failureClass='RUNTIME_FAILURE'` and `failureMessage='mission interrupted by gateway restart'`.** This uses the existing `FAILED` status and the existing `RUNTIME_FAILURE` failure class (from the non-frozen `src/mission/failure-class.ts`). No new status values, no frozen-contract modification. Never invent success — the recovered `MissionResult` is always `status: 'failure'` with empty evidence.

### 1.4 Existing restart tests inspected

- `tests/gateway/mission-list.test.ts` B8: "restart limitation — empty registry returns empty list" — explicitly documents the pre-G7-15B limitation. This test continues to pass because the `missionHistoryStore` option is OPTIONAL: when a test constructs `new MissionService({...})` without it, the behavior is unchanged (backward compatible).
- `tests/g6-08-r1/shutdown-lifecycle.test.ts`: tests graceful shutdown of active missions. Unaffected by G7-15B (the history store is independent of the shutdown lifecycle).

---

## 2. B2 — Truthful Recovery Semantics

| Scenario | Pre-crash persisted status | Post-restart status | Truthful? |
|---|---|---|---|
| Mission completed successfully before crash | SUCCEEDED | SUCCEEDED (loaded as-is) | YES — reflects actual outcome |
| Mission failed before crash | FAILED | FAILED (loaded as-is) | YES |
| Mission was partial before crash | PARTIAL | PARTIAL (loaded as-is) | YES |
| Mission was cancelled before crash | CANCELLED | CANCELLED (loaded as-is) | YES |
| Mission was RUNNING when crash happened | ACCEPTED/RUNNING | **FAILED** (recovered, `failureClass='RUNTIME_FAILURE'`, `failureMessage='mission interrupted by gateway restart'`) | YES — the mission did NOT succeed; we never invent success |
| Mission was CANCELLATION_REQUESTED when crash happened | CANCELLATION_REQUESTED | **FAILED** (recovered, same as above) | YES — the cancellation was in-flight; the truthful outcome is failure |

**Never invent success:** the recovery path does NOT fabricate artifacts, verification, or a `MissionResult.status='success'`. The recovered `MissionResult` is always `status: 'failure'` with empty `evidence: []`. The `failureMessage` explicitly states the mission was interrupted.

**No frozen-contract modification:** the recovery uses the existing `FAILED` status and the existing `RUNTIME_FAILURE` failure class. The `FailureClass` union in `src/mission/failure-class.ts` is NOT in the frozen-contracts list (the frozen list is `core.ts`, `verification.ts`, `orchestrator.ts`, `goal-compiler.ts`).

---

## 3. B3 — Minimal Persistence Implementation

### 3.1 New file: `src/mission/mission-history-store.ts` (~310 lines)

**Pattern:** atomic rewrite-by-id (one JSON file per mission), copied from `FileProjectStore`. The store:
- Writes to `data/missions/{missionId}.mission.json` via `writeFileSync(tmp)` + `renameSync(tmp, final)` (POSIX-atomic).
- Uses a unique temp file per write: `.tmp.{missionId}.{pid}.{timestamp}.mission.json`.
- Preserves corrupt files on disk (returns `undefined` from `read`, logs to stderr — does NOT throw or silently replace).
- Validates `schemaVersion` and `missionId` on read; skips records that fail validation.
- Bounds disk usage: one file per mission (~1-2 KB each); no append-only growth.

**No new dependencies.** Pure `node:fs` + `node:path`.

### 3.2 MissionService wiring (option injection — no frozen-contract change)

- Added `missionHistoryStore?: FileMissionHistoryStore` to `MissionServiceOptions`.
- The store is OPTIONAL — when absent, MissionService behaves exactly as before (backward compatible with all 819 pre-existing tests).
- On construction with a store: `recoverHistory()` loads all `*.mission.json` files and rewrites non-terminal records to FAILED (atomic).
- In `start()`: writes the initial ACCEPTED record (so interrupted missions have a durable pre-crash representation).
- In the `runPromise.then()/catch()` handlers: calls `persistTerminal()` which atomically rewrites the record to the terminal status with the full MissionResult summary, cost, failure class, and artifact metadata.
- `get()`, `listMissions()`, `getEvents()`, `getArtifacts()` consult the history index when the mission is not in the in-process registry.

### 3.3 main.ts wiring

Both execution modes (development + production) instantiate `FileMissionHistoryStore` and pass it to MissionService. The store is created BEFORE the MissionService so the constructor can recover interrupted missions.

### 3.4 .gitignore

Added `data/missions/` (same pattern as `data/conversations/` and `data/projects/`) — runtime mission records are never tracked.

### 3.5 Concurrency safety (tested in B4-06)

- All store methods are SYNCHRONOUS (writeFileSync, renameSync, readFileSync).
- Within a single Node.js process, concurrent calls are serialized by the event loop.
- Two concurrent writes to DIFFERENT missionIds use different temp files (no collision).
- Two concurrent writes to the SAME missionId are last-writer-wins (the orchestrator's terminal handler runs after the start handler, so the terminal record is final).
- B4-06 verifies 10 concurrent missions produce 10 well-formed, non-corrupt records.

### 3.6 Documented limitations

| Limitation | Mitigation |
|---|---|
| **RESTART_LOADS_ALL_FILES** — `loadAll()` reads every `*.mission.json` at startup. For O(missions) files this is O(missions) disk reads. | Acceptable for the controlled environment (single-operator, hundreds-to-thousands of missions). A future operator tooling slice can add a history-retention sweep if disk growth becomes a concern. |
| **NO_FSYNC** — the write path does NOT call `fsync()`. Power-loss durability is NOT claimed (same as FileProjectStore). | Documented; out of scope for G7-15B. |
| **NO_HISTORY_RETENTION_SWEEP** — terminal missions persist indefinitely; the in-process sweeper does NOT touch the history store. | Documented; a future slice can add a history-retention sweep. |

---

## 4. B4 — Acceptance Tests

### 4.1 Test file: `tests/gateway/g7-15b-mission-history.test.ts` (9 tests)

```
$ npx vitest run tests/gateway/g7-15b-mission-history.test.ts --reporter=verbose

 ✓ B4-01: SUCCEEDED mission survives Gateway restart (30ms)
 ✓ B4-02: FAILED mission survives Gateway restart (11ms)
 ✓ B4-03: Interrupted RUNNING mission is not falsely presented as active after restart (510ms)
 ✓ B4-04: Mission detail and list endpoints return consistent recovered data (13ms)
 ✓ B4-05: Existing artifact and verification records remain intact (6ms)
 ✓ B4-06: Concurrent mission writes do not corrupt records (14ms)
 ✓ B4-07: Truncated or malformed persistence data is handled predictably (4ms)
 ✓ B4-08: Sensitive values do not leak into persisted records (4ms)
 ✓ B4-09: Existing conversation and project persistence remains unaffected (7ms)

9/9 PASS, 0 FAIL
```

### 4.2 Acceptance criteria matrix

| Spec requirement | Test ID | Result | Evidence |
|---|---|---|---|
| SUCCEEDED mission survives restart | B4-01 | PASS | Recovered snapshot has `status: 'SUCCEEDED'`, `terminal: true`, `result.status: 'success'` |
| FAILED mission survives restart | B4-02 | PASS | Recovered snapshot has `status: 'FAILED'`, `terminal: true`, `result.status: 'failure'` |
| Interrupted RUNNING mission not falsely active | B4-03 | PASS | Recovered snapshot has `status: 'FAILED'` (NOT RUNNING), `failureClass: 'RUNTIME_FAILURE'`, `failureMessage` contains 'interrupted' |
| Mission detail + list consistent | B4-04 | PASS | List summaries match detail snapshots (status, terminal, acceptedAt) for both SUCCEEDED + FAILED missions |
| Artifact + verification records intact | B4-05 | PASS | Recovered artifacts preserve `path`, `verified: true`, `bytes`; content is `undefined` (workspace gone — truthful) |
| Concurrent writes no corruption | B4-06 | PASS | 10 concurrent missions → 10 valid JSON files with correct schemaVersion + status + callerId |
| Truncated/malformed handled predictably | B4-07 | PASS | Corrupt + wrong-schema files skipped (preserved on disk); service starts without error; valid mission still recoverable |
| No secrets in persisted records | B4-08 | PASS | Sentinel `ghp_...` secret in outcome is scrubbed to `[REDACTED]` in the persisted file |
| Conversation + project persistence unaffected | B4-09 | PASS | Conversation + project + mission history all survive restart independently |

### 4.3 Full regression + quality gates

| Check | Command | Result |
|---|---|---|
| Full regression | `npx vitest run` | **828 passed, 9 skipped, 0 failed (85 files)** — 819 pre-existing + 9 new G7-15B tests |
| Engine typecheck | `npx tsc --noEmit` | PASS (0 errors) |
| Web typecheck | `cd web && npx tsc --noEmit` | PASS (0 errors) |
| Engine lint | `npx eslint .` | PASS (0 errors) |
| Web lint | `cd web && npx eslint .` | PASS (0 errors, 4 pre-existing warnings — unchanged) |
| Frozen contracts | `git diff 2b105e5..HEAD -- src/contracts/core.ts src/mission/verification.ts src/mission/orchestrator.ts src/goal/goal-compiler.ts` | **0 diff lines** (UNCHANGED) |
| ownership.yaml | `git diff 2b105e5..HEAD -- data/ownership.yaml` | **0 diff lines** (UNCHANGED) |
| Tracked runtime data | `git ls-tree -r --name-only HEAD \| grep data/missions/` | empty (clean) |

---

## 5. Files Changed (G7-15B)

| File | Status | Lines | Notes |
|---|---|---|---|
| `src/mission/mission-history-store.ts` | NEW | +312 | FileMissionHistoryStore (atomic rewrite-by-id pattern from FileProjectStore) |
| `src/gateway/mission-service.ts` | MODIFIED | +444 / -7 | Optional `missionHistoryStore` injection; `recoverHistory()` + `persistTerminal()` + history-aware `get()`/`listMissions()`/`getEvents()`/`getArtifacts()` |
| `src/gateway/main.ts` | MODIFIED | +9 / -0 | Instantiate `FileMissionHistoryStore` + pass to MissionService in both execution modes |
| `tests/gateway/g7-15b-mission-history.test.ts` | NEW | +512 | 9 acceptance tests (B4-01..B4-09) |
| `.gitignore` | MODIFIED | +3 | Added `data/missions/` (same pattern as `data/conversations/`, `data/projects/`) |
| `G7-15B_Durable_Mission_History_Report.md` | NEW | (this report) | — |

**No frozen-contract modifications.** No `data/ownership.yaml` modifications. No new npm dependencies. Production source changes confined to `src/mission/mission-history-store.ts` (new) + `src/gateway/mission-service.ts` (option injection + history-aware read methods) + `src/gateway/main.ts` (wiring).

---

## 6. Residual Limitations

| Limitation | Severity | Mitigation |
|---|---|---|
| **RESTART_LOADS_ALL_FILES** — startup reads every `*.mission.json`. O(missions) disk reads. | P3 | Acceptable for controlled env (single-operator, thousands of missions). A future slice can add an index file or a lazy-load mechanism. |
| **NO_FSYNC** — power-loss durability NOT claimed (same as FileProjectStore). | P2 | Documented. Operators requiring power-loss durability must add `fsync()` (out of scope for G7-15B; no new dependencies). |
| **NO_HISTORY_RETENTION_SWEEP** — terminal missions persist indefinitely. | P3 | The in-process sweeper does NOT touch the history store. A future operator tooling slice can add a history-retention sweep if disk growth becomes a concern. |
| **MULTI_INSTANCE_NOT_SHARED** — each gateway process has its own history store directory. Multi-instance deployments would need a shared store. | P2 | Same as FileConversationStore + FileProjectStore. Out of scope per spec (no new dependencies). |
| **RECOVERED_EVENTS_EMPTY** — `getEvents()` returns `[]` for recovered missions (the in-process recorder is gone). | P3 | Truthful — no events to replay. The caller can distinguish "mission exists but no events" from "mission not found" via `get()`. The full flight event stream remains in `data/flight-records/` (written by experiments, not the gateway). |
| **RECOVERED_ARTIFACTS_NO_CONTENT** — `getArtifacts()` returns metadata (path + verified + bytes) but NO content for recovered missions (the workspace is gone). | P3 | Truthful — the workspace is gone after restart. The metadata is durable; the content is not. |

---

## 7. Engineering Charter

**Illuminate before building. Reuse before reinventing.**

- **Illuminate**: B1 inspected MissionService lifecycle, FlightRecorder, FileConversationStore, FileProjectStore, mission API contracts, and existing restart tests. Confirmed the in-process registry is the only state; FlightRecorder is in-memory (file variant is for experiments); the existing `MissionStatus` + `FailureClass` taxonomy can represent interruption without frozen-contract modification.
- **Reuse**: the mission history store mirrors the FileProjectStore atomic-write pattern (write-temp + rename, corrupt-record preservation, temp-file naming). The MissionService wiring uses option injection (no constructor signature change for existing callers). No new dependencies, no new frameworks, no new storage layer.
- **Small in code**: +312 lines for the store + ~440 lines of MissionService wiring (mostly history-aware read methods + the recover/persist helpers) + 512 lines of tests. The production-code delta is ≈750 lines — well within the slice's "minimal persistence" budget. The 9 acceptance tests prove the full restart-recovery contract.

---

## 8. Final Status

```text
G7_15B_ACCEPTANCE = PASS

B1_INSPECTION = PASS (existing patterns identified; reuse decision: FileProjectStore atomic-write pattern)
B2_TRUTHFUL_RECOVERY_SEMANTICS = PASS (interrupted → FAILED + RUNTIME_FAILURE; never invent success)
B3_MINIMAL_PERSISTENCE = PASS (one JSON file per mission; atomic write; no new deps; no frozen-contract change)

B4_ACCEPTANCE_TESTS = PASS (9/9)
  B4-01: SUCCEEDED survives restart        ✓
  B4-02: FAILED survives restart            ✓
  B4-03: Interrupted → FAILED (not RUNNING) ✓
  B4-04: Detail + list consistent           ✓
  B4-05: Artifacts + verification intact    ✓
  B4-06: Concurrent writes no corruption    ✓
  B4-07: Malformed data handled             ✓
  B4-08: No secret leak                     ✓
  B4-09: Conversation + project unaffected ✓

FULL_REGRESSION = 828 passed, 9 skipped, 0 failed (85 files)
TYPECHECK = PASS (engine + web)
LINT = PASS (0 errors; 4 pre-existing web warnings)
FROZEN_CONTRACTS = UNCHANGED (0 diff vs 2b105e5)
OWNERSHIP_YAML = UNCHANGED (0 diff vs 2b105e5)
NEW_DEPENDENCIES = NONE

PRODUCTION_CODE_IMPACT:
  - src/mission/mission-history-store.ts (NEW, +312)
  - src/gateway/mission-service.ts (MODIFIED, +444/-7 — option injection + history-aware reads)
  - src/gateway/main.ts (MODIFIED, +9 — wiring)

RESIDUAL_LIMITATIONS:
  - RESTART_LOADS_ALL_FILES (P3, documented)
  - NO_FSYNC (P2, documented; same as FileProjectStore)
  - NO_HISTORY_RETENTION_SWEEP (P3, documented)
  - MULTI_INSTANCE_NOT_SHARED (P2, documented; same as other stores)
  - RECOVERED_EVENTS_EMPTY (P3, truthful)
  - RECOVERED_ARTIFACTS_NO_CONTENT (P3, truthful)

NOT_STARTED = G7-15C (per spec; awaiting architectural approval)
```

---

## 9. Evidence Locations

| Evidence | Path |
|---|---|
| Mission history store | `src/mission/mission-history-store.ts` |
| MissionService wiring | `src/gateway/mission-service.ts` (missionHistoryStore option + recoverHistory/persistTerminal/historyRecordToSnapshot/historyRecordToListSummary) |
| Gateway wiring | `src/gateway/main.ts` (FileMissionHistoryStore instantiated in both execution modes) |
| Acceptance tests | `tests/gateway/g7-15b-mission-history.test.ts` (9 tests, B4-01..B4-09) |
| .gitignore | `.gitignore` (added `data/missions/`) |
| This report | `G7-15B_Durable_Mission_History_Report.md` |

---

**End of G7-15B Durable Mission History Report. Awaiting remote verification.**
