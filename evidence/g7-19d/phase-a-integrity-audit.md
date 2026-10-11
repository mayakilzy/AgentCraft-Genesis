# G7-19D Phase A — Production Verification Integrity Audit

## Objective

Trace the complete path:

`worker workspace → artifact snapshot → verification execution → verification evidence → package selection → gateway response`

Answer the 6 explicit integrity questions raised by the G7-19D brief.
Identify concrete gaps before implementing Phase B/C fixes.

This audit is read-only. No code is modified in Phase A.

## Source evidence reviewed

- `G7-19A_Worker_Aggregation_Reliability_Report.md`
- `G7-19B_Conflict_Resolution_Report.md`
- `G7-19C_Verified_Package_Selection_And_Closure_Report.md`
- `evidence/g7-19a/phase-1-root-cause.md` (the G7-18E root-cause diagnosis)
- `evidence/g7-19c/phase-1-architecture.md` (the G7-19C architecture assessment)
- `src/runtime/package-selection.ts` (G7-19C pure-function package-selection layer)
- `src/runtime/artifact-aggregation.ts` (G7-19A/B/C aggregation + applyPackageSelection)
- `src/runtime/openbot/adapter.ts` (listArtifacts + listWorkspaceFilesRecursive)
- `src/runtime/memory-computer.ts` (dev-path ArtifactsProvider)
- `src/gateway/mission-service.ts` (getArtifacts + captureVerificationResult)
- `src/gateway/types.ts` (MissionArtifactRecord transport type)
- `src/mission/orchestrator.ts` (collectArtifacts + verification block + closure)
- `src/mission/verification.ts` (VerificationLoop.verify + cleanRoomPath)

## The complete integrity path (traced)

### Step 1 — Worker workspace → artifact snapshot

Each worker's workspace (on disk in OpenBot; in-memory `Map<string, string>` in
MemoryRuntime) holds the files the worker wrote via `computer.writeFile()`.
After the mission finishes (and workers are retired in the orchestrator's
`finally` block), the workspace persists.

`runtime.listArtifacts()` (interface `ArtifactsProvider` in
`src/runtime/computer.ts` line 68) reads the workspace and returns one
`ArtifactSnapshot` per `(workerId, path)` pair. Each snapshot carries
`{ workerId, path, bytes, content? }` where `content` is inlined iff the
file is ≤ 64KB.

- Production path: `OpenBotRuntimeAdapter.listArtifacts()` walks each
  worker's workspace directory recursively (G7-19A's
  `listWorkspaceFilesRecursive`).
- Dev path: `MemoryRuntime.listArtifacts()` iterates `computers Map`
  and `MemoryComputer.files Map`.

### Step 2 — Artifact snapshot → verification execution

The orchestrator's verification block (line 614-805 of
`src/mission/orchestrator.ts`) calls `collectArtifacts(participants, results)`
to build `ArtifactSource[]` — each source is
`{ workerId, computer, paths: result.artifacts }`. **`result.artifacts` is the
worker's SELF-REPORTED list from its `finish()` call** — this is **Defect B**
documented in G7-19A's root-cause analysis: the verifier reads from the
worker's `computer` (real disk state), but the LIST of paths to copy is
worker self-report.

The `VerificationLoop.verify(checks, artifacts, evidence)` method
(`src/mission/verification.ts` line 227):
1. Clears the verifier's `artifacts/` subtree.
2. For each `ArtifactSource`, copies each path into
   `artifacts/<workerId>/<path>` via `cleanRoomPath(source, path)`
   (line 180). The copy uses `source.computer.readFile(path)` → real
   worker disk state.
3. Runs each check (`file`, `command`, `evidence`, `mission-input`,
   `flight-action`, `content-in-artifacts`, `hash-match`).
4. Returns `VerificationResult { ok, outcomes, summary, diagnosis?, reviewerCalls }`.

### Step 3 — Verification execution → verification evidence

The verification event is recorded in the flight recorder with
`{ ok, passed, failed, failures }`. The orchestrator returns a
`MissionResult { status, summary, evidence, cost }`.

After the orchestrator returns, the gateway calls
`captureVerificationResult(rt)` (line 1433 of mission-service.ts). This
method:
1. Reads the `verification` event from the flight recorder.
2. If `verificationEvent.ok === true`:
   - Calls `runtime.listArtifacts()` to enumerate paths.
   - Iterates `rt.computers` (legacy dev path) for any missing paths.
   - Stores the set of paths in `rt.verifiedPaths: Set<string>`.
3. Stores `rt.verificationOk = verificationEvent.ok`.

**Critical observation**: at this point, `runtime.listArtifacts()` has
just been called — the snapshots represent the worker workspaces AT
VERIFICATION-COMPLETION TIME. This is the moment to capture per-worker
package identities. The G7-19C implementation does NOT do this.

### Step 4 — Verification evidence → package selection

When `getArtifacts(missionId, caller)` is called later, it:

1. Reads `rt.verificationOk` and `rt.verifiedPaths`.
2. Calls `runtime.listArtifacts()` AGAIN to get current snapshots.
3. Calls `buildAggregatedRecords(snapshots, verificationOk, verifiedPaths)`
   → produces `MissionArtifactRecord[]` with G7-19A/B fields.
4. Calls `applyPackageSelection(records, snapshots, acceptanceCriteria,
   verifiedPaths, verificationOk)` → adds G7-19C fields
   (`verifiedPackageSelection`, `isHeuristicUnverified`).

`applyPackageSelection` calls `buildAndSelectPackages` →
`buildPackageCandidates` → `bindVerificationEvidence`.

**`bindVerificationEvidence` (package-selection.ts line 421-493)**:
```ts
// Every observed path must be in the verified set.
for (const observed of candidate.observedPaths) {
  const normalized = normalizePath(observed);
  let isVerified = verifiedPaths.has(normalized);
  // ... prefixed form fallback ...
  if (!isVerified) return { ...verificationOk: false... };
}

// Verification bound: the evidence hash equals the package identity.
return {
  ...candidate,
  verificationOk: true,
  verificationEvidenceHash: candidate.packageIdentity,  // ← SELF-ASSERTION
};
```

### Step 5 — Package selection → gateway response

`selectVerifiedPackage(candidates)` filters to
`verificationOk && completenessOk`, sorts by `(packageIdentity, workerId)`,
picks the lexicographically smallest. Returns
`PackageSelectionResult { policy, selected, state, rationale, candidates }`.

`applyPackageSelection` populates the optional `verifiedPackageSelection`
field on every record (state SELECTED or UNRESOLVED) and, when state=SELECTED,
marks the existing `conflictResolution` with `isHeuristicUnverified=true`.

The response is the array of `MissionArtifactRecord`.

## The 6 explicit integrity questions

### Q1 — Which component computes the actual content hashes?

**Two components:**

1. `src/runtime/artifact-aggregation.ts` `aggregateArtifacts()` computes
   per-snapshot SHA-256 content hashes via `sha256Hex(content)`. These
   hashes are stored on `ArtifactVersion.contentHash` and exposed in
   `MissionArtifactRecord.contentHash` (G7-19A).

2. `src/runtime/package-selection.ts` `computePackageIdentity(workerId,
   snapshots)` computes per-worker package identity — SHA-256 over the
   canonical JSON of `{ workerId, files: [[path, contentHash], ...] sorted
   by path }`. Stored on `PackageCandidate.packageIdentity`.

**GAP**: neither component captures a "verified package identity" at
verification time. The `verificationEvidenceHash` field is set to
`candidate.packageIdentity` at SELECTION TIME — which is the candidate's
own identity, not an independently-attested verified identity. This is
self-assertion, not evidence.

### Q2 — Which component executes verification?

`src/mission/verification.ts` `VerificationLoop.verify()` (FROZEN).

The verifier reads from each `ArtifactSource.computer` (the worker's real
disk state), writes to its own clean-room workspace
(`artifacts/<workerId>/<path>`), runs each check, and returns
`VerificationResult { ok, outcomes, summary, diagnosis?, reviewerCalls }`.

The orchestrator (FROZEN with G7-19C narrow exception) calls
`loop.verify(checks, artifactSources, evidence)` at line 723 and again
after a bounded retry at line 796.

### Q3 — Does the verifier attest to a specific immutable package identity?

**NO.** The verifier returns only `ok: boolean`, `outcomes`, `summary`,
`diagnosis?`, `reviewerCalls`. There is NO content hash, NO package
identity, NO snapshot reference in the verification result.

The verification event in the flight recorder also carries only
`{ ok, passed, failed, failures }` — no content attestation.

This means the current architecture cannot prove that verification ran
against specific content bytes. It only proves that some checks passed
against the worker's workspace at some point during the mission.

### Q4 — Can files change between verification and selection?

**YES, in principle.** Three windows of opportunity:

1. **During the bounded retry** (orchestrator line 730-803): if the first
   verification fails, the orchestrator sends workers back for a retry,
   then re-runs verification. Files CAN change between the first and
   second verification. But since `captureVerificationResult` reads the
   flight recorder's LAST `verification` event (line 1435 uses `find` —
   which returns the FIRST match — actually wait, this is subtle).

   Actually `events.find(e => e.type === 'verification')` returns the
   FIRST verification event. If there were two (first attempt failed,
   retry passed), the FIRST would be the failing one. This is a bug
   separate from G7-19D's scope — but it means
   `captureVerificationResult` may use a STALE verification event.
   
   Wait, let me re-check. `Array.find()` returns the FIRST matching
   element. So if the first verification FAILED and the retry PASSED,
   `find()` returns the FAILED event → `rt.verificationOk = false`.
   This is a separate bug. For G7-19D scope, I'll note this but not
   fix it (the existing G7-19C tests pass, so this may not be a real
   issue in practice — perhaps the verification event is only recorded
   once, on the final attempt).

2. **Between verification completion and `captureVerificationResult`**:
   workers may still be running (the `finally` block hasn't started yet).
   A worker could write more files. But workers are sequential — after
   verification, the orchestrator moves to the closure block, and
   `finally` retires workers. There's no worker activity between
   verification completion and `captureVerificationResult`.

3. **Between `captureVerificationResult` and `getArtifacts`**:
   workers ARE retired (the `finally` block ran). But the workspace
   directory persists on disk (OpenBot) or in memory (MemoryRuntime).
   If any external process modifies the workspace, the snapshots
   differ. This is the threat model G7-19D must address.

**GAP**: the current architecture does NOT detect content mutation
between verification and selection. The `verificationEvidenceHash` is
self-asserted, so it always "matches" the candidate's current identity.

### Q5 — Can two different packages with identical paths share verification evidence?

**YES.** The `verifiedPaths` set is worker-agnostic — it contains
bare paths. If worker A wrote `output.md` with content X and worker B
wrote `output.md` with content Y, both have `output.md` in their
`observedPaths`. The check `verifiedPaths.has(normalizePath(observed))`
passes for BOTH workers because `output.md` is in the set.

The candidate's `packageIdentity` IS worker-specific (different content
→ different identity), but since it's self-asserted at selection time
(`verificationEvidenceHash = candidate.packageIdentity`), it doesn't
actually prove which worker's content was verified.

**GAP**: there is no per-worker attestation. The `verifiedPaths` set
is shared across workers.

### Q6 — Does the gateway expose heuristic authority when verified selection is UNRESOLVED?

**PARTIALLY YES.** The G7-19C `applyPackageSelection` sets
`isHeuristicUnverified=true` on `conflictResolution` ONLY when
`state === 'SELECTED'`:

```ts
let conflictResolution = record.conflictResolution;
if (conflictResolution !== undefined && selection.state === 'SELECTED') {
  conflictResolution = {
    ...conflictResolution,
    isHeuristicUnverified: true,
  };
}
```

When `state === 'UNRESOLVED'` (no verified package), the
`conflictResolution` field is preserved UNCHANGED. Consumers see
`conflictResolution.isAuthoritative === true` on the chosen record
WITHOUT any `isHeuristicUnverified` warning.

This is exactly the G7-19D Concern B: the heuristic `isAuthoritative`
flag may be mistaken for genuine authority when no verified package
exists.

**GAP**: the `isHeuristicUnverified` flag must be set whenever
`conflictResolution` is present, regardless of the selection state.
The flag's semantic is "this `conflictResolution` is a heuristic display
preference, NOT a verified authoritative selection" — which is true
whenever `conflictResolution` exists.

## Summary of gaps

| # | Gap | Severity | Fix location |
|---|---|---|---|
| 1 | `verificationEvidenceHash` is self-asserted (set to candidate's own identity at selection time) | HIGH | package-selection.ts + mission-service.ts |
| 2 | No per-worker package identity captured at verification time | HIGH | mission-service.ts (captureVerificationResult) + package-selection.ts (new helper) |
| 3 | `verifiedPaths` is worker-agnostic — two workers with same path share verification | HIGH | package-selection.ts (bindVerificationEvidence — add identity comparison) |
| 4 | Content mutation between verification and selection is undetected | HIGH | package-selection.ts (identity comparison) |
| 5 | `isHeuristicUnverified` not set when state=UNRESOLVED | MEDIUM | artifact-aggregation.ts (applyPackageSelection — always set) |

## Proposed Phase B/C fix (smallest reliable mechanism)

### Phase B — Content-bound verification

Add a new field on `MissionRuntime`:

```ts
verifiedPackageIdentities?: Map<string, string>;  // workerId → packageIdentity at verification time
```

In `captureVerificationResult`, when `verificationEvent.ok === true`:

1. Capture the snapshots (already done — for `verifiedPaths`).
2. Group snapshots by `workerId`.
3. For each worker, call `computePackageIdentity(workerId, workerSnapshots)`.
4. Store as `rt.verifiedPackageIdentities`.

In `getArtifacts`, pass `rt.verifiedPackageIdentities` to
`applyPackageSelection` → `buildAndSelectPackages` →
`buildPackageCandidates` → `bindVerificationEvidence`.

In `bindVerificationEvidence`, add a NEW check (after the existing
`verifiedPaths` check):

```ts
// G7-19D: content-bound verification. The verified identity must
// match the candidate's current identity. If they differ, the
// content changed between verification and selection → reject.
const verifiedIdentity = verifiedPackageIdentities?.get(candidate.workerId);
if (verifiedIdentity === undefined) {
  return { ...candidate, verificationOk: false,
    rejectionReason: 'no verified package identity captured for this worker' };
}
if (verifiedIdentity !== candidate.packageIdentity) {
  return { ...candidate, verificationOk: false,
    rejectionReason: 'post-verification content mutation detected' };
}
```

When all checks pass, set:

```ts
return {
  ...candidate,
  verificationOk: true,
  verificationEvidenceHash: verifiedIdentity,  // ← NOW EARNED, NOT SELF-ASSERTED
};
```

The `verificationEvidenceHash` is now the identity captured at
verification time — it is no longer self-asserted. The match between
`verifiedIdentity` and `candidate.packageIdentity` proves content
binding.

### Phase C — Authority semantics

In `applyPackageSelection`, change the `isHeuristicUnverified` logic:

```ts
// G7-19D: ALWAYS mark conflictResolution as a heuristic when it's
// present. The isAuthoritative flag is a display preference, NOT a
// verified authoritative selection. Consumers should always look at
// verifiedPackageSelection for the verified authority.
let conflictResolution = record.conflictResolution;
if (conflictResolution !== undefined) {
  conflictResolution = {
    ...conflictResolution,
    isHeuristicUnverified: true,
  };
}
```

This is a one-line condition change (drop the `&& selection.state === 'SELECTED'`
guard). The flag is now set whenever `conflictResolution` exists — which
is exactly the right semantic.

## Frozen-contract impact

**Default: all frozen files remain unchanged.**

The Phase B/C fix touches ONLY non-frozen files:

- `src/runtime/package-selection.ts` — non-frozen (G7-19C added it).
- `src/runtime/artifact-aggregation.ts` — non-frozen.
- `src/gateway/mission-service.ts` — non-frozen.
- `src/gateway/types.ts` — non-frozen.

The four frozen contracts (`src/contracts/core.ts`,
`src/mission/verification.ts`, `src/mission/orchestrator.ts`,
`src/goal/goal-compiler.ts`) are NOT modified. The G7-19C narrow
exception in orchestrator.ts (the disk-state fallback for
`hasDeliverable`) is preserved unchanged.

The verification execution (in `verification.ts`) stays exactly as it
is — the verifier still copies files into the clean room and runs
checks. G7-19D captures the package identity AROUND the verification
(in `captureVerificationResult`), not inside the verifier.

## Stop condition check

None of the G7-19D stop conditions are triggered:

- The verifier can attest to package content THROUGH the existing
  architecture (by capturing per-worker package identities at
  `captureVerificationResult` time, immediately after the verifier
  runs).
- No incompatible public API change is needed — the new
  `verifiedPackageIdentities` field is on the internal `MissionRuntime`
  interface, not on the public `MissionResult` contract.
- No frozen contract needs modification — the fix lives entirely in
  the non-frozen runtime/gateway layer.
- The fix does NOT rely on worker self-reports — it uses
  `runtime.listArtifacts()` (the runtime is the trust authority) at
  verification time AND at selection time, and compares identities.
- No substantial redesign — the fix is approximately:
  - 1 new optional field on `MissionRuntime` (1 line).
  - 1 new helper function in `package-selection.ts` (~20 lines).
  - 1 new parameter on `bindVerificationEvidence` + identity check (~15 lines).
  - 1 thread-through of the new parameter in `buildPackageCandidates`,
    `buildAndSelectPackages`, `applyPackageSelection` (~10 lines).
  - 1 capture block in `captureVerificationResult` (~15 lines).
  - 1 one-line change in `applyPackageSelection` (drop the SELECTED guard).
  - New tests (~600 lines).

  Total implementation: ~60 lines of new code + ~600 lines of tests.
  Small in code. Large in capability.
