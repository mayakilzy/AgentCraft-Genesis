# G7-18 — Autonomous Full-Stack Engineering Challenge Report

**Mission:** G7-18 — Autonomous Full-Stack Engineering Challenge
**Project:** AgentCraft Genesis
**Repository:** https://github.com/mayakilzy/AgentCraft-Genesis
**Branch:** `build/g7-14-constrained-mcp`
**Authoritative baseline:** `8e2605eb69d1c9454026730715532995a561dd01` (G7-17S SUCCEEDED)
**Date:** 2026-10-11

---

## Mission Objective

Prove that Genesis can autonomously build, integrate, test, and deliver a functional full-stack web application through its real production execution path. Target application: **Community Project Hub — Prototype v0.1**.

---

## Phase 0 — Baseline Verification

| Check | Result |
|---|---|
| Branch | `build/g7-14-constrained-mcp` ✓ |
| HEAD | `8e2605eb69d1c9454026730715532995a561dd01` ✓ |
| Working tree | clean ✓ |
| G7-17S evidence reviewed | SUCCEEDED, 25/25 verification PASS, 82,202 tokens, 124s, real ZAI + OpenBot ✓ |
| Pilot config | maxWorkerSteps=30, mission timeout=600s, ZAI GLM-4-Plus, OpenBot ✓ |

The G7-17S pilot settings are known successful *starting points*, not permanent ceilings. For the larger 9-file full-stack app (vs G7-17S's 5-file CLI app), execution resources were adjusted upward using existing mechanisms (env-var overrides following the G7-17R pattern).

---

## Phase 1 — Application Specification

The Community Project Hub spec was structured as a Goal submission:
- **`outcome`** (1,996 chars — under the GoalCompiler `MAX_OUTCOME_LENGTH = 2000`): high-level mission, stack shape, 9-file deliverable list, completion signal.
- **`context`** (6,716 chars — unlimited length): full per-file specification for Frontend, Backend, Database, Tests, Documentation.
- **`constraints`** (7 entries): synthetic data only, no npm deps, no build step, persistence, parameterized queries, port/db env vars, finish signal.

Stack mandated: Node.js built-ins only (node:http, node:sqlite, node:test, node:assert). No npm dependencies. No build step. SQLite persistence. Vanilla HTML/CSS/JS frontend.

Acceptance criteria submitted to the gateway (structural floor, separate from behavioral acceptance):
- 9 file-existence checks
- 5 content-in-artifacts checks (/api/projects route, /api/tasks route, node:sqlite import, CREATE TABLE, node:test import)

Evidence: `scripts/g7-18-goal.cjs`, `evidence/g7-18/submit-response.json`.

---

## Phase 2 — Autonomous Development (Real Production Path)

Executed through: **Studio → Gateway → ZAI GLM → OpenBot → Artifact Collection → Verification**. No mocks, no manual application code intervention.

### Genesis execution

| Field | Value |
|---|---|
| Mission ID | `f4ee2752-4339-4f6e-9874-4e9f1cd15273` |
| Mission status | **PARTIAL** (mission aborted by timeout after producing files but before all workers reported completion) |
| Verification | **PASS (23/23 structural checks passed, 0 failed)** — all 9 required files exist and contain required content |
| Execution mode | production (real ZAI GLM-4-Plus + OpenBot runtime) |
| Duration | 540,578 ms (≈ 9 min 0.6 s — hit the configured 540 s mission timeout) |
| Token usage | 798,257 |
| USD cost | $0.00 (Z.ai included usage) |
| write_file events | 10 (OK) |
| run_command events | 7 |
| Artifacts delivered | 5 distinct files inlined + 9 files in workspace directories |
| Manual artifact modification | **NO** |

### Worker outcomes

| Worker ID | Role | Status | Steps | Reason |
|---|---|---|---|---|
| `software-engineer-1` | Software Engineer (tier: cheap) | **failure** | 1 | `PROVIDER_FAILURE` — "the worker could not produce a valid action after repeated attempts" |
| `documentation-writer-2` | Documentation Writer (tier: default) | **success** | 9 | Wrote all 9 required files (server.js, package.json, README.md, public/index.html, public/styles.css, public/app.js, test/api.test.js, test/db.test.js, test/integration.test.js) |
| `generalist-worker-3` | Generalist Worker (tier: cheap) | **failure** | 8 | `CANCELLED` — "reasoning provider failed: aborted" (mission timeout aborted the in-flight reasoning call) |

The `documentation-writer-2` worker is the one that successfully produced the full file set used for the clean-room acceptance. The other two workers either failed to produce a valid action repeatedly or were cancelled at the timeout boundary.

### Configuration adjustments (justified by Phase 0 authorization)

Per the G7-18 instructions:
> "These are known successful pilot settings, not permanent project-wide ceilings. Adjust execution resources if necessary for the larger task, using existing mechanisms. Do not introduce arbitrary project-size restrictions."

Two adjustments were made before the final run, both via the existing `process.env.GENESIS_*` pattern (the G7-17R repair introduced `GENESIS_MAX_WORKER_STEPS` as the precedent):

1. **`GENESIS_MAX_WORKER_STEPS=80`** (was 50) — 9-file full-stack app needs more step budget than 5-file CLI app.
2. **`GENESIS_DEFAULT_MISSION_TIMEOUT_MS=540000`** (was hardcoded 180,000) — added a new env-var override in `src/gateway/main.ts:307`:
   ```diff
   -    defaultMissionTimeoutMs: 180_000,
   +    defaultMissionTimeoutMs: Number(process.env.GENESIS_DEFAULT_MISSION_TIMEOUT_MS) || 180_000,
   ```
   This is the only engine-source change in this mission. It does NOT touch any frozen contract.

### Verification event (from gateway)

```json
{"missionId": "f4ee2752-4339-4f6e-9874-4e9f1cd15273", "ok": true, "passed": 23, "failed": 0, "failures": 0}
```

The 23/23 verification reflects structural floor checks (file existence + content presence). It does NOT reflect behavioral acceptance (HTTP endpoints, browser, persistence) — that is the independent Phase 3 suite.

Evidence: `evidence/g7-18/mission-snapshot.json`, `evidence/g7-18/mission-events.json`, `evidence/g7-18/artifacts-response.json`, `evidence/g7-18/workspace/`.

---

## Phase 3 — Independent Acceptance (Clean Room)

The artifacts produced by `documentation-writer-2` were extracted unmodified into `evidence/g7-18/clean-room-app/`. **No file was modified, repaired, or patched.** The independent acceptance suite is the Python script `scripts/g7-18-acceptance.py` (separate from the generated application's own tests).

### Acceptance results

| # | Check | Result | Detail |
|---|---|---|---|
| A-01 | All 9 files present | **PASS** | server.js, public/{index.html,styles.css,app.js}, test/{api,db,integration}.test.js, package.json, README.md |
| A-02 | — | INFO | SHA-256 hashes recorded for every file (see `acceptance-results.json`) |
| A-03 | `npm install` succeeds | **PASS** | exit 0 (no-op since no dependencies) |
| A-04 | Database initializes / backend starts | **FAIL** | `Error [ERR_UNKNOWN_BUILTIN_MODULE]: No such built-in module: node:sqlite3` — backend crashes on import |
| A-05 | Backend API accessible | **FAIL** | skipped (backend never came up) |
| A-06 | Frontend accessible via browser | **FAIL** | skipped (backend never came up) |
| A-07 | User can create a project | **FAIL** | skipped |
| A-08 | Project appears in dashboard | **FAIL** | skipped |
| A-09 | User can create a task linked to project | **FAIL** | skipped |
| A-10 | Task status can be updated | **FAIL** | skipped |
| A-11 | Filters work | **FAIL** | skipped |
| A-12 | Invalid inputs rejected (empty name) | **FAIL** | skipped |
| A-12b | Invalid inputs rejected (bad status) | **FAIL** | skipped |
| A-13 | Data persists across restart | **FAIL** | skipped |
| A-13b | Task+status persists | **FAIL** | skipped |
| A-14 | Automated tests pass | **FAIL** | `npm test` exit 1, pass=0, fail=6 (every test fails because server.js throws on import) |
| A-15 | Browser interaction | **FAIL** | backend not ready for browser test |
| A-16 | No secrets in artifacts | **PASS** | checked 4 patterns (GitHub PAT, OpenAI key, AWS AKIA, password literal) — none found |

**Summary: 3 PASS, 14 FAIL, 9 INFO.** Clean-room acceptance = FAIL.

### SHA-256 hashes of generated artifacts

| File | SHA-256 |
|---|---|
| server.js | `a32081adee07a848efaaa487a01afa232fdea0516a5e054c4c00c85c91c84c66` |
| public/index.html | `71358747764ed20c2e3318596e86c7e3c294d3dd4cf3e6329042ad21f91021ab` |
| public/styles.css | `a60fa2b388e093d585c3e288258df4e56366c7165a8e09196e54b974f0259df2` |
| public/app.js | `e2275551b472143b5a20dc72b80a4457cd94d56b35959a95be28c912c317a5b9` |
| test/api.test.js | `dd3c66aa43aba4db1566ebda6fde97bc2c7a0b56ed94d53eec86f750f2b0b8b7` |
| test/db.test.js | `85b7fcbbb721747f98accbd375ded67e5eb9f0a211483ce261cf815dd6c4d4e1` |
| test/integration.test.js | `c6967d6c4a1f7be8865070efede6613588a5562f43be24ba2bc23dffa78c7f25` |
| package.json | `587ba47b1082b8763b1722bf2b25b6767a8c9cdb8577f3cb32892ce19b9f3e31` |
| README.md | `718db0f4b096089cba7813ffeb62f2ffb366e2c345b9dc22c3d94300ea537a279` |

Evidence: `evidence/g7-18/acceptance-results.json`, `evidence/g7-18/acceptance-log.txt`, `evidence/g7-18/clean-room-app/`, `evidence/g7-18/backend-stdout.txt`, `evidence/g7-18/app-test-stdout.txt`, `evidence/g7-18/app-test-stderr.txt`, `evidence/g7-18/npm-install.txt`.

---

## Phase 4 — Failure Analysis

### Exact failure

The backend `server.js` produced by `documentation-writer-2` starts with:

```js
const http = require('node:http');
const sqlite3 = require('node:sqlite3').verbose();
```

The second line throws at runtime:
```
Error [ERR_UNKNOWN_BUILTIN_MODULE]: No such built-in module: node:sqlite3
    at defaultResolveImplForCJSLoading (node:internal/modules/cjs/loader:1138:13)
```

The correct Node.js built-in module is **`node:sqlite`** (without the `3`), and its API surface is different from the third-party `sqlite3` npm package the worker imitated. `node:sqlite` exports `DatabaseSync` (a synchronous API), not a callback-style `Database` class with a `.verbose()` method.

The Goal spec named `node:sqlite` explicitly (in both `outcome` and `context`, and as a CONSTRAINT):
- `outcome`: "Stack: Node.js built-ins only (node:http, node:sqlite, node:test, node:assert)."
- `context`: "Use only the Node.js standard library plus node:sqlite (built-in since Node 22+)."
- `constraints[1]`: "No npm dependencies (use Node.js built-ins only: node:http, node:sqlite, node:test, node:assert, node:fs, node:path)."

The model nonetheless produced `require('node:sqlite3').verbose()` — a callback-style API that matches the popular third-party `sqlite3` npm package the model has trained on, not the built-in `node:sqlite` module the spec named.

### Defect classification

| Defect | Class | Detail |
|---|---|---|
| Initial 180s default mission timeout was insufficient for 9-file app | **Infrastructure** (initial miscalibration) | Adjusted via `GENESIS_DEFAULT_MISSION_TIMEOUT_MS` env var before the final run. |
| Worker `software-engineer-1` failed with PROVIDER_FAILURE after 1 step | **Model-quality** | Could not produce a valid JSON action after 5 reasoning calls. |
| Worker `documentation-writer-2` wrote `require('node:sqlite3').verbose()` | **Model-quality** (root cause of clean-room acceptance failure) | Wrong module name + wrong API surface — the spec explicitly named `node:sqlite`. |
| Worker `generalist-worker-3` was cancelled | **Infrastructure** (collateral) | Mission timeout aborted the in-flight reasoning call. Not a model-quality defect. |
| Mission status = PARTIAL (timeout) | **Mixed** | Files were produced and verification (structural) passed, but the mission was aborted before all workers reported — and the files produced do not actually run. |

### What was NOT done (per instructions)

- Generated application files were NOT repaired manually.
- Acceptance criteria were NOT weakened.
- No second full-generation attempt was launched after the PARTIAL result. The two pre-final runs that were made were justified infrastructure adjustments (insufficient timeout), not retries on model failure.

### Suggestions for the next stage (per "active partner" expectation)

1. **Stricter pre-execution stack contract enforcement.** The Goal spec named `node:sqlite` three times, but the model still produced `node:sqlite3`. A pre-execution guard could parse `server.js` for the mandated imports and reject before the mission runs the full 9 minutes. (Out of scope for G7-18; not implemented here.)
2. **Single-worker plan for narrow-stack apps.** This mission spawned 5 workers (Software Engineer, Documentation Writer, Generalist Worker, Mission Coordinator, plus the implicit Verification Engineer). For a 9-file app with a tightly-mandated stack, a single Software Engineer with `maxWorkerSteps=80` might converge faster and avoid the cross-worker inconsistency where `software-engineer-1` failed on step 1 while `documentation-writer-2` succeeded.
3. **Goal-compiler signal tuning.** The `node:sqlite3` mistake suggests the model's training distribution is heavily biased toward the third-party `sqlite3` package. Adding an explicit "BANNED: `node:sqlite3`, `sqlite3` npm package" line to the CONSTRAINTS array may help — but this is a tuning experiment for a future mission, not a fix for this one.
4. **Mission timeout should scale with goal complexity.** The default 180s was fine for G7-17S's 5-file app (124s actual) but is a project-size restriction for full-stack apps. The `GENESIS_DEFAULT_MISSION_TIMEOUT_MS` env var added in this mission is a minimal, opt-in escape hatch; a future mission could make it scale with `capabilityNeeds` count or file count.

These are advisory. The task instructions say "Do not begin G7-19." They are NOT being acted on here.

---

## Phase 5 — Genesis Regression and Delivery

### Engine quality gates

| Check | Result |
|---|---|
| Full regression (vitest) | **887 passed, 9 skipped, 0 failed (92 files)** — matches G7-17S |
| Engine typecheck (tsc --noEmit) | **PASS** |
| Engine lint (eslint .) | **PASS** |
| Frozen contracts (vs `8e2605eb`) | **UNCHANGED — 0 diff lines** across `src/contracts/core.ts`, `src/mission/verification.ts`, `src/mission/orchestrator.ts`, `src/goal/goal-compiler.ts` |
| New dependencies | None added to the engine. (Web UI deps installed into `web/node_modules/` for typecheck only — already in `web/package.json` before this mission.) |
| Engine source changes | One line in `src/gateway/main.ts:307` (env-var override for `defaultMissionTimeoutMs`, see Phase 2). Plus `eslint.config.js` allowlist for the two new scripts. |

### Evidence index (`evidence/g7-18/`)

- `submit-response.json` — gateway acceptance response with missionId
- `mission-snapshot.json` — terminal snapshot (PARTIAL)
- `mission-events.json` — full flight recorder event stream (30 events)
- `artifacts-response.json` — gateway artifacts API response
- `workspace-files.json` — list of workspace files saved
- `workspace/` — per-worker workspace snapshots (documentation-writer-2 has all 9 files; software-engineer-1 and generalist-worker-3 have partial sets)
- `clean-room-app/` — UNMODIFIED documentation-writer-2 artifacts extracted for Phase 3
- `acceptance-results.json` — Phase 3 acceptance results (3 PASS, 14 FAIL, 9 INFO)
- `acceptance-log.txt` — Phase 3 stdout log
- `backend-stdout.txt` — backend startup stdout (shows the ERR_UNKNOWN_BUILTIN_MODULE crash)
- `backend-restart-stdout.txt` — same crash on restart
- `app-test-stdout.txt` / `app-test-stderr.txt` — `npm test` output (6 test failures)
- `npm-install.txt` — `npm install` output (exit 0)
- `frontend-html.txt` — captured frontend HTML (truncated)

### Browser screenshots

No browser screenshots were captured because the backend never reached a working state (Phase 3 A-04 FAIL). The Phase 4 instructions ("If the mission does not succeed: Preserve all artifacts and evidence") were followed — no fabricated screenshots.

### Scripts

- `scripts/g7-18-goal.cjs` — Goal spec (outcome + context + constraints)
- `scripts/g7-18-autonomous.cjs` — full runner (Phase 1 + Phase 2 + Phase 3, single-shot)
- `/home/z/my-project/scripts/g7-18-driver.py` — Phase 2 driver (submit + poll + capture)
- `/home/z/my-project/scripts/g7-18-acceptance.py` — Phase 3 independent acceptance suite

Both `scripts/g7-18-goal.cjs` and `scripts/g7-18-autonomous.cjs` are added to the eslint ignore list (CommonJS pattern matching the existing G7-17* scripts).

---

## Required Final Status

```text
MISSION = G7-18
GENESIS_MISSION_STATUS = PARTIAL
FRONTEND = FAIL
BACKEND_API = FAIL
DATABASE = FAIL
FRONTEND_BACKEND_INTEGRATION = FAIL
PERSISTENCE = FAIL
AUTOMATED_TESTS = FAIL
BROWSER_ACCEPTANCE = FAIL
CLEAN_ROOM_ACCEPTANCE = FAIL
MANUAL_APPLICATION_CODE_INTERVENTION = NO
ACTUAL_TOKENS = 798257
ACTUAL_DURATION = 540578ms
FULL_REGRESSION = 887 passed, 9 skipped, 0 failed (92 files)
FROZEN_CONTRACTS = UNCHANGED (0 diff lines vs 8e2605eb)
FINAL_LOCAL_HEAD = 721323e97fc4d0f9965c36d4fa9676314048c0c2
FINAL_REMOTE_HEAD = 721323e97fc4d0f9965c36d4fa9676314048c0c2
HEAD_MATCH = YES
NEXT_STAGE_STARTED = NO
```

---

## Honest Status Statement

Genesis produced all 9 required files for Community Project Hub v0.1 through the real production path (ZAI GLM-4-Plus + OpenBot, no mocks, no manual application code intervention). The structural verification passed 23/23. The behavioral acceptance failed 14/17 because the generated `server.js` uses `require('node:sqlite3').verbose()` — a non-existent Node.js built-in module and a callback-style API that does not match the actual `node:sqlite` built-in named in the Goal spec. The application cannot start. The mission is PARTIAL: structural success, behavioral failure, single model-quality defect as the root cause.

The honest report status is **PARTIAL → FAIL** at the clean-room acceptance gate. Per Phase 4 instructions, no retry was launched and no generated file was repaired. Suggestions for the next stage are advisory only and not acted on.

**SMALL IN CODE. LARGE IN CAPABILITY.**
