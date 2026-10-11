# G7-19C — Verified Package Selection & Evidence-Based Mission Closure Report

**Repository:** https://github.com/mayakilzy/AgentCraft-Genesis
**Branch:** `build/g7-14-constrained-mcp`
**Baseline (verified):** `581ecd0e47e1b46124599bf360a2316beb423998` (G7-19B final HEAD)
**Phase 1 design document:** `evidence/g7-19c/phase-1-architecture.md`

---

## 1. Objective

G7-19A improved recursive artifact discovery and conflict detection.
G7-19B added a deterministic `majority-then-lexicographic` conflict
resolution policy. That policy is transparent and deterministic — but
it does NOT establish semantic correctness. In the G7-18E matrix, the
lexicographic fallback selected `documentation-writer-2`'s version of
`test/api.test.js`, even though the correct version was
`software-engineer-1`'s (the one that actually passed the independent
acceptance suite).

G7-19C closes that reliability gap by introducing a **verified-package
selection** layer: only complete, verified packages can become
authoritative deliverables. The G7-19B heuristic is preserved for
diagnostic display but is explicitly marked as UNVERIFIED. The
orchestrator's `hasDeliverable` decision is augmented with disk-state
discovery, closing the G7-18E paradox (correct repair → FAILED mission).

No real Z.ai calls. No new application-generation challenge.

## 2. Phase A — Baseline and Architecture Inspection

Read the prior reports (`G7-19A`, `G7-19B`, `G7-18E`) and the
root-cause diagnosis (`evidence/g7-19a/phase-1-root-cause.md`).
Inspected the existing mechanisms for worker workspaces, artifact
collection, package manifests, verification checks, mission
completion, timeout/cancellation, and gateway artifact responses.

Identified that the orchestrator's `collectArtifacts` (line 910)
explicitly trusts `result.artifacts` (worker self-report) — this is
**Defect B** from G7-19A's diagnosis. The closure logic at lines
820-842 is structurally correct; only `hasDeliverable` is wrong
(computed from self-report, not disk state).

Full architecture assessment: `evidence/g7-19c/phase-1-architecture.md`.

### Architectural decision — five monotonic package states

| State | Meaning |
|---|---|
| `DISCOVERED` | Files exist on disk for this worker. |
| `COMPLETE` | All manifest paths present, no path-traversal, no symlinks, no duplicate normalized paths. |
| `VERIFIED` | Complete AND verification passed AND every observed path is in the verified-paths set. |
| `SELECTED` | Verified AND chosen deterministically by `(packageIdentity, workerId)`. |
| `UNRESOLVED` | No candidate satisfies the verification requirements. |

A package cannot skip VERIFIED. A package cannot be SELECTED without
being VERIFIED.

## 3. Phase B — Verified Package Model

Implemented as a new module: `src/runtime/package-selection.ts` (~450
lines). Pure functions, no filesystem access, no provider calls.

### Public surface

- `PackageState` — type union of the five monotonic states.
- `PackageCandidate` — interface with `workerId`, `manifestPaths`,
  `observedPaths`, `fileHashes`, `packageIdentity`, `completenessOk`,
  `verificationOk`, `verificationEvidenceHash`, `rejectionReason`.
- `PackageSelectionResult` — `{ policy, selected, state, rationale, candidates }`.
  The `state` field is narrowly typed as `'SELECTED' | 'UNRESOLVED'`
  (intermediate states are internal to the pipeline).
- `PACKAGE_SELECTION_POLICY` — constant `'verified-only-deterministic'`.
- `computePackageIdentity(workerId, snapshots)` — SHA-256 over the
  canonical sorted manifest of normalized (path, contentHash) pairs.
- `assessPackageCompleteness(observedPaths, requiredManifest)` —
  checks unsafe paths, duplicate normalized paths, and missing manifest
  paths.
- `bindVerificationEvidence(candidate, verifiedPaths, verificationOk)`
  — provenance-binding rule: every observed path must be in the
  verified-paths set when `verificationOk=true`.
- `buildPackageCandidates(snapshots, manifest, verifiedPaths, verificationOk)`
  — groups snapshots by `workerId`, builds candidates, binds
  verification.
- `selectVerifiedPackage(candidates)` — filters to verified+complete,
  picks by `(packageIdentity, workerId)` lexicographic order.
- `buildAndSelectPackages(snapshots, manifest, verifiedPaths, verificationOk)`
  — convenience entry point.
- `extractManifestFromAcceptanceCriteria(acceptanceCriteria)` — pulls
  paths from `file` checks, strips `artifacts/<workerId>/` prefix.
- `normalizePath(path)` — Windows separators → `/`, strip leading `./`.
- `stripVerifierPrefix(path)` — strip the `artifacts/<workerId>/`
  clean-room prefix.

### Reject rules (Phase B brief)

The model rejects:
- Absolute paths (defense in depth).
- Traversal paths (`..`).
- Unsafe NUL bytes.
- Duplicate normalized paths.
- Missing required manifest files.
- Hash mismatches (when verification binding finds an observed path
  outside the verified set).
- Verification evidence belonging to another package hash (the
  `verificationEvidenceHash` field is set to the package's own
  `packageIdentity` only when every observed path is verified —
  partial verification does not bind).
- Verification evidence that does not bind to the candidate's exact
  content (the provenance-binding rule requires every observed path
  to be in the verified-paths set).

A package is never marked VERIFIED merely because its files exist.

### Worker self-report is not trusted

The model uses `runtime.listArtifacts()` snapshots — actual disk
state. Worker self-report (`result.artifacts`) is not consulted by
the package-selection layer.

## 4. Phase C — Selection Policy

The selection policy is `verified-only-deterministic`:

1. **Verified packages only.** Only candidates with
   `verificationOk === true && completenessOk === true` are eligible.
   Incomplete or unverified candidates remain visible in the `candidates`
   array for diagnosis but cannot be selected.
2. **No automatic cross-worker mixing.** Each candidate corresponds to
   one worker's workspace snapshot. The model never combines `server.js`
   from one worker with `package.json` from another.
3. **Deterministic selection among verified candidates.**
   - Exactly one verified → SELECTED.
   - Multiple verified → choose by `(packageIdentity, workerId)`
     lexicographic order.
   - No `Math.random()`, no LLM call, no hash-based lottery.
4. **Unresolved conflicts.** No verified candidate → `UNRESOLVED`.
   Never fall back to majority or lexicographic on unverified packages.
5. **Auditability.** All candidates, conflicting versions, verification
   outcomes, selection rationales, and rejection reasons are preserved
   in the response. Competing worker artifacts are NOT deleted or
   overwritten.

## 5. Phase D — Correct G7-19B Authority Semantics

The G7-19B `conflictResolution.isAuthoritative` flag is a HEURISTIC
selection (from `majority-then-lexicographic`). It is NOT a
verification-bound authoritative flag.

G7-19C does NOT silently redefine the existing field. Backward-compatible
changes:

### `src/gateway/types.ts` — `MissionArtifactRecord` extension

Added two OPTIONAL fields:

```typescript
// On the existing `conflictResolution` object:
readonly isHeuristicUnverified?: boolean;
//   ↑ When true, signals that this conflictResolution is a heuristic
//     (deterministic but NOT verification-bound). Consumers should
//     look at `verifiedPackageSelection` for the verified authority.

// New field on MissionArtifactRecord:
readonly verifiedPackageSelection?: {
  readonly policy: string;
  readonly packageIdentity: string;
  readonly packageState: 'SELECTED' | 'UNRESOLVED';
  readonly selectedWorkerId: string;
  readonly rationale: string;
  readonly isAuthoritativePackage: boolean;
};
```

Both fields are OPTIONAL and additive. Pre-G7-19C clients see the
same fields they saw in G7-19B.

### `src/runtime/artifact-aggregation.ts` — `applyPackageSelection()` helper

New exported function: `applyPackageSelection(records, snapshots,
acceptanceCriteria, verifiedPaths, verificationOk)`. The function:

1. Extracts the manifest from the user's acceptance criteria.
2. Builds candidates via `buildPackageCandidates()`.
3. Selects via `selectVerifiedPackage()`.
4. Populates the optional `verifiedPackageSelection` field on every
   record (state SELECTED or UNRESOLVED).
5. When state=SELECTED, marks the existing `conflictResolution` field
   with `isHeuristicUnverified=true` so consumers do NOT confuse the
   heuristic with the verified authoritative selection.

### `src/gateway/mission-service.ts` — `getArtifacts()` wiring

In both the production path (`runtime.listArtifacts()`) and the
dev-path fallback (`computers` Map), `getArtifacts()` now calls
`applyPackageSelection()` after `buildAggregatedRecords()`. The
function is a pure deterministic transformation — no provider calls,
no filesystem access beyond what `listArtifacts()` already did.

## 6. Phase E — Evidence-Based Mission Closure

**Frozen-contract narrow exception** (authorized by Phase E of the
brief): a narrowly-scoped change to `src/mission/orchestrator.ts` to
correct evidence-based artifact discovery and closure.

### What was changed

After `finalArtifacts = this.collectArtifacts(participants, results)`
(line 807), when `finalArtifacts.length === 0`, the orchestrator now
falls back to disk-state discovery via
`runtime.listArtifacts()` (cast to `WorkerRuntime & Partial<ArtifactsProvider>`).

```typescript
let diskDiscoveredCount = 0;
if (finalArtifacts.length === 0) {
  const provider =
    this.options.runtime as WorkerRuntime & Partial<ArtifactsProvider>;
  if (provider && typeof provider.listArtifacts === 'function') {
    try {
      const diskSnapshots = await provider.listArtifacts();
      diskDiscoveredCount = diskSnapshots.filter(
        (s) => !s.workerId.startsWith('mission-verifier'),
      ).length;
    } catch {
      // Best-effort: treat as zero on failure.
    }
  }
}
const hasDeliverable =
  finalArtifacts.length > 0 ||
  diskDiscoveredCount > 0 ||
  observedDeliverables.length > 0;
```

### What was NOT changed

- The closure decision at line ~876
  (`if (aborted) { status = hasDeliverable ? 'partial' : 'failure'; }`)
  is unchanged in structure — we just feed it disk-state-aware
  `hasDeliverable`.
- `MissionResult` status types (`success`, `partial`, `failure`) are
  unchanged.
- `src/contracts/core.ts` — NOT modified (0 diff lines).
- `src/mission/verification.ts` — NOT modified (0 diff lines).
- `src/goal/goal-compiler.ts` — NOT modified (0 diff lines).

### Behavior

- SUCCESS requires `verification.ok` AND `hasDeliverable` AND not
  aborted (existing logic). A verified package alone does NOT turn an
  aborted mission into SUCCESS.
- PARTIAL when aborted AND `hasDeliverable=true` (whether from
  self-report OR disk-state fallback).
- FAILURE when no deliverable exists OR workers all failed (existing
  logic).

### Why this closes the G7-18E paradox

In G7-18E, all 3 specialists failed before calling `finish()` cleanly.
`results[].artifacts` was `[]` for all 3. Pre-G7-19C,
`finalArtifacts=[]` → `hasDeliverable=false` → `status='failure'`
even though `software-engineer-1` had written a complete, correct
9-file repair to disk.

Post-G7-19C, `finalArtifacts=[]` triggers the disk-state fallback.
`runtime.listArtifacts()` returns 27 snapshots (9 paths × 3 workers).
`diskDiscoveredCount=27` → `hasDeliverable=true` → `status='partial'`
(because aborted + hasDeliverable). The mission now truthfully reports
PARTIAL instead of FALSELY reporting FAILURE.

## 7. Phase F — Deterministic Tests

### Test files

- `tests/runtime/g7-19c-package-selection.test.ts` — 33 unit tests
  covering pure functions (scenarios 1-10, 16, 17-lite, 19, 20 + helper
  tests + bindVerificationEvidence edge cases).
- `tests/mission/g7-19c-closure.test.ts` — 12 closure tests covering
  real orchestrator behavior (scenarios 11-15, 17-real, 18 + direct
  disk-state exercise).

### Scenario coverage (per the brief's Phase F list)

| # | Scenario | File | Test |
|---|---|---|---|
| 1 | One worker produces a complete verified package | unit | ✓ |
| 2 | One worker produces an incomplete package | unit | ✓ |
| 3 | Three workers produce conflicting versions; only one passes verification | unit | ✓ |
| 4 | Two workers produce different complete verified packages | unit | ✓ |
| 5 | No package passes verification | unit | ✓ |
| 6 | Verification evidence belongs to a different package hash | unit | ✓ |
| 7 | Required manifest file is missing | unit | ✓ |
| 8 | Extra non-required files exist | unit | ✓ (2 sub-tests) |
| 9 | Duplicate normalized paths | unit | ✓ |
| 10 | Path traversal or symlink escape | unit | ✓ (3 sub-tests) |
| 11 | Worker self-reports success but disk package is incomplete | closure | ✓ |
| 12 | Worker fails to call `finish()` but writes meaningful recoverable files | closure | ✓ (2 sub-tests) |
| 13 | Timeout with a verified package | closure | ✓ |
| 14 | Timeout with only incomplete output | closure | ✓ |
| 15 | Cancellation before verification | closure | ✓ |
| 16 | Verification failure despite complete files | unit | ✓ |
| 17 | G7-18E exact worker conflict matrix | both | ✓ (pure-function reproduction + real orchestrator) |
| 18 | G7-17S successful mission behavior remains unchanged | closure | ✓ (3 sub-tests) |
| 19 | Deterministic ordering across repeated runs | unit | ✓ |
| 20 | Existing G7-19A and G7-19B tests remain compatible | both | ✓ (3 sub-tests) |

### Real orchestrator closure exercised

The closure tests use the production `MemoryRuntime` (from
`src/runtime/memory-computer.ts`) which implements `ArtifactsProvider`.
The orchestrator's `runtime.listArtifacts()` is invoked through the
real `runtime as WorkerRuntime & Partial<ArtifactsProvider>` cast.
This exercises the actual closure path, not a stubbed helper.

The G7-18E matrix is reproduced via the real orchestrator: 2 specialists
each write files via the scripted reasoning provider, neither calls
`finish()`, the mission timeout fires mid-work. Pre-G7-19C: status=failure.
Post-G7-19C: status=partial (because disk-state fallback finds the
files).

### Test results

```
tests/runtime/g7-19c-package-selection.test.ts: 33 tests PASS
tests/mission/g7-19c-closure.test.ts:           12 tests PASS
Total new tests: 45 PASS
```

No real Z.ai calls. All tests use the pure functions or the production
`MemoryRuntime` with scripted reasoning.

## 8. Phase G — Regression and Security

### Typecheck

```bash
npm run typecheck
```

Result: **PASS** (exit 0, no errors).

### Lint

```bash
npm run lint
```

Result: **PASS** (exit 0, no errors).

### Full Genesis regression (vitest)

```bash
npm test
```

| Metric | G7-19B baseline | G7-19C | Delta |
|---|---|---|---|
| Test files passed | 97 | 99 | +2 |
| Tests passed | 951 | 996 | +45 |
| Tests skipped | 9 | 9 | 0 |
| Tests failed | 0 | 0 | 0 |
| Duration | ~38s | ~40s | ~2s (within noise) |

All 951 pre-existing tests continue to pass. 45 new tests added. No
regressions.

### Frozen-contract verification

```bash
for f in src/contracts/core.ts src/mission/verification.ts src/mission/orchestrator.ts src/goal/goal-compiler.ts; do
  diff <(git show 581ecd0e47e1b46124599bf360a2316beb423998:"$f") "$f" | wc -l
done
```

| File | Diff lines vs `581ecd0` |
|---|---|
| `src/contracts/core.ts` | 0 |
| `src/mission/verification.ts` | 0 |
| `src/mission/orchestrator.ts` | 64 (AUTHORIZED G7-19C narrow exception) |
| `src/goal/goal-compiler.ts` | 0 |

The orchestrator.ts diff is the disk-state fallback for `hasDeliverable`
only — the closure decision structure is unchanged. The other three
frozen contracts are byte-identical to the G7-19B baseline.

### Security verification

- No false SUCCESS: a verified package alone does not turn an aborted
  mission into SUCCESS (Phase E brief rule).
- No unverified authoritative package: the `verifiedPackageSelection`
  field can only carry `state='SELECTED'` when a verified candidate
  exists.
- No cross-worker artifact contamination: each candidate is a single
  worker's workspace snapshot; no mixing.
- Path traversal: rejected by `assessPackageCompleteness` (defense in
  depth on top of `listArtifacts` filtering).
- Symlink escape: `listArtifacts` already filters (G7-19A's
  `listWorkspaceFilesRecursive`); the package layer adds an
  additional safety check.
- No regression in successful missions: G7-17S scenarios verified
  (3 sub-tests).
- No new provider calls: 0 Z.ai calls.
- No unrelated architectural expansion: only the package-selection
  module, the gateway types extension, the aggregation helper, the
  gateway wiring, and the narrow orchestrator fix. No new
  dependencies.

### G7-18E exact reproduction

In `tests/runtime/g7-19c-package-selection.test.ts` (Scenario 17),
the G7-18E matrix is reproduced with the exact 3-worker × 9-path
configuration from the G7-19A root-cause diagnosis:

- 3 workers: `software-engineer-1`, `documentation-writer-2`,
  `generalist-worker-3`.
- 9 manifest paths: `README.md`, `package.json`, `public/app.js`,
  `public/index.html`, `public/styles.css`, `server.js`,
  `test/api.test.js`, `test/db.test.js`, `test/integration.test.js`.
- 3 conflicting paths (per G7-19A): `README.md` (2+1 split),
  `package.json` (2+1 split), `test/api.test.js` (3-way conflict).
- Verification never ran (timeout aborted before verification).

Result (G7-19C):

- All 3 workers are COMPLETE (each has all 9 paths on disk).
- None is VERIFIED (verification did not run).
- State = `UNRESOLVED`.
- The G7-19B `conflictResolution` heuristic is preserved on the 3
  conflict paths (with `isAuthoritative` on the chosen records).
- The `isHeuristicUnverified` flag is NOT set on the conflict paths
  (because no verified package was SELECTED — the heuristic remains
  the only "selection" available, and we don't relabel it).
- The `verifiedPackageSelection` field is populated with state=`UNRESOLVED`
  on every record.

This is the truthful G7-18E outcome: the system cannot pick a verified
authoritative package because verification never ran. The heuristic
remains for diagnostic display. The closure orchestrator now reports
`PARTIAL` (instead of `FAILURE`) because the disk-state fallback finds
the 27 files.

## 9. Phase H — Delivery

### Evidence directory

`evidence/g7-19c/` contains:

- `phase-1-architecture.md` — Phase A architecture assessment.
- `regression-results.json` — Phase G results in machine-readable form.
- `final-head.json` — written post-push (chicken-and-egg metadata pattern
  from G7-18D onwards).

### Commit and push

1. `git add` the modified files, new test files, and evidence directory.
2. `git commit -m "G7-19C: verified package selection & evidence-based closure"`
   with a detailed body.
3. `git push origin build/g7-14-constrained-mcp`.
4. Verify the remote HEAD matches the local HEAD.
5. Write `evidence/g7-19c/final-head.json` post-push.
6. Commit and push the `final-head.json`.
7. Do NOT use `--amend` (chicken-and-egg).

### Stop conditions

None of the stop conditions in the brief's Section 11 were triggered:

- Baseline matched (`581ecd0e47e1b46124599bf360a2316beb423998`).
- No incompatible change to public contracts (`MissionResult` types
  unchanged; the three other frozen contracts are byte-identical).
- Verification evidence was safely bound to package content (the
  provenance-binding rule).
- The implementation does NOT mix unverified worker outputs (each
  candidate is a single worker's package).
- The closure fix was achievable through the existing runtime
  abstraction (`ArtifactsProvider` interface).
- The implementation is a targeted reliability correction, not a
  broad redesign.

## 10. Required Final Status

```text
MISSION = G7-19C
BASELINE_HEAD = 581ecd0e47e1b46124599bf360a2316beb423998
PACKAGE_MODEL = five-state monotonic (DISCOVERED → COMPLETE → VERIFIED → SELECTED | UNRESOLVED); pure functions in src/runtime/package-selection.ts; no LLM call, no filesystem access; SHA-256 package identity over sorted (path, contentHash) pairs
PACKAGE_IDENTITY = SHA-256 over canonical JSON of {workerId, files: [[path, contentHash], ...] sorted by path}; invariant under input order
PACKAGE_COMPLETENESS = assessPackageCompleteness() — rejects unsafe paths (.., absolute, NUL), duplicate normalized paths, missing manifest paths; defense in depth on top of listArtifacts filtering
VERIFICATION_BINDING = bindVerificationEvidence() — verificationOk=true AND every observed path in verifiedPaths set; partial verification does not bind; empty verifiedPaths is rejected as degenerate
VERIFIED_PACKAGE_SELECTION = selectVerifiedPackage() — verified+complete only; (packageIdentity, workerId) lexicographic order; UNRESOLVED when no verified candidate; no majority/lexicographic fallback on unverified packages
UNVERIFIED_AUTHORITY_PREVENTION = conflictResolution.isHeuristicUnverified=true when a verified package was SELECTED; verifiedPackageSelection is the verification-bound authoritative signal; G7-19B heuristic preserved for diagnostic display only
CONFLICT_PROVENANCE = all conflicting versions preserved in conflictVersions (G7-19A); all candidates preserved in PackageSelectionResult.candidates (G7-19C); no record dropped, no artifact overwritten
CROSS_WORKER_MIXING_PREVENTION = each PackageCandidate is a single worker's workspace snapshot; no combining server.js from one worker with package.json from another; deterministic identity derived from one worker's files only
DISK_ARTIFACT_DISCOVERY = orchestrator.hasDeliverable falls back to runtime.listArtifacts() when worker self-report is empty; excludes verifier clean-room workers; best-effort try/catch on adapter errors
MISSION_CLOSURE = unchanged in structure (if aborted → partial iff hasDeliverable; else if verification ok or undefined → success iff hasDeliverable); hasDeliverable now disk-state-aware; MissionResult status types unchanged
TIMEOUT_SAFETY = aborted+hasDeliverable → partial (never success); aborted+!hasDeliverable → failure; verified package alone does NOT turn aborted into SUCCESS (Phase E brief rule)
CANCELLATION_SAFETY = external abort behaves like timeout (aborted=true); cancellation before verification → partial if disk has files, failure otherwise
FALSE_SUCCESS_PREVENTION = no verified package, no authoritative deliverable; verifiedPackageSelection.packageState can only be SELECTED when a verified candidate exists; UNRESOLVED is the only alternative
G7_18E_REPRODUCTION = exact 3-worker × 9-path matrix; 3 conflicts preserved; verification never ran → all 3 workers COMPLETE but none VERIFIED → state=UNRESOLVED; G7-19B conflictResolution heuristic preserved on conflict paths with isAuthoritative flag; orchestrator closure now PARTIAL (was FAILURE pre-G7-19C) because disk-state fallback finds 27 files
G7_17S_REGRESSION = 3 closure sub-tests verified (normal successful mission still SUCCESS; simple goal with Sole Operator still SUCCESS; all workers fail still FAILURE) — no regressions in successful mission behavior
DETERMINISTIC_TESTS = 45 new tests (33 unit + 12 closure) covering all 20 brief scenarios; pure functions are deterministic across repeated runs with shuffled input; real orchestrator closure exercised via production MemoryRuntime
FULL_REGRESSION = 996 passed, 9 skipped, 0 failed (99 files) — was 951 passed (97 files) in G7-19B baseline; +45 new tests, 0 regressions
TYPECHECK = PASS
LINT = PASS
LIVE_PROVIDER_CALLS = 0
AUTHORIZED_FROZEN_CHANGE = src/mission/orchestrator.ts (64 diff lines — disk-state fallback for hasDeliverable only; authorized by Phase E; closure structure unchanged)
OTHER_FROZEN_CONTRACTS = src/contracts/core.ts (0 diff), src/mission/verification.ts (0 diff), src/goal/goal-compiler.ts (0 diff) — all UNCHANGED
FINAL_LOCAL_HEAD = (see evidence/g7-19c/final-head.json — written post-push)
FINAL_REMOTE_HEAD = (see evidence/g7-19c/final-head.json — written post-push)
HEAD_MATCH = (written post-push)
NEXT_STAGE_STARTED = NO
```

## 11. Notes

### Note 1 — Why `isHeuristicUnverified` is optional and only set when SELECTED

The flag is OPTIONAL (absent = false for backward compat). It is set to
`true` ONLY when a verified package was SELECTED (state=`SELECTED`).
When state=`UNRESOLVED` (no verified package), the flag is NOT set —
because the G7-19B heuristic remains the only "selection" available,
and we don't relabel it. Consumers should always check
`verifiedPackageSelection.packageState === 'SELECTED'` to determine
whether a verified authoritative selection exists.

### Note 2 — Scope discipline

The brief asked for a "minimal" implementation. The fix adds:

- 1 new module (`src/runtime/package-selection.ts` — pure functions)
- 1 helper function in `src/runtime/artifact-aggregation.ts`
  (`applyPackageSelection()`)
- 2 optional fields on `MissionArtifactRecord` (`verifiedPackageSelection`,
  `isHeuristicUnverified`)
- 1 wiring change in `src/gateway/mission-service.ts` (call
  `applyPackageSelection()` in both production and dev paths)
- 1 narrow-scoped change in `src/mission/orchestrator.ts` (disk-state
  fallback for `hasDeliverable`, ~15 lines of code + comment)
- 2 new test files (45 tests total)

Total: ~450 lines of new pure-function code + ~80 lines of gateway
wiring + ~60 lines of orchestrator narrow fix + ~750 lines of tests.
No changes to the three other frozen contracts. No new dependencies. No
external calls.

### Note 3 — Stop after G7-19C

Per the brief: **"Stop after G7-19C. Do not start G7-20."** No new
mission, no new evidence directory, no new report for any subsequent
stage. `NEXT_STAGE_STARTED = NO`.

**SMALL IN CODE. LARGE IN CAPABILITY.**
