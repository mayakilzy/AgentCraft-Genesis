# G7-19A Phase 1 — Evidence and Root Cause

## Objective

Determine, from the recorded G7-18E mission evidence, the precise
origin of the worker-output aggregation and mission-closure failure
that caused G7-18E mission `4422008a-c495-4a88-836e-7df84752e448` to
report `status=FAILED` despite `software-engineer-1` producing a
complete and independently validated application repair.

The diagnosis is read-only. No code is modified in Phase 1.

## Source evidence

- `evidence/g7-18e/mission-snapshot.json` — terminal mission snapshot
- `evidence/g7-18e/mission-events.json` — 29-event stream
- `evidence/g7-18e/artifacts-response.json` — 9 entries (3 paths × 3 workers)
- `evidence/g7-18e/workspace-files.json` — files written to disk across workers
- `evidence/g7-18e/clean-room-app/{documentation-writer-2,generalist-worker-3,software-engineer-1}/workspace/` — per-worker disk state
- `evidence/g7-18e/starting-hashes.json` — G7-18D baseline file hashes
- `evidence/g7-18e/repaired-hashes-final.txt` — `software-engineer-1`'s output hashes
- `G7-18E_Final_Full_Stack_Acceptance_Report.md` — closure report
- `src/runtime/openbot/adapter.ts` — `listArtifacts` implementation
- `src/gateway/mission-service.ts` — `getArtifacts()` aggregation path
- `src/mission/orchestrator.ts` — mission closure (`hasDeliverable`, `status`)
- `src/mission/verification.ts` — `cleanRoomPath`, `checkFile`

## Mission timeline (reconstructed from events + snapshot)

| Time                         | Event                                                                                  |
|------------------------------|----------------------------------------------------------------------------------------|
| 2026-10-11T02:54:15.658Z     | Mission accepted                                                                       |
| 2026-10-11T02:54:15.659Z     | `mission-started`                                                                      |
| 2026-10-11T02:54:15 → 03:01:15 | ~420 s during which the orchestrator ran specialists + coordinator                  |
| 2026-10-11T03:01:15.660Z     | `mission-finished` status=failure, wallMs=420001                                       |
| 2026-10-11T03:01:16.318Z     | 28 buffered events flushed (requirements-compiled, plan-created, 3×worker-started, 14×worker-step, 4×handoff, 3×worker-finished) |

The mission ran for exactly `420,001 ms` = the configured
`GENESIS_DEFAULT_MISSION_TIMEOUT_MS=420000` plus 1 ms. The
`result.summary` is `"mission aborted (timeout or cancellation)
before completion"`. The `result.evidence` array is empty (`[]`).

## Per-worker state

### software-engineer-1 (focused engineering worker)

- 2 `worker-step` events shown: `read_file test/api.test.js`, `read_file test/integration.test.js`
- `worker-finished` status=failure, failureClass=PROVIDER_FAILURE, summary="the worker could not produce a valid action after repeated attempts"
- The `write_file` event for `test/api.test.js` is **missing** from the flushed event stream (the timeout-abort path lost it)
- But the workspace on disk shows `test/api.test.js` was actually written: hash `c432e545...` (15795 bytes), differing from G7-18D baseline `55435904...` (14660 bytes)
- The other 8 files in this worker's workspace are byte-identical to the G7-18D baseline (because missionInputs staged them and the worker didn't touch them)

### documentation-writer-2

- 6 `worker-step` events: 2× `read_file`, 3× `write_file`, 1 unrecorded
- Wrote: `test/api.test.js` (15699 bytes, hash `556ea966...`), `README.md` (1694 bytes, hash `9c5c185e...`), `package.json` (364 bytes, hash `4d62a657...`)
- All 3 writes produced content DIFFERENT from both the G7-18D baseline AND from `software-engineer-1`'s writes
- `worker-finished` status=failure, failureClass=PROVIDER_FAILURE

### generalist-worker-3

- 6 `worker-step` events: 2 initial failures (read_file, list_files), then 4 handoff attempts
- All handoffs to `software-engineer-1` failed with "step budget of 5 exhausted" or "reasoning provider failed: aborted"
- Wrote nothing (its workspace contains only the missionInputs-staged baseline files, byte-identical to G7-18D)
- `worker-finished` status=failure, failureClass=CANCELLED, summary="mission aborted before completion"

## Per-path conflict matrix (verified on disk)

| Path                    | baseline (G7-18D)       | software-engineer-1     | documentation-writer-2  | generalist-worker-3     |
|-------------------------|-------------------------|-------------------------|-------------------------|-------------------------|
| README.md               | `718db0f4...` (3253 B)  | `718db0f4...` (3253 B)  | `9c5c185e...` (1694 B)  | `718db0f4...` (3253 B)  |
| package.json            | `587ba47b...` (502 B)   | `587ba47b...` (502 B)   | `4d62a657...` (364 B)   | `587ba47b...` (502 B)   |
| public/app.js           | `e2275551...` (6687 B)  | `e2275551...` (6687 B)  | `e2275551...` (6687 B)  | `e2275551...` (6687 B)  |
| public/index.html       | `71358747...` (2568 B)  | `71358747...` (2568 B)  | `71358747...` (2568 B)  | `71358747...` (2568 B)  |
| public/styles.css       | `a60fa2b3...` (4958 B)  | `a60fa2b3...` (4958 B)  | `a60fa2b3...` (4958 B)  | `a60fa2b3...` (4958 B)  |
| server.js               | `aa8dc582...` (7657 B)  | `aa8dc582...` (7657 B)  | `aa8dc582...` (7657 B)  | `aa8dc582...` (7657 B)  |
| test/api.test.js        | `55435904...` (14660 B) | `c432e545...` (15795 B) | `556ea966...` (15699 B) | `55435904...` (14660 B) |
| test/db.test.js         | `4e1ec4f7...` (12932 B) | `4e1ec4f7...` (12932 B) | `4e1ec4f7...` (12932 B) | `4e1ec4f7...` (12932 B) |
| test/integration.test.js| `f665a4bf...` (6456 B)  | `f665a4bf...` (6456 B)  | `f665a4bf...` (6456 B)  | `f665a4bf...` (6456 B)  |

**Conflict summary:**

- `README.md` — 3 versions, 2 distinct hashes (`9c5c185e...` ≠ `718db0f4...` ×2). **CONFLICT**.
- `package.json` — 3 versions, 2 distinct hashes. **CONFLICT**.
- `test/api.test.js` — 3 versions, 3 distinct hashes. **3-WAY CONFLICT**.
- All other paths — 3 versions, 1 hash each (no conflict, all workers agreed).

## Aggregated `artifacts-response.json` (what the gateway returned)

The gateway's `GET /v1/missions/{id}/artifacts` response contains 9
entries — exactly 3 paths × 3 workers. The 3 paths returned are
`README.md`, `package.json`, `server.js`. The other 6 paths (the
files in subdirectories `public/` and `test/`) are **MISSING** from
the response.

Per-entry fields:
- `workerId` ✓ (provenance preserved per entry)
- `path` ✓
- `content` ✓ (inlined because all files are < 64KB)
- `verified: false` for ALL entries (verification never ran)
- `bytes` ✓

Per-entry missing fields:
- `contentHash` — no integrity fingerprint
- `conflict` — no flag for paths with multiple distinct hashes
- `conflictVersions` — no list of the other versions

## Root cause analysis

The G7-18E failure has **three independent defects**, each sufficient
to produce the observed FAILED-with-correct-repair paradox. They are
listed in order of how directly each produced the FAILED status.

### Defect A — `listArtifacts` does not recurse into subdirectories

**Location:** `src/runtime/openbot/adapter.ts` lines 214–294
(`listArtifacts`) and 308–344 (`listArtifactsFromDisk`).

**Mechanism:** Both functions use `readdir(workspaceDir, { withFileTypes: true })`
and then iterate entries with `if (!entry.isFile()) continue;`. This
skips every directory entry. Files inside `public/`, `test/`, and
any other subdirectory are silently dropped.

**Evidence:** `software-engineer-1`'s workspace contains 9 files
across 4 directories (`./`, `public/`, `test/`, and would-be-subdirs
of any nested layout). The artifacts-response returns only 3 entries
for `software-engineer-1` — the 3 top-level files
(`README.md`, `package.json`, `server.js`). The other 6 files
(including the actually-repaired `test/api.test.js` at hash
`c432e545...`) are silently dropped.

This defect ALONE would not have changed the mission `status` (the
mission timed out before verification), but it makes the
post-mission application-repair evidence invisible to the gateway.

### Defect B — `collectArtifacts` trusts worker self-report; the orchestrator's `hasDeliverable` is computed from `result.artifacts`

**Location:** `src/mission/orchestrator.ts` lines 910–925
(`collectArtifacts`) and 807–822 (`finalArtifacts`, `hasDeliverable`,
`status` decision).

**Mechanism:**
1. `collectArtifacts(participants, results)` iterates `results` and
   uses `result.artifacts` (the worker's self-reported artifact paths
   from its `finish()` call) as the source of truth.
2. When a worker fails before calling `finish()` (or calls `finish()`
   with an empty artifact list), `result.artifacts` is `[]` and
   `collectArtifacts` skips that worker.
3. `finalArtifacts = collectArtifacts(participants, results)` therefore
   returns an empty array when all workers failed to self-report.
4. `hasDeliverable = finalArtifacts.length > 0 || observedDeliverables.length > 0`
   evaluates to `false`.
5. At line 820: `if (aborted) { status = hasDeliverable ? 'partial' : 'failure'; }`
   → status=`'failure'`.

**Evidence:** All 3 workers had `worker-finished` events with
`status=failure` (failureClass PROVIDER_FAILURE or CANCELLED). None
of them reached a clean `finish()` call with an artifact list. So
`results[].artifacts` was empty for all 3, `collectArtifacts`
returned `[]`, `hasDeliverable` was `false`, and the mission was
marked `failure` instead of `partial`.

The mission-snapshot's `result.summary` confirms this:
`"mission aborted (timeout or cancellation) before completion"`
(line 822 fallback summary).

The disk state, however, shows that all 3 workers DID produce files.
`software-engineer-1` wrote a complete and correct 9-file repair.
The orchestrator's `hasDeliverable` decision is based on worker
self-report, not disk state.

### Defect C — `getArtifacts()` returns per-worker entries without conflict detection

**Location:** `src/gateway/mission-service.ts` lines 1224–1298
(`getArtifacts`).

**Mechanism:** `getArtifacts` returns one `MissionArtifactRecord` per
(workerId, path) pair. When 3 workers each write to the same path with
different content, the response contains 3 entries with the same
`path` field. The caller (an HTTP client) sees:

```
[
  { workerId: "documentation-writer-2", path: "README.md", bytes: 1694, verified: false },
  { workerId: "generalist-worker-3",    path: "README.md", bytes: 3253, verified: false },
  { workerId: "software-engineer-1",    path: "README.md", bytes: 3253, verified: false }
]
```

No `conflict: true` flag, no `contentHash` to compare versions, no
`conflictVersions` array. The caller has to manually diff the
content of every duplicate-path entry to detect that
`documentation-writer-2`'s README differs from the other two.

**Evidence:** The artifacts-response has 9 entries (3 paths × 3
workers). The 3 `README.md` entries have different `bytes` (1694 vs
3253 vs 3253), strongly hinting at different content, but the
response gives the caller no signal that this is a conflict.

### Defect D (downstream of A+B) — verification never runs against `software-engineer-1`'s output

**Location:** `src/mission/orchestrator.ts` lines 614–805.

**Mechanism:** Verification is gated on `if (!aborted || artifactSources.length > 0)`.
With `aborted=true` (timeout) and `artifactSources=[]` (because
`collectArtifacts` returned empty), the verification block is
skipped entirely. `verification` stays `undefined`. The mission
closure decision at line 823 (`else if (verification === undefined || verification.ok)`)
treats undefined as "no verification needed", but the `aborted` branch
at line 820 takes precedence and sets `status='failure'`.

**Evidence:** The mission snapshot's `result.evidence` is `[]` —
verification produced no outcomes. The closure summary is the
generic "mission aborted" string, not a verification summary.

This defect is downstream of B: if `collectArtifacts` had returned
the disk-discovered artifacts, `artifactSources` would have been
non-empty, the verification block would have run (because the
`|| artifactSources.length > 0` clause would have been true even
with `aborted=true`), and the mission might have reached `partial`
with a real verification summary.

### Defect E (downstream of A) — user-supplied `file` checks with bare paths cannot find artifacts

**Location:** `src/mission/verification.ts` lines 378–410 (`checkFile`)
and 180 (`cleanRoomPath`).

**Mechanism:** The verifier copies each artifact to
`artifacts/<workerId>/<path>` via `cleanRoomPath(source, path)`. But
`checkFile` reads from `check.path` (the bare path the user supplied,
e.g. `README.md` — not `artifacts/<workerId>/README.md`). The file is
never at the bare path, so the check fails.

**Evidence:** The G7-18E acceptance criteria supplied 9 `file` checks
with bare paths (`{ kind: 'file', label: 'README.md exists', path: 'README.md' }`,
etc.). These would have ALL failed verification even if verification
had run, because no file exists at the bare `README.md` path in the
verifier's clean room — the file is at
`artifacts/software-engineer-1/README.md`.

This defect is downstream of A and orthogonal to B. Fixing A alone
would not fix E. The user-supplied check convention is structurally
incompatible with the verifier's clean-room layout.

The default `deriveChecks` function (line 696) generates checks with
`path: cleanRoomPath(source, path)` (the prefixed form), so derived
checks work. But user-supplied checks use bare paths and would fail.

## Closure-decision trace (G7-18E specific)

For mission `4422008a-c495-4a88-836e-7df84752e448`:

1. Mission started at 02:54:15.659Z.
2. Mission timeout was 420,000 ms (per `GENESIS_DEFAULT_MISSION_TIMEOUT_MS`).
3. Specialists ran sequentially: software-engineer-1 (failure after
   ~7 minutes of incommunicado reasoning), documentation-writer-2 (6
   steps, then failure), generalist-worker-3 (6 steps, then failure).
4. None of the 3 specialists called `finish()` cleanly with an
   artifact list. `results[workerId].artifacts = []` for all 3.
5. The coordinator (`mission-coordinator-1`) was supposed to run
   after the specialists (line 575), but `controller.signal.aborted`
   became true before the coordinator started — so the coordinator
   block was skipped.
6. `finalArtifacts = collectArtifacts(participants, results)` returned
   `[]` because all 3 workers had empty `result.artifacts`.
7. `observedDeliverables = collectObservedDeliverables(ensured)`
   returned `[]` because the workers had no workspace/job surfaces
   with non-computer deliverables.
8. `hasDeliverable = false`.
9. `aborted = true`.
10. `verification` was never run because the guard
    `if (!aborted || artifactSources.length > 0)` was false
    (`aborted=true` AND `artifactSources.length=0`).
11. Closure: `if (aborted) { status = hasDeliverable ? 'partial' : 'failure'; }`
    → `status='failure'`.
12. `summary = 'mission aborted (timeout or cancellation) before completion'`.
13. `result.evidence = []`.

If Defect B were fixed (so that `collectArtifacts` fell back to
disk-discovered artifacts), step 6 would have returned a non-empty
array, step 8 would have been `hasDeliverable=true`, step 9's
verification guard would have been satisfied (`artifactSources.length > 0`),
verification would have run, and the closure at step 11 would have
produced `status='partial'` (because `aborted=true` + `hasDeliverable=true`
→ `partial`).

## Provenance preservation audit

| Property                                       | Preserved? | Notes                                                                |
|------------------------------------------------|------------|----------------------------------------------------------------------|
| Per-entry workerId                              | YES        | `MissionArtifactRecord.workerId` is set on every entry.             |
| Per-entry path                                  | YES        | `MissionArtifactRecord.path` is set on every entry.                  |
| Per-entry bytes                                 | YES        | `MissionArtifactRecord.bytes` is set on every entry.                |
| Per-entry content (when small)                   | YES        | `MissionArtifactRecord.content` is inlined for files ≤ 64KB.         |
| Per-entry contentHash                           | NO         | Not in the response. Caller must compute their own hash to compare.  |
| Per-entry conflict flag                         | NO         | Not in the response. Caller must dedupe-and-diff manually.           |
| Per-path conflict versions                      | NO         | Not in the response. Caller has to group by path themselves.         |
| Per-entry verified flag                         | YES (always false here) | `verified = verificationOk && verifiedPaths.has(path)`. Since verification never ran, `verificationOk` is `false` and `verified` is `false` for every entry. |
| Mission-level status (success/partial/failure)  | YES        | `status=FAILED` (the orchestrator-level decision).                  |
| Mission-level summary                           | YES        | Generic abort string.                                                |
| Mission-level evidence                          | YES (empty) | `result.evidence = []` because verification didn't run.              |
| Mission-level cost (tokens, wallMs)             | YES        | `tokens=203057`, `wallMs=420001`.                                   |

## Worker-vs-application-vs-mission success distinction

The G7-18E evidence reveals three distinct success notions that the
current codebase conflates:

1. **Worker success** — did a worker's `run()` produce `status='success'`?
   In G7-18E: NO for all 3 specialists (all failure). NO for the
   coordinator (didn't run).
2. **Application acceptance** — does the produced application satisfy
   the documented behavior? In G7-18E: YES, independently verified in
   Phase 3 (22/22 tests pass, browser acceptance, persistence, etc.).
3. **Mission success** — did the orchestrator+verifier pipeline mark
   the mission as SUCCEEDED? In G7-18E: NO (FAILED).

The gap between (2) and (3) is the paradox this mission must close.
The closure decision in `src/mission/orchestrator.ts` lines 818–842
treats (1) as a proxy for (2) AND (3). When workers fail to
self-report, (1) is false, so (3) is `failure` even though (2) might
be true (as it was in G7-18E).

## Required behavior for the Phase 2 fix

Based on the evidence above, the Phase 2 fix must:

1. **Recursively scan worker workspaces** in `listArtifacts` and
   `listArtifactsFromDisk` so files in subdirectories are no longer
   silently dropped. (Defect A)
2. **Add a disk-state fallback to `collectArtifacts`** so workers that
   wrote files to disk but failed to self-report are still counted
   toward `hasDeliverable`. This requires modifying the orchestrator,
   which is in the frozen-contracts list. The minimum-scoped
   alternative is to add a post-mission aggregation pass at the
   gateway layer (in `mission-service.ts`) that computes
   `hasDeliverable` from `runtime.listArtifacts()` AFTER the
   orchestrator returns, and exposes it via the snapshot/events API
   without modifying the frozen `MissionResult` type. (Defect B)
3. **Detect conflicts deterministically** when multiple workers wrote
   the same path with different content. Surface this via
   `MissionArtifactRecord.conflict` and `MissionArtifactRecord.conflictVersions`
   fields (transport type, not frozen). (Defect C)
4. **Run verification against the disk-discovered artifacts when the
   orchestrator's self-report-based artifactSources is empty**. This is
   the more invasive fix; the minimum-scoped alternative is to
   document that verification is gated on worker self-report and to
   expose the disk-state fallback as a separate "post-mission
   evidence" path. (Defect D)
5. **Document the bare-path-vs-prefixed-path convention for user-supplied
   `file` checks**. The current `checkFile` reads the bare `check.path`;
   user-supplied checks must use the prefixed
   `artifacts/<workerId>/<path>` form (matching what `deriveChecks`
   produces automatically). (Defect E)

## Scope constraint: frozen contracts

Per the G7-18D and G7-18E briefs, the following files are frozen:
- `src/contracts/core.ts`
- `src/mission/verification.ts`
- `src/mission/orchestrator.ts`
- `src/goal/goal-compiler.ts`

The G7-19A brief says "Preserve backward compatibility and existing
frozen contracts." The minimum-scoped fix must NOT modify any of
these four files.

Files that CAN be modified:
- `src/runtime/openbot/adapter.ts` (Defect A fix)
- `src/runtime/memory-computer.ts` (test-path parity for Defect A fix)
- `src/gateway/mission-service.ts` (Defect C fix + B/D gateway-layer fallback)
- `src/gateway/types.ts` (extend `MissionArtifactRecord` with optional
  `contentHash`/`conflict`/`conflictVersions` — transport type, not frozen)
- `src/runtime/computer.ts` (extend `ArtifactSnapshot` with optional
  `contentHash` — interface, not frozen; backward-compatible because
  the field is optional)

## Summary of root causes

| # | Defect                                                                  | Frozen file? | Smallest fix file                       | Independent of others? |
|---|-------------------------------------------------------------------------|--------------|------------------------------------------|--------------------------|
| A | `listArtifacts` doesn't recurse into subdirectories                    | NO           | `src/runtime/openbot/adapter.ts`         | YES                      |
| B | `collectArtifacts` trusts worker self-report, not disk state            | YES (orchestrator) | `src/gateway/mission-service.ts` (gateway-layer fallback) | NO (depends on A)        |
| C | `getArtifacts` returns per-worker entries without conflict detection    | NO           | `src/gateway/mission-service.ts` + `src/gateway/types.ts` | YES                      |
| D | Verification skipped when `artifactSources` empty even if disk has files | YES (orchestrator + verification) | `src/gateway/mission-service.ts` (gateway-layer evidence) | NO (depends on A, B)     |
| E | User-supplied `file` checks with bare paths cannot find prefixed artifacts | YES (verification) | Documentation only (cannot change `checkFile`) | YES                      |

The Phase 2 minimal fix addresses A, C, and the gateway-layer
fallback for B/D. Defect E is documented but cannot be fixed without
modifying `verification.ts` (frozen).
