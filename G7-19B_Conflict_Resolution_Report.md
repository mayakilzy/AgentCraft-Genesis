# G7-19B — Conflict Resolution Report

**Repository:** https://github.com/mayakilzy/AgentCraft-Genesis
**Branch:** `build/g7-14-constrained-mcp`
**Baseline (verified):** `3cb0043e3af558b3c89714d713e37840de4d2b9b` (G7-19A final HEAD)
**Phase 1 design document:** `evidence/g7-19b/phase-1-design.md`

---

## 1. Objective

Continue from G7-19A by implementing deterministic conflict
resolution. The G7-19A fix DETECTED conflicts (added
`contentHash`, `conflict`, `conflictVersions` fields); G7-19B
RESOLVES them — picks an authoritative version when multiple
workers wrote different content to the same path.

The policy must be:
- **Deterministic** — same inputs always produce the same output.
- **Transparent** — the policy is explicit and documented in the
  response.
- **Provenance-preserving** — all conflicting versions remain in
  the audit trail.
- **Not random** — no `Math.random()` or hash-based lottery.
- **No external dependencies** — no LLM call to "pick the best
  version".

This is still infrastructure reliability, not application-generation.
No real Z.ai calls.

## 2. Phase 1 — Evidence and Conflict Resolution Design

### Methodology

Read-only review of the G7-19A closure artifacts and the
aggregation module. Inspected:

- `G7-19A_Worker_Aggregation_Reliability_Report.md`
- `evidence/g7-19a/phase-1-root-cause.md` (the G7-18E root-cause diagnosis)
- `src/runtime/artifact-aggregation.ts` (the G7-19A pure-function module)
- `src/gateway/types.ts` (`MissionArtifactRecord` transport type)
- `src/gateway/mission-service.ts` (`getArtifacts()` flow)
- `tests/runtime/g7-19a-aggregation.test.ts` (G7-19A test suite — 13 tests)

### The G7-18E conflict matrix (revisited)

| Path                    | Versions                                              | Distinct hashes | Conflict?       |
|-------------------------|-------------------------------------------------------|-----------------|------------------|
| README.md               | se-1 (baseline), dw-2 (different), gw-3 (baseline)   | 2               | YES (2+1 split)  |
| package.json            | se-1 (baseline), dw-2 (different), gw-3 (baseline)   | 2               | YES (2+1 split)  |
| public/app.js           | se-1, dw-2, gw-3 (all baseline)                       | 1               | NO (unanimous)    |
| public/index.html       | se-1, dw-2, gw-3 (all baseline)                       | 1               | NO (unanimous)    |
| public/styles.css       | se-1, dw-2, gw-3 (all baseline)                       | 1               | NO (unanimous)    |
| server.js               | se-1, dw-2, gw-3 (all baseline)                       | 1               | NO (unanimous)    |
| test/api.test.js        | se-1 (repaired), dw-2 (different), gw-3 (baseline)   | 3               | YES (3-way)       |
| test/db.test.js         | se-1, dw-2, gw-3 (all baseline)                       | 1               | NO (unanimous)    |
| test/integration.test.js| se-1, dw-2, gw-3 (all baseline)                       | 1               | NO (unanimous)    |

**Three conflicts total** in the G7-18E matrix. Two are 2+1 splits
(majority = baseline); one is a 3-way split (no majority).

The CORRECT version for `test/api.test.js` (per Phase 3 acceptance of
G7-18E) was `software-engineer-1`'s (hash `c432e545...`). The other
two versions failed. This is the central tension: **the system
cannot know which version is "correct" without running verification**.
The policy must therefore be transparent about its limitations and
preserve all versions for downstream inspection.

Full Phase 1 design document: `evidence/g7-19b/phase-1-design.md`.

### Design constraints

1. **No LLM call** — the policy must not invoke a reasoning provider.
2. **No timestamps** — the snapshot does not carry write timestamps.
3. **No tier information** — the snapshot does not carry worker tier.
4. **No content semantics** — the policy cannot read content to decide.
5. **Deterministic** — same input → same output.
6. **Transparent** — the policy is documented in the response.
7. **Provenance-preserving** — all versions remain in the audit trail.

### Chosen policy: "majority-then-lexicographic"

A two-tier deterministic rule:

- **Tier 1 — Majority/plurality vote**: group versions by
  `contentHash`. Find the hash with the maximum count. If there
  is a unique winner with count ≥ 2, pick that hash. The chosen
  workerId is the lexicographically smallest workerId among the
  winners (for determinism).
- **Tier 2 — Lexicographic fallback**: if Tier 1 fails (no unique
  winner with ≥2 votes, i.e., all disagree or tied counts), pick
  the version with the lexicographically smallest workerId among
  ALL versions. Arbitrary but transparent — the rationale string
  documents that it's a fallback.
- **Tier 0 — No conflict**: if there is only one version or all
  versions have the same hash, there is no conflict and no
  resolution. The `conflictResolution` field is omitted.

### Known limitation

The Tier 2 fallback is arbitrary — it may NOT pick the
"semantically correct" version. In the G7-18E `test/api.test.js`
case, it picks `documentation-writer-2`'s version (smallest
workerId alphabetically), but the correct version was
`software-engineer-1`'s. The policy is transparent about this
in the rationale string and preserves all 3 versions in
`conflictVersions` so a downstream verification step can
override.

## 3. Phase 2 — Minimal Conflict Resolution Implementation

### Files modified

#### `src/runtime/artifact-aggregation.ts` — Phase 2 fix

Added three new exports:

- **`ConflictResolutionResult` interface** — the per-PATH
  resolution result (without `isAuthoritative`, which is
  per-record). Internal to the aggregation module.
- **`CONFLICT_RESOLUTION_POLICY` constant** — the policy name
  `"majority-then-lexicographic"`. Exported so tests and
  downstream clients can verify the policy name.
- **`resolveConflict(versions)` function** — the pure-function
  policy implementation. Takes a sorted `ArtifactVersion[]` and
  returns the deterministic resolution.

Updated `buildAggregatedRecords()` to:

- Pre-compute the conflict resolution per conflicting path (only
  for paths where `conflict=true`).
- For each record, populate the `conflictResolution` field when
  `conflict=true`. The `isAuthoritative` flag is set per-record
  by comparing the record's workerId to the resolution's
  `authoritativeWorkerId`.
- The `conflictResolution` field carries the same
  `policy`/`authoritativeWorkerId`/`authoritativeContentHash`/
  `rationale` on EVERY record for the same conflicting path, so
  the caller can identify the chosen version from any record.

#### `src/gateway/types.ts` — transport type extension

Added an OPTIONAL `conflictResolution` field to
`MissionArtifactRecord`:

```typescript
readonly conflictResolution?: {
  readonly policy: string;
  readonly authoritativeWorkerId: string;
  readonly authoritativeContentHash: string;
  readonly rationale: string;
  readonly isAuthoritative: boolean;
};
```

The field is OPTIONAL — existing clients continue to work
unchanged. It is only populated when `conflict=true`.

### Backward compatibility

- The `conflictResolution` field is OPTIONAL. Pre-G7-19B clients
  see the same fields they saw in G7-19A.
- The existing `conflict` and `conflictVersions` fields are
  unchanged in semantics and shape.
- The (workerId, path) sort order of the response is unchanged.
- The G7-19A test suite (23 tests) continues to pass unchanged.

### What was NOT changed (and why)

- **Frozen contracts** (`src/contracts/core.ts`,
  `src/mission/verification.ts`, `src/mission/orchestrator.ts`,
  `src/goal/goal-compiler.ts`): **0 diff lines** vs G7-19A
  baseline `3cb0043`. Verified in Phase 4.
- **No new reasoning provider call**. The policy is a pure
  function. No `ReasoningProvider.reason()` call.
- **No orchestrator change**. The orchestrator's closure decision
  remains based on worker self-report. The `conflictResolution`
  field is informational — it tells the caller which version the
  system would pick by default, but does not affect the
  `MissionResult.status` field.
- **No verification module change**. The verifier continues to
  read from `artifacts/<workerId>/<path>` in its clean room.

### Required behavior coverage

| Required behavior                                              | Covered? | How                                                                              |
|---------------------------------------------------------------|----------|----------------------------------------------------------------------------------|
| Resolve conflicts deterministically using a transparent policy | YES      | `resolveConflict()` — pure function, "majority-then-lexicographic" policy.        |
| Preserve all conflicting versions in the response (provenance) | YES      | `conflictVersions` (G7-19A) lists all other versions on every record.            |
| Surface the chosen authoritative version in the response      | YES      | `conflictResolution.isAuthoritative=true` on the chosen record.                  |
| Do not delete or drop any version                              | YES      | The response has one record per (workerId, path). No record is dropped.         |
| Do not modify frozen contracts                                 | YES      | 0 diff lines across all 4 frozen files.                                          |
| Do not introduce a new reasoning-provider call                | YES      | The policy is a pure function. No provider call.                                  |

## 4. Phase 3 — Deterministic Tests for Conflict Resolution

### Test file

`tests/runtime/g7-19b-conflict-resolution.test.ts` — 15 tests
covering the 9 brief scenarios plus sub-tests for edge cases.

### Scenario coverage

1. **Three workers produce three different versions of a file**
   (3-way conflict, no majority) — Tier 2 lexicographic fallback.
2. **Two workers produce the same version; one disagrees** (2+1
   split) — Tier 1 majority vote.
3. **The same worker produces multiple versions** (same hash, no
   conflict) — `conflictResolution` omitted.
4. **Empty input** — `resolveConflict([])` returns empty
   authoritative fields with "no versions to resolve" rationale.
5. **A single worker** (no conflict possible) — `conflictResolution`
   omitted.
6. **A 10-worker conflict** — two sub-tests:
   - 4+3+2+1 split (plurality wins via Tier 1).
   - 5+5 tie (Tier 2 lexicographic fallback).
7. **The exact G7-18E conflict matrix** — three sub-tests:
   - README.md (2+1 split, majority = baseline, chosen =
     generalist-worker-3).
   - test/api.test.js (3-way, chosen = documentation-writer-2
     via lexicographic fallback).
   - Full 9-path matrix (27 records, 3 conflicts, all conflict
     fields verified).
8. **Determinism** — two sub-tests:
   - 3-way conflict presented in 3 different orders → identical
     resolution.
   - 2+1 split presented in 2 different orders → identical
     resolution.
9. **Audit trail** — verify all conflicting versions remain
   accessible via `conflictVersions`, exactly one record has
   `isAuthoritative=true`, the chosen record's `contentHash`
   matches `authoritativeContentHash`.

### Test results

```
Test Files  1 passed (1)
     Tests  15 passed (15)
   Duration  ~170ms
```

No real ZAI calls. All tests use the pure function
`resolveConflict` and `buildAggregatedRecords`. Deterministic
and reproducible.

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

Result: **PASS** (exit 0, no errors). One `require()` style import
in the test file was fixed by switching to an ES import.

### Full Genesis regression (vitest)

```bash
npm test
```

Result:

| Metric             | G7-19A baseline | G7-19B         | Delta            |
|--------------------|-----------------|----------------|------------------|
| Test files passed  | 96              | 97             | +1               |
| Tests passed       | 936             | 951            | +15              |
| Tests skipped      | 9               | 9              | 0                |
| Tests failed       | 0               | 0              | 0                |
| Duration           | 36.69 s         | 38.45 s        | ~1.8s (within noise)|

All 936 pre-existing tests continue to pass. 15 new tests added.
No regressions.

### Frozen contracts verification

```bash
for f in src/contracts/core.ts src/mission/verification.ts src/mission/orchestrator.ts src/goal/goal-compiler.ts; do
  diff <(git show 3cb0043e3af558b3c89714d713e37840de4d2b9b:"$f") "$f" | wc -l
done
```

Result:

| File                              | Diff lines vs `3cb0043` |
|-----------------------------------|-------------------------|
| `src/contracts/core.ts`           | 0                       |
| `src/mission/verification.ts`     | 0                       |
| `src/mission/orchestrator.ts`     | 0                       |
| `src/goal/goal-compiler.ts`       | 0                       |

**All four frozen-contract files are byte-identical to the G7-19A
baseline.** No unauthorized modifications.

### No unrelated changes

The diff vs the G7-19A baseline is limited to:

```
 src/gateway/types.ts                |  44 ++++++
 src/runtime/artifact-aggregation.ts | 262 +++++++++++++++++++++++++++++++++---
 tests/runtime/g7-19b-conflict-resolution.test.ts | (new file, 15 tests)
 evidence/g7-19b/ | (new evidence directory)
 G7-19B_Conflict_Resolution_Report.md | (this file)
```

No changes to `src/contracts/`, `src/mission/`, `src/goal/`, or
any frozen file. No changes to existing tests.

## 6. Phase 5 — Delivery

### Evidence directory

`evidence/g7-19b/` contains:

- `phase-1-design.md` — full Phase 1 design document with the
  policy rationale, algorithm pseudocode, and determinism proof.
- `regression-results.json` — Phase 4 results in machine-readable
  form.
- (this file will be added post-push) `final-head.json` — final
  HEAD metadata.

### Commit and push

After writing this report:

1. `git add` the modified files, new test file, and evidence
   directory.
2. `git commit -m "G7-19B: deterministic conflict resolution"` with a
   detailed body.
3. `git push origin build/g7-14-constrained-mcp`.
4. Verify remote HEAD matches local HEAD.
5. Write `evidence/g7-19b/final-head.json` post-push (chicken-and-egg
   metadata pattern from G7-18D onwards).
6. Commit and push the final-head.json.

## 7. Required Final Status

```text
MISSION = G7-19B
ROOT_CAUSE = G7-19A detected conflicts but did not resolve them — the caller had to manually pick a version when N workers wrote different content to the same path. G7-19B adds a deterministic "majority-then-lexicographic" policy that picks an authoritative version transparently.
CONFLICT_RESOLUTION_POLICY = majority-then-lexicographic (Tier 1: majority/plurality vote with ≥2 agreeing workers, choose lexicographically smallest workerId among winners; Tier 2: lexicographic fallback when no majority, choose smallest workerId among ALL versions; Tier 0: no conflict → no resolution field)
PROVENANCE_PRESERVED = YES (conflictVersions lists all other versions on every record; conflictResolution appears on every record for the same path with isAuthoritative=true only on the chosen one; no record is dropped)
DETERMINISTIC_TESTS = 15 passed (9 brief scenarios + 6 sub-tests + bonus; covering 3-way conflict, 2+1 split, no-conflict, empty, single, 10-worker plurality, 10-worker tie, G7-18E matrix, determinism across 3 input orderings, audit trail preservation)
LIVE_PROVIDER_CALLS = 0
FULL_REGRESSION = 951 passed, 9 skipped, 0 failed (97 files) — was 936 passed (96 files) in G7-19A baseline; +15 new tests, 0 regressions
FROZEN_CONTRACTS = UNCHANGED (0 diff lines vs 3cb0043 across all 4 frozen files: src/contracts/core.ts, src/mission/verification.ts, src/mission/orchestrator.ts, src/goal/goal-compiler.ts)
FINAL_LOCAL_HEAD = (see evidence/g7-19b/final-head.json — written post-push)
FINAL_REMOTE_HEAD = (see evidence/g7-19b/final-head.json — written post-push)
HEAD_MATCH = (written post-push)
NEXT_STAGE_STARTED = NO
```

## 8. Notes

### Note 1 — The Tier 2 fallback is arbitrary (and that's documented)

For the G7-18E `test/api.test.js` 3-way conflict, the policy
picks `documentation-writer-2`'s version (smallest workerId
alphabetically). The CORRECT version was `software-engineer-1`'s.
The policy is transparent about this limitation in the
`rationale` string: `"no majority (3 distinct versions);
tiebreak by lexicographic workerId"`.

The audit trail is preserved: all 3 versions are accessible via
`conflictVersions` on every record for that path. A downstream
verification step (if it runs) is the source of truth for
correctness — the `conflictResolution` field is informational,
not authoritative for correctness.

### Note 2 — Backward compatibility is preserved

The new `conflictResolution` field is OPTIONAL. The existing
`conflict`, `conflictVersions`, and `contentHash` fields (added
in G7-19A) work exactly as before. The (workerId, path) sort
order is unchanged. The G7-19A test suite (23 tests) continues
to pass without modification.

### Note 3 — Scope discipline

The brief asked for a "minimal" implementation. The fix adds:

- 1 new interface (`ConflictResolutionResult`)
- 1 new constant (`CONFLICT_RESOLUTION_POLICY`)
- 1 new function (`resolveConflict`)
- 1 new optional field on `MissionArtifactRecord`
- 1 update to `buildAggregatedRecords` (populate the new field)

Total: ~262 lines of new code in `artifact-aggregation.ts` +
~44 lines in `types.ts`. No changes to frozen contracts. No new
dependencies. No external calls.

### Note 4 — Stop after G7-19B

Per the brief: **"Stop after G7-19B. Do not start G7-20."** No
new mission, no new evidence directory, no new report for any
subsequent stage. `NEXT_STAGE_STARTED = NO`.

**SMALL IN CODE. LARGE IN CAPABILITY.**
