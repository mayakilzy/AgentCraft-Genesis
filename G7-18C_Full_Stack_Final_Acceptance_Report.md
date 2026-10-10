# G7-18C — Full-Stack Autonomous Repair & Final Acceptance Report

**Mission:** G7-18C — Full-Stack Autonomous Repair & Final Acceptance
**Repository:** https://github.com/mayakilzy/AgentCraft-Genesis
**Branch:** `build/g7-14-constrained-mcp`
**Expected baseline:** `25fde11` (G7-18B closure — full SHA `25fde11dec51af8ad7853db6f574401f5428499b` resolved and verified before changes)
**Date:** 2026-10-11

---

## Mission Objective

Achieve full functional success for the existing Community Project Hub application by having Genesis autonomously diagnose, repair, test, and deliver the application through the real production Gateway + missionInputs + ZAI GLM + OpenBot path. Focused continuation of G7-18B, not a new application-generation experiment.

**Primary success criterion: all original G7-18 behavioral acceptance checks PASS, without manual application code modification.**

---

## Phase 0 — Baseline

| Check | Result |
|---|---|
| Branch | `build/g7-14-constrained-mcp` ✓ |
| HEAD (local) | `25fde11dec51af8ad7853db6f574401f5428499b` ✓ |
| HEAD (remote) | `25fde11dec51af8ad7853db6f574401f5428499b` ✓ |
| Working tree | clean ✓ |
| Remote alignment | ALIGNED ✓ |

The abbreviated baseline `25fde11` from the task spec resolves to full SHA `25fde11dec51af8ad7853db6f574401f5428499b` (verified via `git rev-parse HEAD` before any changes).

### Starting-point files (G7-18B application, NOT the original broken G7-18)

Used `evidence/g7-18b/clean-room-app/` as the repair starting point (per task instruction: "Do not use the original broken G7-18 application as the repair starting point. Use the improved G7-18B application."). All 9 file hashes recorded in `evidence/g7-18c/starting-hashes.json`.

---

## Phase 1 — Diagnose All Remaining Defects

Reproduced all 6 G7-18B acceptance failures. Full diagnostic in `evidence/g7-18c/phase-1-diagnostic-report.md`. Summary:

| # | Defect | Location | Fix |
|---|---|---|---|
| 1 | Route-parsing index error: `pathname.split('/')[2]` returns `'projects'`/`'tasks'` instead of the id | `server.js` lines 108, 116, 121, 143 | Change `[2]` to `[3]` |
| 2 | Missing FK enforcement: `initializeDb()` never runs `PRAGMA foreign_keys = ON;` | `server.js` `initializeDb()` | Add `db.exec('PRAGMA foreign_keys = ON;')` before CREATE TABLE |
| 3 | Test startup listens on stderr instead of stdout | `test/api.test.js` line 80, `test/integration.test.js` line 80 | Change `stderr` to `stdout` |
| 4 | `test/db.test.js` doesn't create schema before querying | `test/db.test.js` | Add `db.exec()` with CREATE TABLE + PRAGMA before each test |
| 5 (hidden, revealed post-repair) | Route-ordering: `GET /api/projects/:id` matches before `GET /api/projects/:id/tasks` | `server.js` lines 110 vs 118 | Reorder routes or add exclusion condition |

**Phase 1 explicitly noted:** "The listed defects are diagnostic leads, not an exhaustive repair boundary." Defect 5 was not in the Phase 1 diagnostic — it was revealed after the first 4 were fixed and the application started running.

---

## Phase 2 — Autonomous Repair

### Bridge usage proof

The 9 G7-18B files (53,254 bytes total) were submitted through the production Gateway `missionInputs` interface (implemented in G7-18B). No local operator-side copying. Files traveled through: `POST /v1/missions` → `parseSubmission()` → `validateMissionInputs()` → `MissionService.start()` → orchestrator `missionInputs` option → staging loop → worker workspace.

### Goal design

The goal explicitly did NOT include the G7-18B instruction "preserve HTTP routing unchanged" (per task instruction: "Do NOT include the previous instruction 'preserve HTTP routing unchanged.' Preserve the intended HTTP API contract, but allow fixing its implementation."). The goal told the worker to fix the route-parsing bug, add FK enforcement, fix test stderr→stdout, and fix test/db.test.js schema creation.

### Mission execution (real ZAI GLM-4-Plus + OpenBot)

| Field | Value |
|---|---|
| Mission ID | `b4e1fc88-aebf-4bfa-a2b0-f592d1da1cc9` |
| Mission status | **PARTIAL** (540s timeout — mission aborted before Mission Coordinator could complete) |
| Execution mode | production (real ZAI GLM-4-Plus + OpenBot runtime) |
| Duration | 540,643 ms (≈ 9 min) |
| Token usage | **458,534** |
| USD cost | $0.00 (Z.ai included usage) |
| `write_file` events | 8 (OK) |
| `read_file` events | 10 (worker read all 9 staged inputs + 1 more) |
| `run_command` events | 5 |
| Artifacts delivered | 12 |
| Manual artifact modification | **NO** |

### Worker outcomes

| Worker | Role | Status | Steps | Reasoning calls | Summary |
|---|---|---|---|---|---|
| `software-engineer-1` | Software Engineer | **success** | 13 | 14 | "repaired" |
| `documentation-writer-2` | Documentation Writer | **success** | 9 | 10 | "repaired" |
| `generalist-worker-3` | Generalist Worker | failure | 8 | 8 | CANCELLED (timeout) |
| `mission-coordinator-1` | Mission Coordinator | (not started — mission timed out before dispatch) | — | — | — |

Both specialists (`software-engineer-1`, `documentation-writer-2`) successfully repaired the files. The Generalist Worker was cancelled by the timeout. The Mission Coordinator never started.

### Verification event

```json
{"missionId": "b4e1fc88-aebf-4bfa-a2b0-f592d1da1cc9", "ok": false, "passed": 48, "failed": 4, "failures": 4}
```

48/52 structural checks passed. The 4 failures are in the structural verification (likely the route-ordering content check — see Phase 4).

### Files changed by the repair

| File | Changed? | G7-18B SHA-256 | G7-18C SHA-256 |
|---|---|---|---|
| `server.js` | **YES** | `ced1ef6f06ef00a1f85b075bd6ecb2ae55260681ae2fbb1152a4a881ee9124bc` | (see evidence) |
| `test/api.test.js` | **YES** | `dd3c66aa43aba4db1566ebda6fde97bc2c7a0b56ed94d53eec86f750f2b0b8b7` | (see evidence) |
| `test/db.test.js` | **YES** | `78f8aa6fddfea93aab50f12903e6468d50783e91b5ff207b3477b039d695ec2a` | (see evidence) |
| `test/integration.test.js` | **YES** | `c6967d6c4a1f7be8865070efede6613588a5562f43be24ba2bc23dffa78c7f25` | (see evidence) |
| `public/index.html` | NO (byte-identical) | `71358747764ed20c2e3318596e86c7e3c294d3dd4cf3e6329042ad21f91021ab` | (same) |
| `public/styles.css` | NO (byte-identical) | `a60fa2b388e093d585c3e288258df4e56366c7165a8e09196e54b974f0259df2` | (same) |
| `public/app.js` | NO (byte-identical) | `e2275551b472143b5a20dc72b80a4457cd94d56b35959a95be28c912c317a5b9` | (same) |
| `package.json` | NO (byte-identical) | `587ba47b1082b8763b1722bf2b25b6767a8c9cdb8577f3cb32892ce19b9f3e31` | (same) |
| `README.md` | NO (byte-identical) | `718db0f4b096089cba7813ffeb62f2ffb36e2c345b9dc22c3d94300ea537a279` | (same) |

The worker modified **exactly 4 files** (`server.js`, `test/api.test.js`, `test/db.test.js`, `test/integration.test.js`) — all 4 files that had defects. The other 5 files (frontend, package.json, README.md) are byte-for-byte identical to the G7-18B starting point.

### Defect fix verification

| Defect | Fix applied? | Evidence |
|---|---|---|
| 1. Route-parsing `[2]` → `[3]` | **YES** (all 4 occurrences) | `grep "pathname.split" server.js` shows `[3]` at lines 111, 119, 124, 146 |
| 2. `PRAGMA foreign_keys = ON;` | **YES** | `grep "PRAGMA foreign_keys" server.js` shows line 14 |
| 3. test/api.test.js stderr → stdout | **YES** | `grep "stderr\|stdout" test/api.test.js` shows `serverProcess.stdout.on` at line 80 |
| 4. test/db.test.js schema creation | **YES** | `grep "CREATE TABLE\|PRAGMA\|exec" test/db.test.js` shows schema creation + PRAGMA |
| 5. Route-ordering (hidden defect) | **NO** | `grep "else if.*pathname" server.js` shows `GET /api/projects/:id` at line 110 BEFORE `GET /api/projects/:id/tasks` at line 118 |

**4 of 5 defects fixed.** Defect 5 (route-ordering) was not in the Phase 1 diagnostic and was not fixed by the worker. This is the root cause of the 2 remaining acceptance failures (see Phase 3).

**MANUAL_APPLICATION_CODE_INTERVENTION = NO.** GLM did not edit any generated application file. The repair was performed entirely by Genesis's worker through the real ZAI + OpenBot execution path.

---

## Phase 3 — Independent Clean-Room Acceptance

Extracted `software-engineer-1`'s workspace artifacts (unmodified, excluding incidental runtime files like `hub.db`, `node_modules`, `package-lock.json`) into `evidence/g7-18c/clean-room-app/`. Ran all original G7-18 behavioral criteria without weakening. 17 checks:

| # | Check | Result | Detail |
|---|---|---|---|
| A-01 | All 9 files present | **PASS** | All 9 deliverable files exist |
| A-02 | Hash comparison | INFO | 4 changed, 5 unchanged |
| A-03 | `npm install` | **PASS** | exit 0 |
| A-04 | Backend starts + SQLite initializes | **PASS** | `Community Project Hub listening on port 3180` |
| A-05 | Backend API accessible | **PASS** | `GET /api/projects` → 200 `{ok:true, data:[]}` |
| A-06 | Frontend accessible | **PASS** | `GET /` → 200 with `<html` |
| A-07 | Create project | **PASS** | `POST /api/projects` → 201, id=1 |
| A-08 | Project in list | **PASS** | project appears in `GET /api/projects` |
| A-09 | Create task linked to project | **PASS** | `POST /api/projects/1/tasks` → 201, id=1 |
| A-10 | Task status update | **PASS** | `PATCH /api/tasks/1` → 200, status=in-progress |
| A-11 | Status filter | **PASS** | `GET /api/tasks?status=in-progress` includes the task |
| A-12 | Invalid input (empty name) | **PASS** | 400 |
| A-12b | Invalid input (bad status) | **PASS** | 400 |
| A-13 | Project persists across restart | **PASS** | project survived restart |
| A-13b | Task+status persists across restart | **FAIL** | `GET /api/projects/1/tasks` returns the project, not the tasks (route-ordering bug) |
| A-14 | Automated tests pass | **FAIL** | npm test times out after 120s — api.test.js hangs because `GET /api/projects/:id/tasks` returns the wrong data |
| A-15 | Browser acceptance (real frontend/backend interaction) | **PASS** | Browser created a project via UI form, created a task via API, updated task status via PATCH, verified filter via GET — all worked |
| A-16 | No secrets | **PASS** | 4 secret patterns checked, 0 found |

**Summary: 15 PASS, 2 FAIL, 1 INFO.**

### Root cause of the 2 failures

Both failures stem from the **same route-ordering bug** (Defect 5, not fixed):

`server.js` route order:
1. Line 110: `GET /api/projects/:id` — matches any pathname starting with `/api/projects/` with method GET
2. Line 118: `GET /api/projects/:id/tasks` — should match paths ending in `/tasks`, but never reached because line 110 matches first

When a request comes in for `GET /api/projects/1/tasks`:
- Line 110 matches (`pathname.startsWith('/api/projects/')` is true, method is GET)
- The `:id` is extracted as `pathname.split('/')[3]` = `'1'` (correct after Defect 1 fix)
- The route returns the project with id=1, NOT the tasks list
- Line 118 (`/tasks` route) is never reached

**Effect on A-13b:** after restart, `GET /api/projects/1/tasks` returns `{ok:true, data:{project...}}` (a single object), not `{ok:true, data:[task...]}` (an array). The acceptance check `isinstance(b.get('data'), list)` returns False → FAIL.

**Effect on A-14:** the api.test.js test "should filter tasks by status" (line 423) calls `GET /api/projects/${projectId}/tasks` and expects `tasksResponse.data.data` to be an array. But the route returns the project object, so `.find(...)` fails with `TypeError: ...find is not a function`. Some other tests that depend on `GET /api/projects/:id/tasks` also hang or fail, causing the test suite to time out.

**One-line fix** (not applied — per task instruction "One controlled live repair attempt. Do not automatically regenerate or retry"): reorder lines 110-118 so `GET /api/projects/:id/tasks` is checked BEFORE `GET /api/projects/:id`, OR add `&& !pathname.endsWith('/tasks')` to the line 110 condition. This would fix both A-13b and A-14.

### Browser acceptance evidence

`evidence/g7-18c/browser-acceptance-dashboard.png` — screenshot of the running application. The browser test:
1. Navigated to `http://127.0.0.1:3180/`
2. Filled the create-project form ("Acceptance Browser Project")
3. Clicked submit → project created via `POST /api/projects`
4. Created a task via `POST /api/projects/{id}/tasks` → 201
5. Updated task status via `PATCH /api/tasks/{id}` → 200, status=in-progress
6. Verified filter via `GET /api/tasks?status=in-progress` → task present

This is a **REAL frontend/backend interaction** (not just HTML retrieval) — the browser test creates data via the UI, verifies it via the API, and confirms the full-stack round-trip works.

---

## Phase 4 — Completion Verification (4 Separate Reports)

### 1. Genesis mission terminal status

**GENESIS_MISSION_STATUS = PARTIAL**

The mission was aborted by the 540s timeout. Both specialists (`software-engineer-1`, `documentation-writer-2`) reported "success" with summary "repaired" before the timeout, but the Mission Coordinator never started and the mission-level status is PARTIAL (not SUCCEEDED).

The mission did NOT reach SUCCEEDED status. Per task instruction: "Do not report `SUCCEEDED` unless the Genesis mission actually reaches that status."

### 2. Genesis structural verification result

**GENESIS_VERIFICATION = FAIL**

The verification event reports `ok: false, passed: 48, failed: 4, failures: 4`. 48 of 52 structural checks passed; 4 failed. The 4 failures are content-in-artifacts checks that likely include the route-ordering content check (e.g., "server.js has correct route order" — though this specific check was not in the acceptance criteria, the 4 failures suggest some structural expectation was not met).

### 3. Application automated test result

**APPLICATION_TESTS = FAIL**

`npm test` times out after 120 seconds. The db tests (6/6) all pass. The api tests fail because `GET /api/projects/:id/tasks` returns the project instead of the tasks array (route-ordering bug), causing `TypeError: ...find is not a function` and subsequent test hangs.

### 4. Independent behavioral acceptance result

**CLEAN_ROOM_ACCEPTANCE = FAIL**

15 of 17 acceptance checks PASS. 2 FAIL (A-13b task persistence verification, A-14 automated tests). Both failures are caused by the same route-ordering bug (Defect 5, not fixed).

### Summary

A clean-room PASS with a Genesis mission PARTIAL is meaningful progress, but not complete mission success. The G7-18C mission made significant progress (15/17 vs G7-18B's 11/17), but the primary success criterion ("all original G7-18 behavioral acceptance checks PASS") was NOT met — 2 checks still fail.

---

## Phase 5 — Regression and Delivery

### Engine quality gates

| Check | Result |
|---|---|
| typecheck (tsc --noEmit) | **PASS** |
| lint (eslint .) | **PASS** |
| Full regression (vitest) | **913 passed, 9 skipped, 0 failed (93 files)** — unchanged from G7-18B |
| Frozen contracts | **UNCHANGED** — 0 diff lines vs `25fde11` across `core.ts`, `verification.ts`, `orchestrator.ts`, `goal-compiler.ts` |
| New dependencies | None |
| Engine source changes | **None** in G7-18C. Only `eslint.config.js` (+1 line: added `evidence/g7-18c/**` to ignore list). |

### Evidence index (`evidence/g7-18c/`)

- `phase-1-diagnostic-report.md` — Phase 1 diagnostic (all 5 defects)
- `phase-2-summary.json` — Phase 2 pilot summary (mission ID, status, tokens, duration)
- `submit-response.json` — gateway acceptance response with missionId
- `mission-snapshot.json` — terminal snapshot (PARTIAL)
- `mission-events.json` — full flight recorder event stream (48 events)
- `artifacts-response.json` — gateway artifacts API response
- `workspace-files.json` — list of workspace files saved (excluding incidental runtime files)
- `workspace/` — per-worker workspace snapshots
- `clean-room-app/` — UNMODIFIED `software-engineer-1` artifacts extracted for Phase 3 acceptance
- `starting-hashes.json` — SHA-256 hashes of the 9 G7-18B starting-point files
- `repaired-vs-starting-hashes.json` — side-by-side hash comparison (4 changed, 5 unchanged)
- `acceptance-results.json` — Phase 3 acceptance results (15 PASS, 2 FAIL, 1 INFO)
- `acceptance-log.txt` — Phase 3 stdout log
- `backend-stdout.txt` — backend startup stdout
- `backend-restart-stdout.txt` — backend restart stdout
- `npm-install.txt` — npm install output
- `app-test-stdout.txt` / `app-test-stderr.txt` — `npm test` output (timeout after 120s)
- `browser-acceptance-dashboard.png` — browser screenshot showing the running application
- `browser-console.json` — browser console messages during Phase 3
- `g7-18b-starting-hashes.json` — G7-18B starting hashes (for cross-reference)
- `final-head.json` — post-push HEAD hashes (separate file to avoid the G7-18 metadata bug)

### Scripts

- `/home/z/my-project/scripts/g7-18c-pilot.py` — Phase 2 live pilot driver
- `/home/z/my-project/scripts/g7-18c-acceptance.py` — Phase 3 independent acceptance suite
- `/home/z/my-project/scripts/g7-18c-hash-compare.py` — Phase 5 hash comparison

---

## Required Final Status

```text
MISSION = G7-18C
GENESIS_MISSION_STATUS = PARTIAL
GENESIS_VERIFICATION = FAIL
AUTONOMOUS_REPAIR = PARTIAL
BACKEND_API = PASS
DATABASE = PASS
FRONTEND = PASS
TASK_MANAGEMENT = FAIL
PERSISTENCE = FAIL
APPLICATION_TESTS = FAIL
BROWSER_ACCEPTANCE = PASS
CLEAN_ROOM_ACCEPTANCE = FAIL
MANUAL_APPLICATION_CODE_INTERVENTION = NO
ACTUAL_TOKENS = 458534
ACTUAL_DURATION = 540643ms
FULL_REGRESSION = 913 passed, 9 skipped, 0 failed (93 files)
FROZEN_CONTRACTS = UNCHANGED (0 diff lines vs 25fde11)
FINAL_LOCAL_HEAD = (see evidence/g7-18c/final-head.json)
FINAL_REMOTE_HEAD = (see evidence/g7-18c/final-head.json)
HEAD_MATCH = YES
NEXT_STAGE_STARTED = NO
```

**Note on TASK_MANAGEMENT = FAIL / PERSISTENCE = FAIL:** task creation (`POST /api/projects/:id/tasks`), task status update (`PATCH /api/tasks/:id`), and status filtering (`GET /api/tasks?status=...`) all PASS individually. But `GET /api/projects/:id/tasks` (the route that lists tasks for a project) returns the project object instead of the tasks array due to the route-ordering bug (Defect 5, not fixed). This causes the task-persistence verification (A-13b) and the automated tests (A-14) to fail. The tasks DO persist in the database (verified via `GET /api/tasks?status=in-progress` which returns the task after restart), but the route that should list them by project is broken.

**Note on BROWSER_ACCEPTANCE = PASS:** this is a REAL frontend/backend interaction, not just HTML retrieval. The browser test created a project via the UI form, created a task via the API, updated the task status via PATCH, and verified the filter via GET — all through the real running backend. This is the first time in the G7-18/G7-18B/G7-18C series that browser acceptance has PASSED.

**Note on AUTONOMOUS_REPAIR = PARTIAL:** 4 of 5 defects were fixed autonomously. The 5th defect (route-ordering) was not in the Phase 1 diagnostic and was not fixed. Per task instruction "One controlled live repair attempt. Do not automatically regenerate or retry the full application" — no retry was launched. The one-line fix for the route-ordering bug is known but not applied (it would be a manual application code modification, which is forbidden).

---

## Honest Status Statement

G7-18C made significant progress toward full functional success:

- **15 of 17 behavioral acceptance checks PASS** (up from G7-18B's 11/17 and G7-18's 3/17).
- **Browser acceptance PASSES** for the first time — real frontend/backend interaction through the running application.
- **4 of 5 defects fixed** autonomously through the production Gateway + missionInputs + ZAI + OpenBot path.
- **No manual application code modification** — all repairs were performed by Genesis's worker.
- **No frozen contracts modified** — only `eslint.config.js` was changed (1 line, evidence-ignore entry).

The 2 remaining failures (A-13b task persistence verification, A-14 automated tests) are both caused by the same route-ordering bug: `GET /api/projects/:id` (line 110) matches before `GET /api/projects/:id/tasks` (line 118), so the `/tasks` route is never reached. The route returns the project object instead of the tasks array. The fix is a one-line reorder (or a condition addition), but per task instruction "One controlled live repair attempt. Do not automatically regenerate or retry the full application" — this fix was not applied.

The primary success criterion ("all original G7-18 behavioral acceptance checks PASS") was **NOT met** — 2 of 17 checks still fail. The mission is PARTIAL, not SUCCEEDED. But the progress is real: the application now starts, runs, handles project/task CRUD (except the task-listing route), persists data, passes browser interaction, and has no secrets. A one-line fix to route ordering would close the remaining gap.

**SMALL IN CODE. LARGE IN CAPABILITY.**
