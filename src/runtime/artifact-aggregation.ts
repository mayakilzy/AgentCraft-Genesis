/**
 * G7-19A/G7-19B — Deterministic artifact aggregation + conflict resolution.
 *
 * This module is a pure function layer over {@link ArtifactSnapshot}:
 * it does NOT touch the filesystem, does NOT call any provider, and does
 * NOT depend on the frozen orchestrator or verification modules. The
 * gateway's `getArtifacts()` calls into this module to compute
 * deterministic conflict detection (G7-19A) AND conflict resolution
 * (G7-19B) for the artifacts response.
 *
 * ## Why a separate module
 *
 * The pre-G7-19A `getArtifacts()` returned one {@link MissionArtifactRecord}
 * per (workerId, path) pair, with no conflict detection and no content
 * hash. When 3 workers each wrote to the same path with different content
 * (as happened in G7-18E for `README.md`, `package.json`, `test/api.test.js`),
 * the response contained 3 entries with the same `path` and different
 * `bytes` — but no signal that this was a conflict. The caller had to
 * manually diff inlined content to discover the disagreement.
 *
 * ## What this module does
 *
 * - `aggregateArtifacts(snapshots)` (G7-19A) returns an {@link AggregationResult}
 *   grouping snapshots by path, computing a SHA-256 per inlined entry,
 *   and flagging paths where multiple workers produced different hashes.
 * - `resolveConflict(versions)` (G7-19B) picks the authoritative version
 *   for a conflicting path using the deterministic
 *   "majority-then-lexicographic" policy.
 * - `buildAggregatedRecords(snapshots, verificationOk, verifiedPaths)`
 *   returns the {@link MissionArtifactRecord} array with `contentHash`,
 *   `conflict`, `conflictVersions`, AND `conflictResolution` populated.
 *   The order matches the existing (workerId, path) sort for backward
 *   compatibility.
 *
 * ## What this module does NOT do
 *
 * - It does NOT modify the frozen {@link MissionResult} contract. The
 *   aggregation result is exposed via the transport type
 *   {@link MissionArtifactRecord} in `src/gateway/types.ts`.
 * - It does NOT call any reasoning provider. The aggregation and
 *   conflict resolution are deterministic pure functions over the
 *   runtime's snapshot list.
 * - It does NOT pick the "semantically correct" version. The policy
 *   is transparent about its limitations: when all workers disagree,
 *   the lexicographic fallback is arbitrary and may not be the
 *   "right" version. Downstream verification (if it runs) is the
 *   source of truth for correctness.
 *
 * ## G7-19B conflict resolution policy: "majority-then-lexicographic"
 *
 * When a path has a conflict (≥2 distinct contentHashes), the policy
 * picks the authoritative version in two tiers:
 *
 * **Tier 1 — Majority/plurality vote**: Group versions by contentHash.
 * Find the hash with the maximum count. If there is a unique hash
 * with count ≥ 2 (at least 2 workers agree), pick that hash. The
 * chosen workerId is the lexicographically smallest workerId among
 * the versions with the winning hash (for determinism).
 *
 * **Tier 2 — Lexicographic fallback**: If Tier 1 fails (no unique
 * winner with ≥2 votes, i.e., all versions disagree or there's a
 * tie in counts), pick the version with the lexicographically
 * smallest workerId among ALL versions. This is arbitrary but
 * deterministic and transparent — the rationale string documents
 * that this is a fallback.
 *
 * **Tier 0 — No conflict**: If there is only one version (single
 * worker) or all versions have the same hash (unanimous agreement),
 * there is no conflict and no resolution. The `conflictResolution`
 * field is omitted.
 *
 * ## Determinism
 *
 * The output ordering is stable: sort by (path, workerId). The content
 * hash is SHA-256 of the inlined content (empty string for non-inlined
 * entries). The conflict resolution algorithm is deterministic: same
 * input always produces the same chosen workerId, hash, and rationale.
 * Two runs over the same `snapshots` array produce identical output.
 */
import { createHash } from 'node:crypto';

import type { ArtifactSnapshot } from './computer.js';
import type { MissionArtifactRecord } from '../gateway/types.js';

/**
 * Compute the SHA-256 hash of a string (hex). Empty string when the
 * input is empty (so callers can always store a string field).
 */
function sha256Hex(text: string): string {
  if (text.length === 0) return '';
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * One version of a path: which worker wrote it, the content hash, and
 * the byte size. Used inside {@link PathAggregation.versions}.
 */
export interface ArtifactVersion {
  /** Worker that wrote this version. */
  readonly workerId: string;
  /** SHA-256 of the inlined content (hex). Empty when content was not inlined. */
  readonly contentHash: string;
  /** Content length in bytes. */
  readonly bytes: number;
  /** Inlined content (≤ 64KB). Undefined for larger files. */
  readonly content?: string;
}

/**
 * Aggregation of all versions of one path. A path with N workers that
 * wrote to it has N entries in `versions`. `conflict` is `true` when
 * the `versions` array contains at least two distinct `contentHash`
 * values.
 *
 * Note: when all workers wrote the SAME content (same hash), `conflict`
 * is `false` even if there are multiple versions — they agree.
 */
export interface PathAggregation {
  /** The workspace-relative path. */
  readonly path: string;
  /** All versions of this path, sorted by workerId for determinism. */
  readonly versions: readonly ArtifactVersion[];
  /** `true` iff at least two versions have different `contentHash`. */
  readonly conflict: boolean;
}

/**
 * The full aggregation result. `byPath` is a Map keyed by path; `paths`
 * is the same data as an array sorted by path. `conflictPaths` is the
 * subset of paths where `conflict=true`.
 */
export interface AggregationResult {
  /** Array of path aggregations, sorted by path for determinism. */
  readonly paths: readonly PathAggregation[];
  /** Subset of {@link paths} where `conflict=true`. Sorted by path. */
  readonly conflictPaths: readonly PathAggregation[];
  /** Total number of unique paths across all workers. */
  readonly uniquePathCount: number;
  /** Total number of (workerId, path) entries. */
  readonly entryCount: number;
  /** Number of paths with at least one conflict. */
  readonly conflictCount: number;
}

/**
 * Group snapshots by path, compute content hashes, and detect conflicts
 * deterministically.
 *
 * The input is the array returned by
 * {@link ArtifactsProvider.listArtifacts} — one entry per (workerId, path).
 * The output groups these by path and flags conflicts.
 *
 * ## Conflict definition
 *
 * A path has a conflict when at least two of its versions have different
 * `contentHash` values. When all versions have the same hash (or only one
 * version exists), there is no conflict.
 *
 * ## Hash computation
 *
 * Only inlined content (≤ 64KB) is hashed. Larger files have no inlined
 * content, so their `contentHash` is the empty string. Two large files
 * with different `bytes` will have the same empty hash — but their
 * `bytes` differ, so they are still flagged as conflicting via the
 * `bytes` fallback check (different bytes ⇒ different content for
 * non-inlined files).
 *
 * ## Determinism
 *
 * - Input order does not affect output. Entries are sorted by (path, workerId).
 * - Two runs over the same input produce identical output.
 * - No filesystem access, no provider calls.
 */
export function aggregateArtifacts(
  snapshots: readonly ArtifactSnapshot[],
): AggregationResult {
  // 1. Group by path. Use a Map to preserve insertion order independence.
  const byPath = new Map<string, ArtifactVersion[]>();
  for (const snap of snapshots) {
    const content = snap.content;
    const contentHash = content === undefined ? '' : sha256Hex(content);
    const version: ArtifactVersion = {
      workerId: snap.workerId,
      contentHash,
      bytes: snap.bytes,
      ...(content === undefined ? {} : { content }),
    };
    const list = byPath.get(snap.path);
    if (list === undefined) {
      byPath.set(snap.path, [version]);
    } else {
      list.push(version);
    }
  }

  // 2. Build PathAggregation per path, with conflict detection.
  const paths: PathAggregation[] = [];
  for (const [path, versions] of byPath) {
    // Sort versions by workerId for determinism.
    const sortedVersions = [...versions].sort((a, b) =>
      a.workerId < b.workerId ? -1 : a.workerId > b.workerId ? 1 : 0,
    );
    // Conflict = at least two distinct hashes, OR (for non-inlined files)
    // at least two distinct byte sizes. The hash check covers inlined files
    // (different content ⇒ different hash). The byte-size check covers
    // non-inlined files (different content ⇒ different size, almost always).
    const hashes = new Set(sortedVersions.map((v) => v.contentHash));
    const sizes = new Set(sortedVersions.map((v) => v.bytes));
    const allInlined = sortedVersions.every((v) => v.contentHash !== '');
    const conflict = allInlined
      ? hashes.size > 1
      : hashes.size > 1 || sizes.size > 1;
    paths.push({
      path,
      versions: sortedVersions,
      conflict,
    });
  }
  // Sort paths by path for determinism.
  paths.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  const conflictPaths = paths.filter((p) => p.conflict);
  return {
    paths,
    conflictPaths,
    uniquePathCount: paths.length,
    entryCount: snapshots.length,
    conflictCount: conflictPaths.length,
  };
}

/**
 * G7-19B — The deterministic conflict resolution result for one
 * conflicting path. This is the per-PATH resolution (independent of
 * which record we're looking at). The `buildAggregatedRecords`
 * function sets `isAuthoritative` per-record based on whether
 * that record's workerId matches `authoritativeWorkerId`.
 *
 * This type is INTERNAL to the aggregation module — the public
 * field on `MissionArtifactRecord` is the inline object type
 * declared in `src/gateway/types.ts`.
 */
export interface ConflictResolutionResult {
  /** Policy name (always "majority-then-lexicographic" in G7-19B). */
  readonly policy: string;
  /** WorkerId of the chosen authoritative version. */
  readonly authoritativeWorkerId: string;
  /** ContentHash of the chosen authoritative version. */
  readonly authoritativeContentHash: string;
  /** Human-readable explanation of why this version was chosen. */
  readonly rationale: string;
}

/**
 * G7-19B policy name. Surfaced in the {@link ConflictResolutionResult.policy}
 * field so downstream clients can identify which policy was applied.
 */
export const CONFLICT_RESOLUTION_POLICY = 'majority-then-lexicographic';

/**
 * G7-19B — Resolve a conflicting path to a single authoritative version.
 *
 * The input `versions` array is the per-path versions (already sorted
 * by workerId by {@link aggregateArtifacts}). The function applies the
 * "majority-then-lexicographic" policy:
 *
 * 1. **Tier 1 (majority)**: group by `contentHash`, find the hash with
 *    the maximum count. If there is a unique winner with count ≥ 2,
 *    pick that hash. The chosen workerId is the lexicographically
 *    smallest workerId among the winners (for determinism — when
 *    multiple workers wrote the same content, picking the smallest
 *    workerId is stable across runs).
 * 2. **Tier 2 (lexicographic fallback)**: if Tier 1 fails (no unique
 *    winner with ≥2 votes, i.e., all disagree or tied counts), pick
 *    the version with the lexicographically smallest workerId among
 *    ALL versions. This is arbitrary but transparent — the rationale
 *    string documents that it's a fallback.
 *
 * ## Determinism
 *
 * - The `byHash` Map's iteration order is insertion order in JS, but
 *   the `isTie` flag and `winningHash` are computed by comparing
 *   `list.length`, which is invariant under insertion order. The
 *   final `maxCount` and `isTie` are therefore deterministic.
 * - The chosen workerId is either the lexicographically smallest
 *   workerId among the winners (Tier 1) or among all versions
 *   (Tier 2). Both are deterministic regardless of input order.
 * - The `rationale` string is generated from `maxCount`,
 *   `versions.length`, `byHash.size`, and `winningHash.slice(0, 12)`.
 *   All of these are deterministic.
 *
 * ## Edge cases
 *
 * - Empty `versions` array: returns a result with empty
 *   `authoritativeWorkerId` and `authoritativeContentHash`, and a
 *   rationale of "no versions to resolve". This case should not
 *   arise in practice (a path with no versions is not in the
 *   aggregation), but the function handles it gracefully.
 * - Single version: returns that version as authoritative. (This
 *   case also should not arise in practice because a single version
 *   means no conflict, so `resolveConflict` would not be called.
 *   But the function handles it.)
 *
 * @param versions the per-path versions, sorted by workerId
 * @returns the deterministic resolution result
 */
export function resolveConflict(
  versions: readonly ArtifactVersion[],
): ConflictResolutionResult {
  // Edge case: empty input.
  if (versions.length === 0) {
    return {
      policy: CONFLICT_RESOLUTION_POLICY,
      authoritativeWorkerId: '',
      authoritativeContentHash: '',
      rationale: 'no versions to resolve',
    };
  }

  // 1. Group by contentHash.
  const byHash = new Map<string, ArtifactVersion[]>();
  for (const v of versions) {
    const list = byHash.get(v.contentHash);
    if (list === undefined) {
      byHash.set(v.contentHash, [v]);
    } else {
      list.push(v);
    }
  }

  // 2. Find the hash with the maximum count. Track whether there's a tie.
  let maxCount = 0;
  let winningHash = '';
  let isTie = false;
  for (const [hash, list] of byHash) {
    if (list.length > maxCount) {
      maxCount = list.length;
      winningHash = hash;
      // RESET isTie when we have a new unique maximum. Without this
      // reset, a tie detected earlier (e.g., between two 1-vote
      // hashes) would persist even after a higher-count hash appears
      // and becomes the unique winner.
      isTie = false;
    } else if (list.length === maxCount) {
      // This hash ties with the current maximum. If we end up with
      // isTie=true at the end, it means there is no unique winner.
      isTie = true;
    }
  }

  // 3. Determine the chosen version.
  // Defensive copy for sorting — the input array is readonly.
  const sortedByWorkerId = [...versions].sort((a, b) =>
    a.workerId < b.workerId ? -1 : a.workerId > b.workerId ? 1 : 0,
  );

  let chosen: ArtifactVersion;
  let rationale: string;

  if (!isTie && maxCount >= 2) {
    // Tier 1: majority/plurality. Pick lexicographically smallest
    // workerId among the winners (versions with winningHash).
    const winners = byHash
      .get(winningHash)!
      .sort((a, b) =>
        a.workerId < b.workerId ? -1 : a.workerId > b.workerId ? 1 : 0,
      );
    chosen = winners[0];
    rationale = `majority vote (${maxCount} of ${versions.length} versions agree on hash ${winningHash.slice(0, 12)}…)`;
  } else {
    // Tier 2: lexicographic fallback. No unique winner with ≥2 votes.
    // Pick the lexicographically smallest workerId among ALL versions.
    chosen = sortedByWorkerId[0];
    rationale = `no majority (${byHash.size} distinct versions); tiebreak by lexicographic workerId`;
  }

  return {
    policy: CONFLICT_RESOLUTION_POLICY,
    authoritativeWorkerId: chosen.workerId,
    authoritativeContentHash: chosen.contentHash,
    rationale,
  };
}

/**
 * Build the gateway's {@link MissionArtifactRecord} array from raw
 * snapshots, with conflict detection (G7-19A) AND conflict resolution
 * (G7-19B) applied.
 *
 * This is the function the gateway's `getArtifacts()` calls. It:
 *   1. Aggregates snapshots via {@link aggregateArtifacts}.
 *   2. For each conflicting path, computes the deterministic
 *      resolution via {@link resolveConflict} (G7-19B).
 *   3. For each (workerId, path) entry, produces a MissionArtifactRecord
 *      with `contentHash`, `conflict`, `conflictVersions`, AND
 *      `conflictResolution` populated.
 *   4. Returns the array sorted by (workerId, path) — the same order as
 *      the pre-G7-19A implementation, for backward compatibility.
 *
 * ## G7-19B conflictResolution behavior
 *
 * When `conflict=true` on a record, the `conflictResolution` field is
 * populated. The field carries the same policy/authoritativeWorkerId/
 * authoritativeContentHash/rationale on EVERY record for the same
 * conflicting path. The `isAuthoritative` field differs per-record:
 * - `true` on the record whose workerId matches `authoritativeWorkerId`.
 * - `false` on the other records for the same path.
 *
 * This way, the caller can:
 * - Find the chosen version by filtering for
 *   `conflictResolution.isAuthoritative === true`.
 * - See WHY it was chosen via `rationale` (on any record for that path).
 * - Verify the chosen version's content matches
 *   `authoritativeContentHash`.
 * - See ALL versions via `conflictVersions` (audit trail preserved).
 *
 * @param snapshots the raw per-(worker, path) entries from listArtifacts()
 * @param verificationOk whether the verification loop passed for this mission
 * @param verifiedPaths the set of paths the verifier explicitly marked as verified
 */
export function buildAggregatedRecords(
  snapshots: readonly ArtifactSnapshot[],
  verificationOk: boolean,
  verifiedPaths: ReadonlySet<string>,
): MissionArtifactRecord[] {
  const aggregation = aggregateArtifacts(snapshots);
  // Index: (workerId, path) → ArtifactVersion (for fast lookup of THIS entry's hash).
  const versionByWorkerPath = new Map<string, ArtifactVersion>();
  for (const pathAgg of aggregation.paths) {
    for (const v of pathAgg.versions) {
      versionByWorkerPath.set(`${v.workerId}\0${pathAgg.path}`, v);
    }
  }
  // Index: path → PathAggregation (for looking up conflictVersions).
  const pathAggByPath = new Map<string, PathAggregation>();
  for (const pathAgg of aggregation.paths) {
    pathAggByPath.set(pathAgg.path, pathAgg);
  }

  // G7-19B: pre-compute the conflict resolution per conflicting path.
  // Index: path → ConflictResolutionResult (without isAuthoritative, which
  // is per-record). When a path has no conflict, the entry is undefined.
  const resolutionByPath = new Map<string, ConflictResolutionResult>();
  for (const pathAgg of aggregation.conflictPaths) {
    resolutionByPath.set(pathAgg.path, resolveConflict(pathAgg.versions));
  }

  const records: MissionArtifactRecord[] = [];
  for (const snap of snapshots) {
    const thisVersion = versionByWorkerPath.get(`${snap.workerId}\0${snap.path}`);
    const contentHash = thisVersion?.contentHash ?? '';
    const pathAgg = pathAggByPath.get(snap.path);
    const conflict = pathAgg?.conflict ?? false;
    // conflictVersions: all OTHER versions of the same path (exclude this worker).
    const conflictVersions = conflict && pathAgg
      ? pathAgg.versions
          .filter((v) => v.workerId !== snap.workerId)
          .map((v) => ({
            workerId: v.workerId,
            contentHash: v.contentHash,
            bytes: v.bytes,
          }))
      : undefined;
    // G7-19B: conflictResolution is populated only when conflict=true.
    // The isAuthoritative flag is set per-record by comparing this
    // record's workerId to the resolution's authoritativeWorkerId.
    const resolution = conflict ? resolutionByPath.get(snap.path) : undefined;
    const conflictResolution = resolution
      ? {
          policy: resolution.policy,
          authoritativeWorkerId: resolution.authoritativeWorkerId,
          authoritativeContentHash: resolution.authoritativeContentHash,
          rationale: resolution.rationale,
          isAuthoritative: resolution.authoritativeWorkerId === snap.workerId,
        }
      : undefined;
    records.push({
      workerId: snap.workerId,
      path: snap.path,
      ...(snap.content === undefined ? {} : { content: snap.content }),
      verified: verificationOk && verifiedPaths.has(snap.path),
      bytes: snap.bytes,
      // G7-19A fields — only populated when meaningful.
      ...(contentHash !== '' ? { contentHash } : {}),
      ...(conflict ? { conflict: true } : {}),
      ...(conflictVersions !== undefined ? { conflictVersions } : {}),
      // G7-19B field — only populated when conflict=true.
      ...(conflictResolution !== undefined ? { conflictResolution } : {}),
    });
  }
  // Sort by (workerId, path) for backward compatibility with pre-G7-19A.
  records.sort((a, b) =>
    a.workerId === b.workerId
      ? a.path < b.path
        ? -1
        : a.path > b.path
          ? 1
          : 0
      : a.workerId < b.workerId
        ? -1
        : 1,
  );
  return records;
}
