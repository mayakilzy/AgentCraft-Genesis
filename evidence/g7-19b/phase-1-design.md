# G7-19B Phase 1 — Evidence and Conflict Resolution Design

## Objective

Continue from G7-19A by designing a deterministic conflict
resolution policy. The G7-19A fix DETECTED conflicts (added
`contentHash`, `conflict`, `conflictVersions` fields); G7-19B
RESOLVES them — picks an authoritative version when multiple
workers wrote different content to the same path.

The policy must be:
- **Deterministic** — same inputs always produce the same output.
- **Transparent** — the policy is explicit and documented in
  the response.
- **Provenance-preserving** — all conflicting versions remain in
  the audit trail.
- **Not random** — no `Math.random()` or hash-based lottery.
- **No external dependencies** — no LLM call to "pick the best
  version".

## Source evidence reviewed

- `G7-19A_Worker_Aggregation_Reliability_Report.md` — full G7-19A closure report
- `evidence/g7-19a/phase-1-root-cause.md` — root-cause diagnosis of G7-18E
- `src/runtime/artifact-aggregation.ts` — current pure-function module
- `src/gateway/types.ts` — `MissionArtifactRecord` transport type
- `src/gateway/mission-service.ts` — `getArtifacts()` flow
- `tests/runtime/g7-19a-aggregation.test.ts` — G7-19A test suite (13 tests)

## Current conflict detection behavior (post-G7-19A)

The `aggregateArtifacts(snapshots)` function in
`src/runtime/artifact-aggregation.ts`:

1. Groups snapshots by path.
2. For each path, computes a SHA-256 per inlined entry.
3. Flags `conflict=true` when at least two versions have different
   `contentHash` values (for inlined files) OR different `bytes`
   values (for non-inlined files).
4. Returns `PathAggregation[]` with per-path versions and conflict
   flag.

The `buildAggregatedRecords(snapshots, verificationOk, verifiedPaths)`
function builds the gateway's `MissionArtifactRecord[]` with:

- `contentHash` populated for inlined entries.
- `conflict=true` on every record for a conflicting path.
- `conflictVersions` listing the OTHER workers' versions.

What G7-19A does NOT do: it does not PICK an authoritative version.
The caller (HTTP client) sees N entries for the same path with
different `contentHash` and has to manually decide which to use.

## The actual G7-18E conflict matrix

From `evidence/g7-19a/phase-1-root-cause.md`:

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

**Three conflicts total:**
- `README.md` and `package.json`: 2+1 split (majority = baseline).
- `test/api.test.js`: 3-way split (no majority, all disagree).

**The correct version for `test/api.test.js`** (per Phase 3
acceptance of G7-18E): `software-engineer-1`'s version (hash
`c432e545...`, 15795 bytes) was the only one that produced
22/22 passing tests. The other two versions failed.

This is the central tension: **the system cannot know which
version is "correct" without running verification**. The policy
must therefore be transparent about its limitations and preserve
all versions for downstream inspection.

## Design constraints

1. **No LLM call** — the policy must not invoke a reasoning provider
   to "pick the best version". This rules out any approach that
   requires semantic understanding of the content.

2. **No timestamps** — the `ArtifactSnapshot` type does not carry
   write timestamps. We cannot implement "first writer wins" or
   "last writer wins" without adding timestamp tracking (which would
   require modifying the frozen `MissionResult` contract or the
   runtime adapter).

3. **No tier information** — the snapshot does not carry the
   worker's reasoning tier (cheap/default/frontier). We cannot
   prefer "the higher-tier worker" without adding tier to the
   snapshot.

4. **No content semantics** — the policy cannot read the file
   content and decide "this version looks more correct". That
   would be an LLM call in disguise.

5. **Deterministic** — the same input must always produce the same
   output. This rules out `Math.random()` and any approach that
   depends on iteration order of an unordered data structure
   (the snapshot array is the input; we must sort it before
   making decisions).

6. **Transparent** — the policy must be documented in the response
   so a downstream human can understand WHY this version was
   chosen and inspect the alternatives.

7. **Provenance-preserving** — all conflicting versions MUST remain
   in the response. The policy picks ONE as authoritative but
   does NOT delete or hide the others.

## Chosen policy: "majority-then-lexicographic"

The policy is a two-tier deterministic rule:

### Tier 1 — Majority/plurality vote

Group all versions of a conflicting path by `contentHash`. Find
the hash with the maximum count (plurality).

- If there is a **unique** hash with the maximum count AND that
  count is **≥ 2** (i.e., at least 2 workers agree), pick that
  hash as the winning hash.
- The chosen workerId is the **lexicographically smallest** workerId
  among the versions with the winning hash. (Determinism: same input
  always produces the same workerId.)
- Rationale string: `"majority vote (N of M versions agree on hash H…)"`.

This handles the G7-18E `README.md` and `package.json` cases: 2 of 3
workers agree on the baseline hash, so the baseline wins.

### Tier 2 — Lexicographic fallback (no majority)

If Tier 1 fails to find a unique winner with ≥2 votes (i.e., all
versions disagree, or there's a tie in vote counts):

- The chosen version is the one with the **lexicographically smallest
  workerId** among ALL versions.
- Rationale string: `"no majority (N distinct versions); tiebreak
  by lexicographic workerId"`.

This handles the G7-18E `test/api.test.js` case (3-way conflict):
no majority, fall back to lexicographic. The smallest workerId is
`documentation-writer-2` (alphabetically before
`generalist-worker-3` and `software-engineer-1`).

**Known limitation**: this fallback is arbitrary — it may NOT pick
the "correct" version. In G7-18E, it would pick
`documentation-writer-2`'s version of `test/api.test.js`, but the
CORRECT version was `software-engineer-1`'s. The policy is
transparent about this limitation in the rationale string and
preserves all 3 versions in `conflictVersions` so a downstream
human (or verification step) can override.

### Tier 0 — No conflict

If there is only one version (single worker) or all versions have
the same hash (unanimous agreement), there is no conflict and no
resolution. The `conflictResolution` field is omitted.

### Policy name

The policy name is `"majority-then-lexicographic"`. This name
appears in the `conflictResolution.policy` field so downstream
clients can identify which policy was applied.

## Field shape: `conflictResolution`

Add an OPTIONAL `conflictResolution` field to
`MissionArtifactRecord` (transport type — not frozen):

```typescript
readonly conflictResolution?: {
  /** Policy name (e.g., "majority-then-lexicographic"). */
  readonly policy: string;
  /** WorkerId of the chosen authoritative version. */
  readonly authoritativeWorkerId: string;
  /** ContentHash of the chosen authoritative version. */
  readonly authoritativeContentHash: string;
  /** Human-readable explanation of why this version was chosen. */
  readonly rationale: string;
  /** True on the chosen record; false on the other records for the same path. */
  readonly isAuthoritative: boolean;
};
```

When `conflict=true` on a record, `conflictResolution` is populated:

- The chosen record gets `isAuthoritative: true`.
- The other records for the same path get `isAuthoritative: false`
  (with the same `authoritativeWorkerId` so the caller can see
  which version was chosen).

When `conflict=false` (or no conflict), `conflictResolution` is
omitted entirely.

## Algorithm (pseudocode)

```
function resolveConflict(versions: ArtifactVersion[]): ConflictResolution {
  // versions is sorted by workerId (caller's responsibility)
  
  // 1. Group by contentHash
  byHash = Map<contentHash, ArtifactVersion[]>
  for v in versions:
    byHash.get(v.contentHash).push(v)  // or create new list
  
  // 2. Find the hash with the maximum count
  maxCount = 0
  winningHash = ''
  isTie = false
  for (hash, list) in byHash:  // iteration order doesn't affect outcome
    if list.length > maxCount:
      maxCount = list.length
      winningHash = hash
      isTie = false  // RESET on new max
    else if list.length === maxCount:
      isTie = true
  
  // 3. Determine the chosen version
  if !isTie AND maxCount >= 2:
    // Tier 1: majority/plurality
    winners = byHash.get(winningHash)
    winners.sort(by workerId)  // lexicographic for determinism
    chosen = winners[0]
    rationale = `majority vote (${maxCount} of ${versions.length} versions agree on hash ${winningHash.slice(0, 12)}…)`
  else:
    // Tier 2: lexicographic fallback
    sorted = versions.sort(by workerId)  // already sorted, but be explicit
    chosen = sorted[0]
    rationale = `no majority (${byHash.size} distinct versions); tiebreak by lexicographic workerId`
  
  return {
    policy: 'majority-then-lexicographic',
    authoritativeWorkerId: chosen.workerId,
    authoritativeContentHash: chosen.contentHash,
    rationale,
    isAuthoritative: false  // set per-record in buildAggregatedRecords
  }
}
```

## Determinism proof

For any fixed input `versions` array:

1. `byHash` is a Map. Its iteration order in JavaScript is insertion
   order. However, the `isTie` flag and `winningHash` are computed
   by comparing `list.length` — which is invariant under insertion
   order. The final `maxCount` and `isTie` are therefore
   deterministic.

2. The chosen version's `workerId` is either:
   - The lexicographically smallest workerId among the winners
     (Tier 1), which is deterministic regardless of input order.
   - The lexicographically smallest workerId among all versions
     (Tier 2), which is also deterministic.

3. The `rationale` string is generated from `maxCount`,
   `versions.length`, `byHash.size`, and `winningHash.slice(0, 12)`.
   All these are deterministic. The hash slice is the first 12 hex
   chars of the SHA-256, which is deterministic.

Therefore, two runs of `resolveConflict(versions)` with the same
`versions` array (in any order) produce identical output.

## Provenance preservation

The `conflictVersions` field (added in G7-19A) lists the OTHER
versions of the same path. The new `conflictResolution` field
identifies which one was chosen. Together:

- The caller can find the chosen version via
  `conflictResolution.isAuthoritative === true`.
- The caller can list ALL versions via `conflictVersions` (on any
  record for that path).
- The caller can compare any version's hash to
  `conflictResolution.authoritativeContentHash` to verify which
  version was chosen.
- No version is deleted or hidden. The audit trail is complete.

## Scope: what G7-19B does NOT do

1. **Does NOT modify frozen contracts.** The `MissionResult` type
   in `src/contracts/core.ts` is unchanged. The orchestrator in
   `src/mission/orchestrator.ts` is unchanged. The verification
   module in `src/mission/verification.ts` is unchanged.

2. **Does NOT call any reasoning provider.** The policy is a pure
   function. No `ReasoningProvider.reason()` call.

3. **Does NOT pick the "correct" version.** The policy is
   deterministic and transparent, but it cannot know which version
   is semantically correct. It picks based on majority vote and
   lexicographic tiebreak. Downstream verification (if it runs) is
   the source of truth for correctness.

4. **Does NOT change the orchestrator's closure decision.** The
   `MissionResult.status` field remains authoritative. The
   `conflictResolution` field is informational — it tells the
   caller which version the system would pick by default, but the
   caller is free to override.

5. **Does NOT change the existing `conflict` / `conflictVersions`
   behavior.** Those fields work exactly as in G7-19A. The new
   `conflictResolution` field is additive.

## Backward compatibility

- The `conflictResolution` field is OPTIONAL. Existing clients
  that do not read it continue to work unchanged.
- The field is only populated when `conflict=true`. Records with
  no conflict have no `conflictResolution` field.
- The existing `conflict` and `conflictVersions` fields are
  unchanged.
- The (workerId, path) sort order of the response is unchanged.

## Test scenarios (Phase 3 preview)

The brief requires 9 deterministic test scenarios:

1. **Three workers produce three different versions of a file**
   (3-way conflict, no majority) — Tier 2 lexicographic fallback.
2. **Two workers produce the same version; one disagrees** (2+1
   split) — Tier 1 majority.
3. **The same worker produces multiple versions** (same hash, no
   conflict) — `conflictResolution` omitted.
4. **Empty input** — no records, no conflicts.
5. **A single worker** (no conflict possible) — `conflictResolution`
   omitted.
6. **A 10-worker conflict** (large-scale determinism) — verify the
   policy scales and remains deterministic.
7. **The exact G7-18E conflict matrix** (9 paths × 3 versions, 3
   conflicts) — verify the policy produces the expected choices.
8. **Determinism** — re-running with the same inputs produces the
   same chosen version.
9. **Audit trail** — all conflicting versions remain accessible via
   `conflictVersions`.

These map directly to the algorithm's branches and edge cases.
