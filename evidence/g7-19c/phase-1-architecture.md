# G7-19C Phase 1 — Architecture Assessment

## Objective

G7-19A improved recursive artifact discovery and conflict detection.
G7-19B added a deterministic "majority-then-lexicographic" conflict
resolution policy. That policy is transparent and deterministic — but it
does NOT establish semantic correctness. In the G7-18E matrix, the
lexicographic fallback selected `documentation-writer-2`'s version of
`test/api.test.js`, even though the correct version was
`software-engineer-1`'s (the one that actually passed the independent
acceptance suite).

G7-19C closes that reliability gap by introducing a **verified-package
selection** layer: only complete, verified packages can become
authoritative deliverables. The G7-19B heuristic is preserved for
diagnostic display but is explicitly marked as UNVERIFIED.

## Source evidence reviewed

- `G7-19A_Worker_Aggregation_Reliability_Report.md`
- `G7-19B_Conflict_Resolution_Report.md`
- `G7-18E_Final_Full_Stack_Acceptance_Report.md`
- `evidence/g7-19a/phase-1-root-cause.md` — the G7-18E root-cause diagnosis
- `src/runtime/artifact-aggregation.ts` — G7-19A/G7-19B pure-function layer
- `src/runtime/openbot/adapter.ts` — `listArtifacts` + `listWorkspaceFilesRecursive`
- `src/runtime/memory-computer.ts` — dev-path `listArtifacts`
- `src/gateway/types.ts` — `MissionArtifactRecord` transport type
- `src/gateway/mission-service.ts` — `getArtifacts()` flow, `captureVerificationResult`
- `src/mission/orchestrator.ts` — `collectArtifacts`, `hasDeliverable`, closure logic
- `src/mission/verification.ts` — `ArtifactSource`, `cleanRoomPath`, `deriveChecks`
- `src/contracts/core.ts` — `MissionResult` frozen type
- `src/runtime/computer.ts` — `ArtifactSnapshot`, `ArtifactsProvider` interface
- `tests/runtime/g7-19b-conflict-resolution.test.ts` — existing test patterns

## Existing mechanisms

### Worker workspaces

Each worker is ensured by `runtime.ensureWorker(genome)`. The OpenBot
adapter creates a per-worker workspace directory on disk
(`$OPENBOT_ROOT_DIR/<missionId>/<workerId>/workspace/`). The
`MemoryRuntime` uses an in-memory `Map<string, string>` per worker
(`MemoryComputer.files`).

### Artifact collection (orchestrator, line 910)

`collectArtifacts(participants, results)` iterates `results` (a
`Map<workerId, WorkerResult>`) and uses `result.artifacts` (the
worker's self-reported artifact paths from its `finish()` call) as
the source of truth. When a worker fails before calling `finish()` (or
calls `finish()` with an empty artifact list), `result.artifacts` is
`[]` and the worker is skipped.

This is **Defect B** (documented in G7-19A): the orchestrator trusts
worker self-report instead of disk state.

### Artifact enumeration (gateway, line 1228)

`getArtifacts(missionId, caller)` calls `runtime.listArtifacts()`
(when available) to enumerate files actually on disk. This is the
disk-state source of truth. G7-19A added `listWorkspaceFilesRecursive`
so subdirectories are no longer silently dropped. The function returns
one `ArtifactSnapshot` per `(workerId, path)` pair.

G7-19A/G7-19B routed both the production path and the dev-path
fallback through `buildAggregatedRecords()` to add `contentHash`,
`conflict`, `conflictVersions`, and `conflictResolution` fields.

### Package manifests

The closest existing notion of a "manifest" is the user-supplied
`acceptanceCriteria` field on `MissionSubmission`
(`src/gateway/types.ts` line 122). Each `file` check carries a `path`
field. These paths ARE the declared required deliverables — the manifest.

`MissionService.buildChecks()` (line 866) wires the user's
`acceptanceCriteria` into the orchestrator's `checks` callback. The
orchestrator then runs the verification loop, which writes each
artifact to `artifacts/<workerId>/<path>` (via `cleanRoomPath`) and
runs each check.

Per Defect E (documented in G7-19A), user-supplied `file` checks with
bare paths (e.g. `README.md`) cannot find the prefixed clean-room
copies (`artifacts/<workerId>/README.md`). The default `deriveChecks`
function uses the prefixed form, so derived checks work. User-supplied
checks must use the prefixed form to work — this is a documented
limitation.

For G7-19C, the manifest is derived from the user-supplied
`acceptanceCriteria` by extracting paths from `file` checks and
normalizing them (stripping any `artifacts/<workerId>/` prefix).

### Verification checks

The verification loop (`VerificationLoop.verify()` at
`src/mission/verification.ts` line 227) clears the verifier's
`artifacts/` subtree, copies each `ArtifactSource`'s files into
`artifacts/<workerId>/<path>`, then runs every check. The result is a
`VerificationResult` with `ok: boolean`, `outcomes`, `summary`.

### Mission completion (orchestrator, lines 807-842)

```ts
const finalArtifacts = this.collectArtifacts(participants, results);
const observedDeliverables = await this.collectObservedDeliverables(ensured);
const hasDeliverable = finalArtifacts.length > 0 || observedDeliverables.length > 0;

let status: MissionResult['status'];
let summary: string;
if (aborted) {
  status = hasDeliverable ? 'partial' : 'failure';
  summary = 'mission aborted (timeout or cancellation) before completion';
} else if (verification === undefined || verification.ok) {
  if (!hasDeliverable && workerFailures.length > 0) {
    status = 'failure';
    summary = `all worker runs failed: ...`;
  } else if (!hasDeliverable) {
    status = 'failure';
    summary = 'no worker produced a deliverable';
  } else {
    status = 'success';
    summary = coordinatorSummary || assembleSummary(specialists, results);
  }
} else if (hasDeliverable) {
  status = 'partial';
  summary = `verification failed after retry: ${verification.summary}`;
} else {
  status = 'failure';
  summary = `verification failed and no artifacts were produced: ...`;
}
```

The closure logic is structurally correct. The bug is that
`hasDeliverable` is computed from `finalArtifacts` (worker self-report)
instead of disk state. Fixing `hasDeliverable` to fall back to disk
discovery when self-report is empty closes the G7-18E paradox.

### Timeout and cancellation

A single `AbortController` (line 410). A `setTimeout` (line 411) fires
the controller at `missionTimeoutMs`. The `finally` block (line 855)
clears the timeout and retires workers. The `aborted` flag (line 612)
captures whether the controller fired.

### Gateway artifact responses

`getArtifacts()` returns `MissionArtifactRecord[]`. The current shape
(after G7-19B) carries per-(workerId, path) entries with
`contentHash`, `conflict`, `conflictVersions`, and `conflictResolution`
fields. The `conflictResolution.isAuthoritative` field is set per-record
based on whether the record's `workerId` matches the chosen
`authoritativeWorkerId`.

## Architecture decision — the verified-package layer

### Five states

G7-19C distinguishes five package states (per Phase 2 of the brief):

| State | Meaning |
|---|---|
| `DISCOVERED` | Files exist on disk for this worker (observed via `listArtifacts`). |
| `COMPLETE` | The candidate satisfies its declared manifest: all required paths present, no path-traversal, no symlinks, no duplicate normalized paths. |
| `VERIFIED` | The candidate is complete AND verification ran and bound to this candidate's package identity (verification passed AND all of the candidate's observed paths are in the verified-paths set). |
| `SELECTED` | The candidate is verified AND was chosen deterministically by the selection policy. |
| `UNRESOLVED` | No candidate satisfies the verification requirements. |

A package transitions through these states monotonically. A package
cannot skip VERIFIED. A package cannot be SELECTED without being
VERIFIED.

### Package identity

The deterministic identity of a candidate is a SHA-256 over the
canonical sorted manifest of normalized (path, contentHash) pairs. Two
candidates with the same workerId, same paths, and same content hashes
have the same identity. This is invariant under input order.

### Verification binding

A candidate is VERIFIED only when:

1. `verificationOk === true` (the verification loop ran and passed).
2. Every observed path in the candidate is present in the
   `verifiedPaths` set (which `captureVerificationResult` populates
   from the runtime's `listArtifacts()` when verification passed).

This is the provenance-binding rule: verification evidence must
cover every file in the candidate. A partial verification (some paths
verified, some not) does NOT bind.

### Selection policy — `verified-only-deterministic`

The selection policy is:

1. **Verified packages only.** Incomplete or unverified candidates
   remain visible for diagnosis but cannot be selected.
2. **No automatic cross-worker mixing.** Each candidate corresponds
   to one worker's workspace snapshot. We never combine `server.js`
   from one worker with `package.json` from another.
3. **Deterministic selection among verified candidates.**
   - If exactly one verified candidate exists → SELECTED.
   - If multiple verified candidates exist → choose by
     `(packageIdentity, workerId)` lexicographic order.
4. **Unresolved conflicts.** If no verified candidate exists →
   `UNRESOLVED`. Never fall back to majority or lexicographic on
   unverified packages.
5. **Auditability.** All candidates, all conflicting versions, all
   verification outcomes, all selection rationales, and all rejection
   reasons are preserved in the response. Competing worker artifacts
   are NOT deleted or overwritten.

### Phase D — backward-compat fix for G7-19B `isAuthoritative` semantics

The existing `conflictResolution.isAuthoritative` field is a
HEURISTIC flag (from the `majority-then-lexicographic` policy). It is
NOT a verified-authoritative flag.

G7-19C does NOT silently redefine `conflictResolution.isAuthoritative`.
Instead:

- An OPTIONAL `isHeuristicUnverified` flag is added to
  `conflictResolution`. When `true`, the consumer knows the
  `isAuthoritative` selection is heuristic (not verification-bound).
  The flag is absent (treated as `false`) for backward compatibility
  with pre-G7-19C clients.
- A NEW OPTIONAL `verifiedPackageSelection` field is added to
  `MissionArtifactRecord`. It is populated ONLY when a verified
  package was SELECTED. It carries `packageIdentity`, `packageState`,
  `selectedWorkerId`, `rationale`, and `isAuthoritativePackage`
  (true on the selected candidate's records).

This separates display preference (heuristic, in `conflictResolution`)
from authoritative delivery selection (verified, in
`verifiedPackageSelection`).

### Phase E — evidence-based mission closure (orchestrator.ts)

The brief authorizes a narrowly-scoped change to
`src/mission/orchestrator.ts` for evidence-based artifact discovery and
closure. Specifically:

- After `finalArtifacts = this.collectArtifacts(participants, results)`
  (line 807), if `finalArtifacts.length === 0`, fall back to disk
  discovery via `runtime.listArtifacts()` (cast to
  `WorkerRuntime & Partial<ArtifactsProvider>`).
- The disk-discovered count feeds into `hasDeliverable`.
- The closure decision at line 820 (`if (aborted) { status =
  hasDeliverable ? 'partial' : 'failure'; }`) is unchanged in
  structure — we just feed it disk-state-aware `hasDeliverable`.

This is approximately 10-15 lines of new code in the orchestrator.
Public status types are unchanged. The other three frozen contracts
(`core.ts`, `verification.ts`, `goal-compiler.ts`) are untouched.

### Files modified (summary)

| File | Change | Lines (est.) |
|---|---|---|
| `src/runtime/package-selection.ts` | NEW — pure functions for package model + selection | ~450 |
| `src/runtime/artifact-aggregation.ts` | EXTEND — add `applyPackageSelection()` helper | ~50 |
| `src/gateway/types.ts` | EXTEND — add `verifiedPackageSelection?`, `isHeuristicUnverified?` | ~50 |
| `src/gateway/mission-service.ts` | EXTEND — wire package selection in `getArtifacts()` | ~50 |
| `src/mission/orchestrator.ts` | NARROW FIX — disk-state fallback for `hasDeliverable` | ~15 |
| `tests/runtime/g7-19c-package-selection.test.ts` | NEW — unit tests | ~600 |
| `tests/mission/g7-19c-closure.test.ts` | NEW — orchestrator closure tests | ~400 |
| `evidence/g7-19c/phase-1-architecture.md` | NEW — this file | (here) |
| `evidence/g7-19c/regression-results.json` | NEW — Phase G results | (post-test) |
| `evidence/g7-19c/final-head.json` | NEW — post-push HEAD metadata | (post-push) |
| `G7-19C_Verified_Package_Selection_And_Closure_Report.md` | NEW — final report | (final) |

### Frozen-contract status

| File | Frozen? | Modified? |
|---|---|---|
| `src/contracts/core.ts` | YES | NO |
| `src/mission/verification.ts` | YES | NO |
| `src/mission/orchestrator.ts` | YES (with narrow G7-19C exception) | YES — narrow disk-state fallback only |
| `src/goal/goal-compiler.ts` | YES | NO |

The orchestrator.ts change is authorized by Phase E of the brief:
"A narrowly scoped implementation change to `src/mission/orchestrator.ts`
is authorized ONLY if necessary to correct evidence-based artifact
discovery and closure." The change touches only the `hasDeliverable`
computation; it does NOT change `MissionResult` status types, the
closure structure, or any other public contract.

## Phase 2 implementation plan

1. Create `src/runtime/package-selection.ts` with the pure functions.
2. Extend `src/runtime/artifact-aggregation.ts` with
   `applyPackageSelection()` to populate the new fields on records.
3. Extend `src/gateway/types.ts` with the new optional fields.
4. Wire the package-selection layer into `src/gateway/mission-service.ts`'s
   `getArtifacts()` active path (production and dev).
5. Narrow-fix `src/mission/orchestrator.ts` to compute `hasDeliverable`
   from disk state when self-report is empty.
6. Write the test suites (Phase F).
7. Run full regression (Phase G).
8. Write the final report and deliver (Phase H).
