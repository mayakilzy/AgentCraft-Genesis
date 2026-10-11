/**
 * G7-19A — Deterministic artifact aggregation helpers.
 *
 * This module is a pure function layer over {@link ArtifactSnapshot}:
 * it does NOT touch the filesystem, does NOT call any provider, and does
 * NOT depend on the frozen orchestrator or verification modules. The
 * gateway's `getArtifacts()` calls into this module to compute
 * deterministic conflict detection and per-path provenance for the
 * artifacts response.
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
 * - `aggregateArtifacts(snapshots)` returns an {@link AggregationResult}
 *   grouping snapshots by path, computing a SHA-256 per inlined entry,
 *   and flagging paths where multiple workers produced different hashes.
 * - `buildAggregatedRecords(snapshots, verificationOk, verifiedPaths)`
 *   returns the {@link MissionArtifactRecord} array with `contentHash`,
 *   `conflict`, and `conflictVersions` populated. The order matches
 *   the existing (workerId, path) sort for backward compatibility.
 *
 * ## What this module does NOT do
 *
 * - It does NOT pick an "authoritative" version when workers conflict.
 *   The caller (or a downstream human) makes that choice. This module
 *   only surfaces the conflict deterministically.
 * - It does NOT modify the frozen {@link MissionResult} contract. The
 *   aggregation result is exposed via the transport type
 *   {@link MissionArtifactRecord} in `src/gateway/types.ts`.
 * - It does NOT call any reasoning provider. The aggregation is a
 *   deterministic pure function over the runtime's snapshot list.
 *
 * ## Determinism
 *
 * The output ordering is stable: sort by (path, workerId). The content
 * hash is SHA-256 of the inlined content (empty string for non-inlined
 * entries). Two runs over the same `snapshots` array produce identical
 * output.
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
 * Build the gateway's {@link MissionArtifactRecord} array from raw
 * snapshots, with conflict detection and content hashing applied.
 *
 * This is the function the gateway's `getArtifacts()` calls. It:
 *   1. Aggregates snapshots via {@link aggregateArtifacts}.
 *   2. For each (workerId, path) entry, produces a MissionArtifactRecord
 *      with `contentHash`, `conflict`, and `conflictVersions` populated.
 *   3. Returns the array sorted by (workerId, path) — the same order as
 *      the pre-G7-19A implementation, for backward compatibility.
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
