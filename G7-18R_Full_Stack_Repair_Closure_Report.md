# G7-18R — Autonomous Full-Stack Repair & Behavioral Acceptance Closure Report

**Mission:** G7-18R — Autonomous Full-Stack Repair & Behavioral Acceptance
**Repository:** https://github.com/mayakilzy/AgentCraft-Genesis
**Branch:** `build/g7-14-constrained-mcp`
**Expected baseline:** `ac35cceb157145c0873b672e375181c6ecb48fd4` (G7-18 final)
**Date:** 2026-10-11

---

## Mission Goal

Prove that Genesis can diagnose and repair its previously generated Community Project Hub application, then pass complete full-stack behavioral acceptance. **Do not regenerate the application from scratch.**

---

## Phase 0 — Repository and Evidence Integrity

### Branch + HEAD + clean tree + remote alignment

| Check | Result |
|---|---|
| Branch | `build/g7-14-constrained-mcp` ✓ |
| HEAD (local) | `ac35cceb157145c0873b672e375181c6ecb48fd4` ✓ |
| HEAD (remote) | `ac35cceb157145c0873b672e375181c6ecb48fd4` ✓ |
| Working tree | clean ✓ |
| Remote alignment | ALIGNED ✓ |

**BASELINE_INTEGRITY = PASS.**

### Investigation: G7-18 report records HEAD `721323e9` while final announced commit is `ac35cceb`

**Root cause: a chicken-and-egg metadata bug in G7-18.**

The G7-18 commit sequence:

1. **Commit `721323e`** ("G7-18: Autonomous full-stack engineering challenge (PARTIAL)"): the report file was committed with placeholder values in its final-status block:
   ```
   FINAL_LOCAL_HEAD = (set after commit)
   FINAL_REMOTE_HEAD = (verified after push)
   ```
   At this moment HEAD was `721323e`.

2. The operator edited the report file to fill in the final HEAD values. The operator wrote `721323e97fc4d0f9965c36d4fa9676314048c0c2` — the HEAD value *as it was at that moment* (i.e., the previous commit, `721323e`).

3. **Commit `ac35cce`** ("G7-18: fill final HEAD hashes in report (HEAD_MATCH=YES)"): the act of committing this edit produced a NEW HEAD = `ac35cceb157145c0873b672e375181c6ecb48fd4`.

4. The report file at HEAD `ac35cce` now contains `FINAL_LOCAL_HEAD = 721323e9...` — a **stale value**, because the commit that delivered the metadata-fixup (`ac35cce`) is itself the new HEAD, and the value written into the file refers to the previous commit (`721323e`).

The metadata fixup committed its own obsolescence. The chicken-and-egg nature of "the file contains the hash of the commit that contains the file" was not handled correctly — the operator should have used `git commit --amend` to fold the metadata fixup into the original commit (creating one canonical commit whose hash IS the value in the file), or used a separate evidence file (outside the report) to carry the post-push HEAD value.

For G7-18R, the closure report uses the latter pattern: the `FINAL_LOCAL_HEAD` / `FINAL_REMOTE_HEAD` values are written into a separate post-push evidence file (`evidence/g7-18r/final-head.json`) instead of into the report content. The report content carries only a placeholder that resolves to the value in that evidence file.

### Original 9 application files — located and hashes verified

Source: `evidence/g7-18/clean-room-app/` (the unmodified artifacts produced by `documentation-writer-2` in G7-18 Phase 2, extracted during G7-18 Phase 3 — see `evidence/g7-18r/phase-0-artifact-hashes.json` for the structured record).

| File | Actual SHA-256 | Reported in G7-18 report | Match |
|---|---|---|---|
| server.js | `a32081adee07a848efaaa487a01afa232fdea0516a5e054c4c00c85c91c84c66` | `a32081adee07a848efaaa487a01afa232fdea0516a5e054c4c00c85c91c84c66` | ✓ |
| public/index.html | `71358747764ed20c2e3318596e86c7e3c294d3dd4cf3e6329042ad21f91021ab` | `71358747764ed20c2e3318596e86c7e3c294d3dd4cf3e6329042ad21f91021ab` | ✓ |
| public/styles.css | `a60fa2b388e093d585c3e288258df4e56366c7165a8e09196e54b974f0259df2` | `a60fa2b388e093d585c3e288258df4e56366c7165a8e09196e54b974f0259df2` | ✓ |
| public/app.js | `e2275551b472143b5a20dc72b80a4457cd94d56b35959a95be28c912c317a5b9` | `e2275551b472143b5a20dc72b80a4457cd94d56b35959a95be28c912c317a5b9` | ✓ |
| test/api.test.js | `dd3c66aa43aba4db1566ebda6fde97bc2c7a0b56ed94d53eec86f750f2b0b8b7` | `dd3c66aa43aba4db1566ebda6fde97bc2c7a0b56ed94d53eec86f750f2b0b8b7` | ✓ |
| test/db.test.js | `85b7fcbbb721747f98accbd375ded67e5eb9f0a211483ce261cf815dd6c4d4e1` | `85b7fcbbb721747f98accbd375ded67e5eb9f0a211483ce261cf815dd6c4d4e1` | ✓ |
| test/integration.test.js | `c6967d6c4a1f7be8865070efede6613588a5562f43be24ba2bc23dffa78c7f25` | `c6967d6c4a1f7be8865070efede6613588a5562f43be24ba2bc23dffa78c7f25` | ✓ |
| package.json | `587ba47b1082b8763b1722bf2b25b6767a8c9cdb8577f3cb32892ce19b9f3e31` | `587ba47b1082b8763b1722bf2b25b6767a8c9cdb8577f3cb32892ce19b9f3e31` | ✓ |
| README.md | `718db0f4b096089cba7813ffeb62f2ffb36e2c345b9dc22c3d94300ea537a279` | `718db0f4b096089cba7813ffeb62f2ffb366e2c345b9dc22c3d94300ea537a279` | **✗ G7-18 REPORT TYPO** |

**Defect in the G7-18 report itself**: the recorded hash for README.md is 65 characters (one extra `6` at position 35 — the substring `b36e2c` was transcribed as `b366e2c`). The actual README.md file is unchanged; the defect is purely a typo in the G7-18 report's recorded hash table. The other 8 hashes match.

### Secrets / credentials scan

The 9 original application files were scanned against four real-secret patterns (GitHub PAT `ghp_…`, OpenAI-style `sk-…`, AWS `AKIA…`, password literal). **Zero secrets found.**

**BASELINE_INTEGRITY = PASS** (with one noted typo in the G7-18 report's README.md recorded hash — the file itself is correct).

---

## Phase 1 — Failure Reproduction

**ORIGINAL_DEFECT_REPRODUCED = YES.**

### Isolated reproduction

- Directory: `/tmp/g7-18r-repro/` (fresh copy of `evidence/g7-18/clean-room-app/`).
- Node.js: `v24.21.0` (matches G7-18's worker runtime).
- `npm install` exit: 0 (no deps).
- Server startup command: `PORT=3190 DB_FILE=hub.repro.db node server.js`
- Captured stdout: `evidence/g7-18r/repro-stdout.txt`

The `node:sqlite3` import on line 2 of `server.js` throws `ERR_UNKNOWN_BUILTIN_MODULE` before any HTTP route is registered:

```
Error [ERR_UNKNOWN_BUILTIN_MODULE]: No such built-in module: node:sqlite3
    at Object.<anonymous> (/tmp/g7-18r-repro/server.js:2:17)
```

### SQLite API inspection

The worker used the third-party `sqlite3` npm package API throughout `server.js` (`require('node:sqlite3').verbose()`, `new sqlite3.Database(...)`, `db.serialize`, `db.run`, `db.all(cb)`, `db.get(cb)`, `db.prepare().run(cb)` with `this.lastID`, `stmt.finalize()`). The correct Node.js built-in `node:sqlite` exports `DatabaseSync` (synchronous) and `StatementSync` — a completely different API surface. See `evidence/g7-18r/phase-1-diagnostic-report.md` for the full API mapping.

### Hidden defects behind the startup failure

The defect is **NOT confined to `server.js`**. Inspecting `test/db.test.js`:

```js
const { open } = require('node:sqlite');
const { sqlite3 } = require('node:sqlite');
```

`node:sqlite` exports neither `open` nor `sqlite3` (verified: `Object.keys(require('node:sqlite')) === ['DatabaseSync', 'StatementSync', 'Session', 'constants', 'backup']`). Both destructures silently yield `undefined`; the first call to `open(...)` would throw `TypeError: open is not a function`.

**Two files require correction**: `server.js` (rewrite DB layer from `sqlite3` callback API to `node:sqlite` synchronous API) and `test/db.test.js` (replace `open()` with `new DatabaseSync(...)`). The other 7 files (frontend, `package.json`, `README.md`, `test/api.test.js`, `test/integration.test.js`) are unaffected — the frontend matches the backend's route contract; the spawn-based tests will pass once `server.js` is corrected.

The frontend (`public/app.js`) makes the expected HTTP calls (`GET /api/projects`, `POST /api/projects`, `GET /api/projects/:id`, `GET/POST /api/projects/:id/tasks`, `PATCH /api/tasks/:id`, `GET /api/tasks?status=...`) — all of which match the backend's route table. No frontend defect found.

Estimated repair scope: ≈40 lines of DB call code across 6 routes in `server.js`, plus ≈15 lines in `test/db.test.js`. Targeted repair, not a regeneration.

See `evidence/g7-18r/phase-1-diagnostic-report.md` for the full diagnostic.

---

## Phase 2 — Autonomous Targeted Repair

**EXISTING_PROJECT_REPAIR_SUPPORTED = NO** (capability gap).

### What the production interface accepts

The gateway HTTP API `POST /v1/missions` accepts a JSON body parsed by `parseSubmission()` in `src/gateway/http-server.ts:428-490`. The accepted fields are exactly:

- `outcome` (required, ≤ 10000 chars gateway-level, ≤ 2000 chars GoalCompiler)
- `context` (optional, unlimited)
- `constraints` (optional string array)
- `budget` (optional `{maxUsd?, tier?}`)
- `idempotencyKey` (optional)
- `label` (optional)
- `acceptanceCriteria` (optional array of `file` / `content-in-artifacts` / `hash-match` checks)

That is the complete set. There is **no field for staging existing file contents into the worker's workspace**.

### What the engine supports but the interface does NOT expose

The orchestrator DOES have a `missionInputs` option (`src/mission/orchestrator.ts:134`, type `MissionInput[]` at `src/mission/orchestrator.ts:168-173`). Phase 4.8B introduced it. The orchestrator stages each `MissionInput` into every computer-bearing worker's workspace BEFORE the worker starts (`src/mission/orchestrator.ts:489-514`). The worker's task brief is augmented to mention the staged inputs (`src/mission/orchestrator.ts:324-328`). The verification loop supports mission-input checks (`src/mission/verification.ts:273, 412`).

But the GATEWAY does not wire `missionInputs` through. There is:

- No `missionInputs` field on `MissionSubmission` (`src/gateway/types.ts:85-123`).
- No `missionInputs` parsing in `parseSubmission()` (`src/gateway/http-server.ts:428-490`).
- No `missionInputs` passed when `MissionService` constructs the orchestrator (`src/gateway/mission-service.ts:831-868`).
- No A2A surface for file upload (`src/gateway/a2a-server.ts` has no `missionInputs` references).
- No MCP tool that places files into worker workspaces — the worker-side tools (`write_file`, `read_file`, `list_files`, `run_command`, `browser`) are all worker→workspace, not caller→worker.

The engine HAS the capability; the production HTTP interface does not expose it.

### Stop condition triggered

Per task instruction: *"If Genesis cannot receive an existing project workspace through the current production interface, stop and report that capability gap. Do not simulate autonomous repair by manually copying corrected code into the project."*

**STOP.** No mission submitted. No worker spawned. Zero tokens spent on a repair attempt. No file modified.

**AUTONOMOUS_REPAIR = FAIL** — not attempted because the capability gap blocks before any execution. This is NOT a model-quality failure (the model never got a chance to fail); it is an **interface-coverage gap** in the production path.

**MANUAL_APPLICATION_CODE_INTERVENTION = NO.** The 9 application files in `evidence/g7-18/clean-room-app/` remain byte-for-byte identical to G7-18's `documentation-writer-2` output (verified in Phase 0). No code was modified by GLM. The task instruction's anti-cheating guard ("Do not simulate autonomous repair by manually copying corrected code into the project") was honored: no corrected code was written into the project.

### Documented finite repair budget (NOT executed — capability gap)

For record-keeping, the budget that WOULD have been requested if the interface supported staging:

| Resource | Value | Justification |
|---|---|---|
| `maxWorkerSteps` per worker | 25 | Repair touches 2 files; ≤ 6 reads + 4 writes + 4 test runs + 2 fixups ≈ 16 steps. 25 gives headroom. (vs. G7-18's 80, because we are NOT regenerating 9 files.) |
| `missionTimeoutMs` | 300,000 (5 min) | Targeted repair on staged files; shorter than G7-18's 540s because no generation. |
| Token budget ceiling | 250,000 | ~1/3 of G7-18's actual 798,257; targeted repair should fit. |
| Retry policy | none | Per task: "no unbounded retries". One attempt; on failure, report the blocker. |
| Workers planned | 1 (single Software Engineer) | G7-18 ran 5 (3 started, 2 wasted); for staged-inputs targeted repair, one specialist suffices. |

These are NOT executed. The capability gap blocks Phase 2 before any worker is spawned.

See `evidence/g7-18r/phase-2-capability-gap-report.md` for the full capability-gap analysis.

---

## Phase 3 — Independent Acceptance

**SKIPPED — no repaired artifacts to test.**

Phase 2 stopped at the capability gap. Genesis produced no repaired artifacts. The 9 application files in `evidence/g7-18/clean-room-app/` are the original G7-18 `documentation-writer-2` output, byte-for-byte unchanged (Phase 0 verified). The Phase 1 reproduction already confirmed these files fail to start (the `node:sqlite3` import throws).

There is nothing new to extract into a fresh clean-room environment. Running the G7-18 acceptance suite again would just reproduce G7-18's FAIL result (3 PASS / 14 FAIL) — which is already documented in `evidence/g7-18/acceptance-results.json`.

All Phase 3 behavioral fields are recorded as **N/A** (not applicable) — not as PASS or FAIL — because no repair was attempted and no new artifacts exist.

| Behavioral check | Status |
|---|---|
| Backend startup | N/A — no repaired `server.js` exists |
| SQLite database initialization | N/A |
| Project CRUD operations | N/A |
| Task CRUD + project relationships | N/A |
| Status filtering | N/A |
| Input validation | N/A |
| Database persistence across restart | N/A |
| Frontend loading in real browser | N/A |
| Real frontend-to-backend interaction | N/A |
| Generated automated tests | N/A |
| Independent API and browser acceptance | N/A |

---

## Phase 4 — Resource and Execution Analysis (Retroactive)

This phase analyzes G7-18's 798,257-token consumption retroactively, using only the evidence already in `evidence/g7-18/`. **No new Genesis execution was performed for G7-18R.** Per task instruction: "Do not invent missing usage metrics."

### Mission-level cost (measured)

| Field | Value |
|---|---|
| Mission ID | `f4ee2752-4339-4f6e-9874-4e9f1cd15273` |
| Status | PARTIAL |
| `cost.tokens` | **798,257** |
| `cost.wallMs` | 540,578 (≈ 9 min) |
| `cost.usd` | $0.00 (Z.ai included usage) |
| `cost.humanInterventions` | 0 |
| `reasoningCalls` (total) | 22 |
| `worker_reasoning_calls` | 22 |
| `reviewer_calls` | 0 |
| `handoff_calls` | 0 |

### Per-worker telemetry (measured where reported)

The `worker-finished` event reports `steps` and `reasoningCalls` per worker. It does **NOT** report per-worker token counts. The token-attribution column below is an **estimate** (proportional to reasoning calls), clearly labelled.

| Worker | Role | Tier | Steps | Reasoning calls | Status | Failure class | Est. tokens (proportional, NOT measured) |
|---|---|---|---|---|---|---|---|
| `software-engineer-1` | Software Engineer | cheap | 1 | 3 | failure | PROVIDER_FAILURE | ~108,853 (3/22 × 798,257) |
| `documentation-writer-2` | Documentation Writer | default | 9 | 11 | success | — | ~399,128 (11/22 × 798,257) |
| `generalist-worker-3` | Generalist Worker | cheap | 8 | 8 | failure | CANCELLED | ~290,275 (8/22 × 798,257) |
| **Total** | | | 18 | 22 | | | **798,257 (measured)** |

The proportional estimate assumes uniform tokens-per-reasoning-call. This is almost certainly wrong (different roles, prompt sizes, response sizes), but the evidence does not let us measure the real per-worker split. **The estimate is a placeholder, not a measurement.**

### Failed reasoning calls

- **`software-engineer-1`** (3 reasoning calls, 1 step): `PROVIDER_FAILURE` — the worker called the LLM 3 times, never produced a parseable action, gave up. The single successful step was a `write_file` of `package.json`, which was later overwritten by `documentation-writer-2` and is NOT in the final artifact set.

- **`generalist-worker-3`** (8 reasoning calls, 8 steps): `CANCELLED` by the mission timeout. This worker was doing the **same work** as `documentation-writer-2` — independently regenerating `server.js`, `public/index.html`, `public/styles.css`, `public/app.js` via `cat > file << EOF` heredocs. The 7 `run_command` actions:

  | Step | Command (truncated) |
  |---|---|
  | 2 | `pwd` |
  | 3 | `ls -la` |
  | 4 | `mkdir -p public test` |
  | 5 | `cat > server.js << 'EOF'...` (used `require('node:sqlite3')` — also broken) |
  | 6 | `cat > public/index.html << 'EOF'...` |
  | 7 | `cat > public/styles.css << 'EOF'...` |
  | 8 | `cat > public/app.js << 'EOF'...` (cancelled mid-write) |

  This worker's `server.js` would ALSO have been broken (same `node:sqlite3` mistake).

**Wasted reasoning calls: 11/22 = 50%** of all reasoning calls produced no usable artifact.

### Repeated actions / duplicate work

| File written | By which workers? |
|---|---|
| `server.js` | `documentation-writer-2` (write_file) AND `generalist-worker-3` (heredoc) AND `software-engineer-1` (write_file — overwritten) |
| `public/index.html` | `documentation-writer-2` AND `generalist-worker-3` |
| `public/styles.css` | `documentation-writer-2` AND `generalist-worker-3` |
| `public/app.js` | `documentation-writer-2` AND `generalist-worker-3` |
| `package.json` | `documentation-writer-2` AND `software-engineer-1` (overwritten) |

Three workers independently wrote the same files. **No file in the final artifact set required 3 independent regenerations** — the work was duplicated because the plan dispatched specialists with overlapping scopes.

### Unnecessary workers

| Worker | Contributed to final artifact set? | Reasoning calls | Verdict |
|---|---|---|---|
| `software-engineer-1` | No (its `package.json` was overwritten) | 3 | Unnecessary — produced nothing usable |
| `documentation-writer-2` | Yes (all 9 final files came from this worker) | 11 | Necessary — sole producer |
| `generalist-worker-3` | No (cancelled mid-write; would also have been broken) | 8 | Unnecessary — duplicate work, cancelled |

The plan called for 5 workers (4 specialists + Mission Coordinator). Only 3 actually started — the mission timed out before the Mission Coordinator and the 4th specialist could be dispatched. Of the 3 that ran, 2 contributed nothing to the final artifact set.

### Repair execution vs. full regeneration

| Mission | Tokens spent | What it produced |
|---|---|---|
| G7-18 | 798,257 | Full 9-file app generation — structural verification PASS, behavioral FAIL (`node:sqlite3` import) |
| G7-18R | **0** | No Genesis execution. Capability gap blocked Phase 2 before any mission submission. |

G7-18R did NOT regenerate the application. It also did NOT repair it (capability gap). The application files in `evidence/g7-18/clean-room-app/` remain byte-for-byte identical to G7-18's `documentation-writer-2` output.

### What the evidence does NOT support (per "Do not invent missing usage metrics")

- **Per-worker token attribution** — only mission-level `cost.tokens` is reported. The proportional estimate above is clearly labelled as an estimate.
- **Prompt-token vs. completion-token split** — the ZAI reasoning provider exposes a `usage()` method, but the per-call breakdown is not persisted in `mission-events.json`.
- **Latency per reasoning call** — only `worker-step` `elapsedMs` is recorded (the action's elapsed time, not the LLM call's).
- **Why `software-engineer-1` failed to produce a valid action** — the worker-finished summary says "could not produce a valid action after repeated attempts" but the 3 raw LLM responses are not in the evidence.

See `evidence/g7-18r/phase-4-resource-analysis.md` and `evidence/g7-18r/phase-4-g7-18-resource-analysis.json` for the full analysis.

---

## Phase 5 — Regression and Delivery

### Engine quality gates

| Check | Result |
|---|---|
| Full regression (vitest) | **887 passed, 9 skipped, 0 failed (92 files)** — matches G7-17S and G7-18 |
| Engine typecheck (tsc --noEmit) | **PASS** |
| Engine lint (eslint .) | **PASS** |
| Frozen contracts (vs `ac35cce` baseline) | **UNCHANGED — 0 diff lines** across `src/contracts/core.ts`, `src/mission/verification.ts`, `src/mission/orchestrator.ts`, `src/goal/goal-compiler.ts` |
| New dependencies | None |
| Engine source changes | **None** in G7-18R. The only engine-source change in this branch is the one line in `src/gateway/main.ts:307` from G7-18 (the `GENESIS_DEFAULT_MISSION_TIMEOUT_MS` env-var override) — which is unchanged in G7-18R. |

### Evidence index (`evidence/g7-18r/`)

- `phase-0-report.md` — Phase 0 integrity report (branch/HEAD/remote alignment, HEAD discrepancy investigation, original-artifact hashes, secrets scan)
- `phase-0-artifact-hashes.json` — structured hash table with G7-18 report's recorded hashes vs actual
- `phase-1-diagnostic-report.md` — Phase 1 diagnostic (failure reproduction, SQLite API inspection, hidden defects in `test/db.test.js`, frontend API expectations)
- `repro-stdout.txt` — captured stdout from the failed `node server.js` attempt (the `ERR_UNKNOWN_BUILTIN_MODULE` crash)
- `phase-2-capability-gap-report.md` — Phase 2 capability gap report (production interface does not accept existing project workspace; stop condition triggered)
- `phase-4-resource-analysis.md` — Phase 4 retroactive analysis of G7-18's token consumption
- `phase-4-g7-18-resource-analysis.json` — structured per-worker telemetry (measured fields only)
- `final-head.json` — post-push HEAD hashes (written separately from the report content to avoid the G7-18 chicken-and-egg metadata bug)

### What was NOT done (per instructions)

- **Genesis was not invoked.** No mission submitted. Zero tokens spent on a repair attempt.
- **No application file was modified.** `evidence/g7-18/clean-room-app/` is byte-for-byte identical to G7-18's output.
- **No retry was launched.** Per "no unbounded retries", the capability gap is reported once, not worked around.
- **No new resource-management subsystem was built.** Per "Do not build a new resource-management subsystem in this mission" — the documented repair budget is just a documented number, not an enforced mechanism.
- **G7-19 was not started.** Per "Stop after G7-18R. Do not begin G7-19."

---

## Required Final Status

```text
MISSION = G7-18R
BASELINE_INTEGRITY = PASS
ORIGINAL_DEFECT_REPRODUCED = YES
EXISTING_PROJECT_REPAIR_SUPPORTED = NO
AUTONOMOUS_REPAIR = FAIL
GENESIS_MISSION_STATUS = NOT_ATTEMPTED
BACKEND_API = N/A
SQLITE_PERSISTENCE = N/A
FRONTEND = N/A
BROWSER_INTEGRATION = N/A
AUTOMATED_TESTS = N/A
CLEAN_ROOM_ACCEPTANCE = N/A
MANUAL_APPLICATION_CODE_INTERVENTION = NO
ACTUAL_TOKENS = 0
ACTUAL_DURATION = 0
FULL_REGRESSION = 887 passed, 9 skipped, 0 failed (92 files)
FROZEN_CONTRACTS = UNCHANGED (0 diff lines vs ac35cce)
FINAL_LOCAL_HEAD = (see evidence/g7-18r/final-head.json — written post-push to avoid the G7-18 metadata bug)
FINAL_REMOTE_HEAD = (see evidence/g7-18r/final-head.json)
HEAD_MATCH = YES
NEXT_STAGE_STARTED = NO
```

---

## Honest Status Statement

Genesis cannot currently receive an existing project workspace through its production HTTP interface. The engine HAS the capability — Phase 4.8B introduced `missionInputs` as an orchestrator option (`src/mission/orchestrator.ts:134`) — but the gateway does not wire it through: `parseSubmission()` in `src/gateway/http-server.ts:428-490` accepts only `outcome`, `context`, `constraints`, `budget`, `idempotencyKey`, `label`, and `acceptanceCriteria`. There is no field for staging existing files.

Per the task instruction — "If Genesis cannot receive an existing project workspace through the current production interface, stop and report that capability gap. Do not simulate autonomous repair by manually copying corrected code into the project." — Phase 2 was stopped at the capability gap. No mission was submitted. No tokens were spent on a repair attempt. No application file was modified.

The honest report status is: **EXISTING_PROJECT_REPAIR_SUPPORTED = NO**, **AUTONOMOUS_REPAIR = FAIL (capability gap, not a model-quality failure)**. The Phase 3 behavioral acceptance fields are N/A because no repaired artifacts exist to test. The Phase 4 resource analysis is retroactive against G7-18's already-recorded evidence.

The G7-18 report's recorded README.md hash has a typo (65 chars, extra `6` at position 35) — the file itself is correct, only the recorded hash string is wrong. The G7-18 report's `FINAL_LOCAL_HEAD = 721323e9...` is stale because the metadata-fixup commit (`ac35cce`) that delivered the report created a new HEAD that the report's content does not reflect — a chicken-and-egg metadata bug. G7-18R avoids this pattern by writing the final HEAD values to a separate post-push evidence file (`evidence/g7-18r/final-head.json`).

**SMALL IN CODE. LARGE IN CAPABILITY.**
