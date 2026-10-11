# G7-19A — Worker Aggregation Reliability Report

**Repository:** https://github.com/mayakilzy/AgentCraft-Genesis
**Branch:** `build/g7-14-constrained-mcp`
**Baseline (verified):** `8faa1c43ca63a39669daf56e704ec2e404615628` (G7-18E final HEAD)
**Phase 1 evidence mission:** G7-18E mission `4422008a-c495-4a88-836e-7df84752e448`

---

## 1. Objective

Fix the demonstrated worker-output aggregation and mission-closure
failure that caused G7-18E to report `status=FAILED` despite
`software-engineer-1` producing a complete and independently validated
application repair.

This is a focused infrastructure reliability mission, not a new
application-generation experiment. No real Z.ai calls. No new
application code.

## 2. Phase 1 — Evidence and Root Cause

### Methodology

Read-only diagnosis from the recorded G7-18E mission evidence
(`evidence/g7-18e/`). Inspected:

- `mission-snapshot.json` — terminal mission snapshot
- `mission-events.json` — 29-event stream
- `artifacts-response.json` — 9 entries (3 paths × 3 workers)
- `workspace-files.json` — files written to disk across workers
- Per-worker disk state at
  `evidence/g7-18e/clean-room-app/{documentation-writer-2,generalist-worker-3,software-engineer-1}/workspace/`
- `G7-18E_Final_Full_Stack_Acceptance_Report.md`
- Source code: `src/runtime/openbot/adapter.ts`,
  `src/gateway/mission-service.ts`, `src/mission/orchestrator.ts`,
  `src/mission/verification.ts`

Full diagnosis written to:
`evidence/g7-19a/phase-1-root-cause.md`

### Mission timeline (reconstructed)

| Time                        | Event                                                                              |
|-----------------------------|------------------------------------------------------------------------------------|
| 2026-10-11T02:54:15.658Z    | Mission accepted                                                                   |
| 2026-10-11T02:54:15.659Z    | `mission-started`                                                                  |
| ~420 s                      | Orchestrator ran 3 specialists + coordinator (all eventually failed or were aborted) |
| 2026-10-11T03:01:15.660Z    | `mission-finished` status=failure, wallMs=420001                                   |
| 2026-10-11T03:01:16.318Z    | 28 buffered events flushed (worker-step, handoff, worker-finished)                  |

The mission ran for exactly `420,001 ms` — the configured
`GENESIS_DEFAULT_MISSION_TIMEOUT_MS=420000` plus 1 ms. The
`result.summary` is `"mission aborted (timeout or cancellation) before
completion"`. The `result.evidence` array is empty.

### Per-path conflict matrix (verified on disk)

| Path                    | G7-18D baseline       | software-engineer-1     | documentation-writer-2  | generalist-worker-3     |
|-------------------------|-----------------------|-------------------------|-------------------------|-------------------------|
| README.md               | `718db0f4...` (3253)  | `718db0f4...` (3253)   | `9c5c185e...` (1694)    | `718db0f4...` (3253)   |
| package.json            | `587ba47b...` (502)   | `587ba47b...` (502)    | `4d62a657...` (364)     | `587ba47b...` (502)    |
| public/app.js           | `e2275551...`         | `e2275551...`          | `e2275551...`          | `e2275551...`          |
| public/index.html       | `71358747...`         | `71358747...`          | `71358747...`          | `71358747...`          |
| public/styles.css       | `a60fa2b3...`         | `a60fa2b3...`          | `a60fa2b3...`          | `a60fa2b3...`          |
| server.js               | `aa8dc582...`         | `aa8dc582...`          | `aa8dc582...`          | `aa8dc582...`          |
| test/api.test.js        | `55435904...` (14660) | `c432e545...` (15795) | `556ea966...` (15699)  | `55435904...` (14660)  |
| test/db.test.js         | `4e1ec4f7...`         | `4e1ec4f7...`         | `4e1ec4f7...`          | `4e1ec4f7...`          |
| test/integration.test.js| `f665a4bf...`         | `f665a4bf...`         | `f665a4bf...`          | `f665a4bf...`          |

**Conflict summary:**

- `README.md`: 3 versions, 2 distinct hashes → **CONFLICT**
- `package.json`: 3 versions, 2 distinct hashes → **CONFLICT**
- `test/api.test.js`: 3 versions, 3 distinct hashes → **3-WAY CONFLICT**
- 6 other paths: 3 versions each, 1 hash → no conflict

### Five root-cause defects identified

| # | Defect                                                                  | Frozen file?                              | Smallest fix file                                |
|---|-------------------------------------------------------------------------|-------------------------------------------|--------------------------------------------------|
| A | `listArtifacts` doesn't recurse into subdirectories                    | NO — `src/runtime/openbot/adapter.ts`    | `src/runtime/openbot/adapter.ts`                |
| B | `collectArtifacts` trusts worker self-report, not disk state           | YES — `src/mission/orchestrator.ts`       | `src/gateway/mission-service.ts` (gateway layer)|
| C | `getArtifacts` returns per-worker entries without conflict detection    | NO — `src/gateway/mission-service.ts`    | `src/gateway/mission-service.ts` + `types.ts`   |
| D | Verification skipped when `artifactSources` empty even if disk has files | YES — `orchestrator.ts` + `verification.ts`| Documented; cannot fix without touching frozen   |
| E | User-supplied `file` checks with bare paths cannot find prefixed artifacts | YES — `verification.ts`                  | Documented; cannot fix without touching frozen   |

### ROOT_CAUSE statement

The G7-18E mission reported `FAILED` because of **two compounding
defects**:

1. **Defect A** (immediate cause of underreported aggregation): the
   `listArtifacts` function in `src/runtime/openbot/adapter.ts` used
   `readdir(workspaceDir, { withFileTypes: true })` followed by
   `if (!entry.isFile()) continue;`. This filter skipped every
   directory entry, so files inside `public/`, `test/`, or any other
   subdirectory were silently dropped from the artifact response. The
   G7-18E `software-engineer-1` worker's workspace had 9 files across
   4 directories; the gateway returned only 3 (the top-level files),
   hiding the repaired `test/api.test.js`.

2. **Defect B** (immediate cause of FAILED-vs-PARTIAL misclassification):
   the orchestrator's `collectArtifacts(participants, results)` (lines
   910–925 of `src/mission/orchestrator.ts`) iterates `results` and
   uses `result.artifacts` (the worker's self-reported artifact paths
   from its `finish()` call) as the source of truth. When a worker
   fails before calling `finish()`, `result.artifacts = []` and
   `collectArtifacts` skips that worker. `finalArtifacts` returns
   `[]`, `hasDeliverable` is `false`, and the closure decision at line
   820 (`if (aborted) { status = hasDeliverable ? 'partial' : 'failure'; }`)
   produces `status='failure'` instead of `status='partial'`.

Defects C, D, and E are real but were not the immediate cause of the
FAILED status in G7-18E. They are addressed where the smallest fix
allows; the rest are documented.

## 3. Phase 2 — Minimal Reliable Fix

### Scope constraints honored

- **Frozen contracts** (`src/contracts/core.ts`,
  `src/mission/verification.ts`, `src/mission/orchestrator.ts`,
  `src/goal/goal-compiler.ts`): **0 diff lines** vs G7-18E baseline
  `8faa1c4`. Verified in Phase 4.
- **No broad orchestration redesign**: no changes to the orchestrator
  or verification modules. No new swarm framework. No new database
  technology. All changes are either to existing non-frozen files or
  to new pure-function modules.
- **Backward compatibility**: every new field on
  `MissionArtifactRecord` is OPTIONAL. Existing clients see the same
  fields they saw before. The new fields (`contentHash`, `conflict`,
  `conflictVersions`) appear only when meaningful.

### Files modified

#### `src/runtime/openbot/adapter.ts` — Defect A fix

Added `listWorkspaceFilesRecursive()` (exported helper) that walks a
workspace tree depth-first, accumulating every regular file's
workspace-relative path. Path-traversal protection is applied per
segment (no `..`, no leading `/`, no NUL bytes). Symlinks are skipped
(we only follow real subdirectories) to prevent a crafted symlink from
escaping the workspace. The walk is bounded by
`ARTIFACT_LISTING_MAX_FILES=4096` so a runaway workspace cannot
exhaust memory.

Updated `listArtifacts()` (live path) and `listArtifactsFromDisk()`
(closed-adapter path) to use this helper instead of the old
non-recursive `readdir` + `entry.isFile()` filter.

#### `src/runtime/artifact-aggregation.ts` — Defect C fix (new file)

Pure function module with two exports:

- `aggregateArtifacts(snapshots: readonly ArtifactSnapshot[])`:
  returns an `AggregationResult` grouping snapshots by path,
  computing SHA-256 per inlined entry, and flagging paths where
  multiple workers produced different hashes.
- `buildAggregatedRecords(snapshots, verificationOk, verifiedPaths)`:
  returns the gateway's `MissionArtifactRecord[]` array with
  `contentHash`, `conflict`, and `conflictVersions` populated. Sort
  order is (workerId, path) — the same order as the pre-G7-19A
  implementation, for backward compatibility.

The module is pure: no filesystem access, no provider calls, no
side effects. Two runs over the same input produce identical output.

Conflict definition: a path has a conflict when at least two of its
versions have different `contentHash` values (for inlined files) OR
different `bytes` values (for non-inlined files). When all versions
have the same hash, there is no conflict even with multiple workers.

#### `src/gateway/types.ts` — Defect C transport type

Extended `MissionArtifactRecord` with three OPTIONAL fields:

- `contentHash?: string` — SHA-256 of the inlined content (hex)
- `conflict?: boolean` — true when ≥1 other worker wrote the same path with a different hash
- `conflictVersions?: ReadonlyArray<{ workerId, contentHash, bytes }>` — when conflict=true, the other versions

Existing clients continue to work unchanged (the new fields are
optional and only populated when meaningful).

#### `src/gateway/mission-service.ts` — Defect C wiring

Updated `getArtifacts()` to route through `buildAggregatedRecords()`:

- The production path (runtime implements `ArtifactsProvider`):
  calls `provider.listArtifacts()`, then `buildAggregatedRecords()`.
- The legacy dev path (default `MemoryRuntime`): synthesizes
  `ArtifactSnapshot[]` from the in-memory `computer.files` Map, then
  `buildAggregatedRecords()`.
- The history-index path (post-restart recovery): unchanged. History
  records have no per-worker provenance (workerId is "recovered") and
  no inlined content (so no `contentHash`). Conflict detection is
  therefore not applicable on this path — the response returns the
  persisted records as-is. This is documented behavior, not a silent
  regression.

### What was NOT changed (and why)

#### `src/mission/orchestrator.ts` (Defect B) — frozen

The orchestrator's `collectArtifacts(participants, results)` trusts
worker self-report. When workers fail to self-report, the
`finalArtifacts` array is empty even though files exist on disk.
This caused `hasDeliverable=false` and the `FAILED` (instead of
`PARTIAL`) closure in G7-18E.

This file is in the frozen-contracts list. The smallest fix at the
gateway layer would be a post-mission aggregation pass in
`mission-service.ts` that calls `runtime.listArtifacts()` after the
orchestrator returns and exposes the disk-state via the snapshot API.
However, this would change the `MissionResult.status` semantics
("failure" → "partial") which is a frozen contract field. We cannot
modify the frozen contract to add a new "aborted-with-deliverable"
status.

Instead, the G7-19A fix exposes the disk-state fallback via the
artifacts endpoint: the caller can now see ALL files written to disk
(recursively, with conflict detection) via
`GET /v1/missions/{id}/artifacts`. The caller can determine
`hasDeliverable` independently of the orchestrator's self-report-based
decision. The orchestrator's status field remains authoritative but
is now backstopped by the rich artifacts endpoint.

This is documented in the Phase 1 report as the minimum-scoped
alternative for Defect B.

#### `src/mission/verification.ts` (Defect E) — frozen

User-supplied `file` checks with bare paths (e.g. `path: 'README.md'`)
cannot find artifacts at `artifacts/<workerId>/README.md`. The default
`deriveChecks` function uses the prefixed form
(`artifacts/<workerId>/<path>`) automatically, so derived checks work.
User-supplied checks should use the prefixed form.

This is a documentation issue, not a code fix. The Phase 1 report
explains the convention so future mission authors use the prefixed
form.

#### `src/contracts/core.ts` — frozen, unchanged

`MissionResult.status: 'success' | 'partial' | 'failure'` is frozen.
We cannot add a new `'aborted-with-deliverable'` status. The existing
`'partial'` status is the closest match and is already produced by the
orchestrator when `aborted=true && hasDeliverable=true`. The G7-19A
fix exposes the disk-state fallback so callers can determine
`hasDeliverable` independently.

### Required behavior coverage

| Required behavior                                              | Covered? | How                                                                                                       |
|---------------------------------------------------------------|----------|-----------------------------------------------------------------------------------------------------------|
| Preserve valid, completed worker artifacts.                   | YES      | `listArtifacts` recursion fix surfaces files in subdirectories.                                          |
| Do not let incomplete workers silently overwrite complete ones.| YES      | Per-worker entries are preserved separately in the artifacts response. Conflict detection flags disagreement. |
| Detect conflicting outputs deterministically.                 | YES      | `aggregateArtifacts` computes SHA-256 per entry and flags paths with ≥2 distinct hashes.                  |
| Keep provenance of each artifact.                              | YES      | `MissionArtifactRecord.workerId` is set on every entry. The aggregation preserves per-version workerId. |
| Ensure verification checks the correct authoritative deliverable.| PARTIAL  | Verifier copies files to `artifacts/<workerId>/<path>` (preserving per-worker versions). Documentation updated to use the prefixed form in user-supplied checks. |
| Do not declare SUCCEEDED when conditions are unmet.           | YES      | No change to the orchestrator's closure logic. Status remains `'failure'` or `'partial'` for aborted missions with deliverables on disk. |
| Distinguish worker success, application acceptance, mission success | YES  | The artifacts endpoint now distinguishes per-worker (workerId), per-path conflict state (conflict), and per-file verification state (verified). |
| Preserve backward compatibility and existing frozen contracts.| YES      | All new fields are OPTIONAL. Frozen contracts: 0 diff lines.                                            |

## 4. Phase 3 — Deterministic Reproduction (No Real ZAI Calls)

### Test files added

| Test file                                                  | Tests | Scenarios covered                                                  |
|------------------------------------------------------------|-------|-------------------------------------------------------------------|
| `tests/runtime/g7-19a-aggregation.test.ts`                 | 13    | Scenarios 1–8 + G7-18E exact reproduction + recursion-via-aggregation |
| `tests/runtime/g7-19a-recursion.test.ts`                   | 8     | Defect A recursion edge cases (subdirs, symlinks, hidden files)     |
| `tests/gateway/g7-19a-aggregation-integration.test.ts`    | 2     | End-to-end gateway → mission-service → listArtifacts → aggregation |
| **Total**                                                  | 23    |                                                                   |

### Scenario coverage (matches Phase 3 brief)

1. **One worker delivers complete valid project; others deliver partial subsets** — covered by Scenario 1.
2. **Workers deliver conflicting versions of a file** — covered by Scenario 2.
3. **All workers complete correctly** — covered by Scenario 3.
4. **One worker fails while another completes** — covered by Scenario 4.
5. **Coordinator reaches timeout after valid worker output exists** — covered by Scenario 5.
6. **Required verification fails** — covered by Scenario 6 (with two sub-tests for partial verification).
7. **A fully verified deliverable reaches the correct terminal state** — covered by Scenario 7.
8. **Incomplete or conflicting deliverables never produce false success** — covered by Scenario 8 (with three sub-tests).

### Bonus: exact G7-18E reproduction

A test reproduces the EXACT G7-18E conflict matrix (3 workers × 9 paths
with 3 conflicts) and verifies the aggregation produces the same
shape as the Phase 1 diagnosis.

### No real ZAI calls

All tests use the pure function `aggregateArtifacts` and the in-memory
`MemoryRuntime` + scripted reasoning provider. No `ZAI_*` environment
variables. No network calls. No OpenBot processes. Deterministic and
reproducible.

### Test results

```
Test Files  3 passed (3)
     Tests  23 passed (23)
   Duration  ~1 second
```

## 5. Phase 4 — Regression

### Typecheck

```bash
npm run typecheck
```

Result: **PASS** (exit 0, no errors).

### Lint

```bash
npm run lint
```

Result: **PASS** (exit 0, no errors). No new lint suppressions needed.

### Full Genesis regression (vitest)

```bash
npm test
```

Result:

| Metric             | G7-18E baseline | G7-19A         | Delta            |
|--------------------|-----------------|----------------|------------------|
| Test files passed  | 93              | 96             | +3               |
| Tests passed       | 913             | 936            | +23              |
| Tests skipped      | 9               | 9              | 0                |
| Tests failed       | 0               | 0              | 0                |
| Duration           | 36.73 s         | 36.69 s        | ~0 (within noise)|

All 913 pre-existing tests continue to pass. 23 new tests added (13 +
8 + 2). No regressions.

### Frozen contracts verification

```bash
for f in src/contracts/core.ts src/mission/verification.ts src/mission/orchestrator.ts src/goal/goal-compiler.ts; do
  diff <(git show 8faa1c43ca63a39669daf56e704ec2e404615628:"$f") "$f" | wc -l
done
```

Result:

| File                              | Diff lines vs `8faa1c4` |
|-----------------------------------|-------------------------|
| `src/contracts/core.ts`           | 0                       |
| `src/mission/verification.ts`     | 0                       |
| `src/mission/orchestrator.ts`     | 0                       |
| `src/goal/goal-compiler.ts`       | 0                       |

**All four frozen-contract files are byte-identical to the G7-18E
baseline.** No unauthorized modifications.

### No unrelated changes

The diff vs the G7-18E baseline is limited to:

```
 src/gateway/mission-service.ts |  44 ++++++----
 src/gateway/types.ts           |  31 ++++++++
 src/runtime/openbot/adapter.ts | 177 ++++++++++++++++++++++++++++++++---------
 src/runtime/artifact-aggregation.ts | (new file)
 tests/runtime/g7-19a-aggregation.test.ts | (new file)
 tests/runtime/g7-19a-recursion.test.ts | (new file)
 tests/gateway/g7-19a-aggregation-integration.test.ts | (new file)
 evidence/g7-19a/ | (new evidence directory)
 G7-19A_Worker_Aggregation_Reliability_Report.md | (this file)
```

No changes to `src/contracts/`, `src/mission/orchestrator.ts`,
`src/mission/verification.ts`, `src/goal/goal-compiler.ts`, or any
other frozen file. No changes to application code in `evidence/g7-18e/`
or any prior evidence directory.

## 6. Phase 5 — Delivery

### Evidence directory

`evidence/g7-19a/` contains:

- `phase-1-root-cause.md` — full Phase 1 diagnosis
- `regression-results.json` — Phase 4 results in machine-readable form
- (this file will be added post-push) `final-head.json` — final HEAD metadata

### Commit and push

After writing this report:

1. `git add` the modified files, new files, and evidence directory.
2. `git commit -m "G7-19A: reliable worker aggregation & mission closure"` with a detailed body.
3. `git push origin build/g7-14-constrained-mcp`.
4. Verify remote HEAD matches local HEAD.
5. Write `evidence/g7-19a/final-head.json` post-push (chicken-and-egg
   metadata pattern from G7-18D onwards).
6. Commit and push the final-head.json.

## 7. Required Final Status

```text
MISSION = G7-19A
ROOT_CAUSE = TWO_COMPOUNDING_DEFECTS (Defect A: listArtifacts did not recurse into subdirectories, silently dropping public/* and test/* files; Defect B: orchestrator's collectArtifacts trusted worker self-report result.artifacts, so workers that failed to call finish() produced empty artifactSources, making hasDeliverable=false and the closure mark FAILED instead of PARTIAL)
ARTIFACT_AGGREGATION = FIXED (listArtifacts now walks workspace recursively via listWorkspaceFilesRecursive; bounded by ARTIFACT_LISTING_MAX_FILES=4096; symlinks not followed; per-segment path-traversal protection)
CONFLICT_HANDLING = ADDED (new pure-function module src/runtime/artifact-aggregation.ts computes SHA-256 per inlined entry and flags paths with >=2 distinct hashes; MissionArtifactRecord gains optional contentHash/conflict/conflictVersions fields)
VERIFICATION_INTEGRITY = PARTIAL (Defect E documented: user-supplied file checks with bare paths cannot find prefixed artifacts in clean room — cannot fix without modifying frozen verification.ts; documented the prefixed-path convention)
MISSION_CLOSURE = PARTIAL (Defect B documented: orchestrator's hasDeliverable computed from worker self-report, not disk state — cannot fix without modifying frozen orchestrator.ts; gateway now exposes disk-state fallback via the artifacts endpoint so callers can determine hasDeliverable independently)
DETERMINISTIC_TESTS = 23 PASSED (8 brief scenarios + G7-18E exact reproduction + recursion edge cases + gateway integration)
LIVE_PROVIDER_CALLS = 0
FULL_REGRESSION = 936 passed, 9 skipped, 0 failed (96 files) — was 913 passed (93 files) in G7-18E baseline; +23 new tests, 0 regressions
FROZEN_CONTRACTS = UNCHANGED (0 diff lines vs 8faa1c4 across all 4 frozen files: src/contracts/core.ts, src/mission/verification.ts, src/mission/orchestrator.ts, src/goal/goal-compiler.ts)
FINAL_LOCAL_HEAD = (see evidence/g7-19a/final-head.json — written post-push)
FINAL_REMOTE_HEAD = (see evidence/g7-19a/final-head.json — written post-push)
HEAD_MATCH = (written post-push)
NEXT_STAGE_STARTED = NO
```

## 8. Notes

### Note 1 — Two compounding defects, one primary fix

The G7-18E failure had two compounding causes: (A) listArtifacts
didn't recurse, hiding 6 of the 9 Community Project Hub files; and
(B) the orchestrator trusted worker self-report, marking the mission
FAILED instead of PARTIAL when workers failed to call finish().
Fixing A alone would not have changed the FAILED status (the
orchestrator's self-report-based `hasDeliverable` was the closure
input). Fixing B alone would not have surfaced the missing 6 files
in the artifacts response.

The G7-19A fix addresses A directly (recursion in adapter.ts) and
exposes the disk-state fallback for B via the gateway's artifacts
endpoint (without modifying the frozen orchestrator). This is the
minimum-scoped intervention supported by the actual evidence.

### Note 2 — Scope discipline

Five defects were identified in Phase 1. Two are fixed in code (A, C).
Three are documented (B, D, E) because the smallest fix would require
modifying frozen contracts. The brief said "Preserve backward
compatibility and existing frozen contracts" — that constraint is
honored.

The documented defects have proposed minimum-scoped alternatives that
the gateway layer can implement without touching the frozen modules.
A future G7-19 mission (NOT started here per the brief's "Stop after
G7-19A" instruction) could revisit these if the frozen-contracts
constraint is relaxed.

### Note 3 — Stop after G7-19A

Per the brief: **"Stop after G7-19A. Do not start G7-19 yet."** No
new mission, no new evidence directory, no new report for any
subsequent stage. `NEXT_STAGE_STARTED = NO`.

### Note 4 — Test count growth

G7-18E had 913 tests across 93 files. G7-19A adds 23 tests across 3
new files for a total of 936 tests across 96 files. The new tests are
deterministic (no real ZAI calls), run in ~1 second total, and cover
both the unit-level aggregation logic and the gateway-level HTTP path.

### Note 5 — Single focused engineering worker alignment

The G7-18E brief said: "Prefer one focused engineering worker if
supported by existing configuration." The G7-19A fix is aligned: it
makes the focused worker's output visible at the gateway layer, so
future missions where one worker succeeds and others fail will not be
silently underreported.

**SMALL IN CODE. LARGE IN CAPABILITY.**
