/**
 * G7-19A — Phase 3: Deterministic reproduction of the 8 aggregation scenarios.
 *
 * No real Z.ai calls. No real OpenBot processes. Uses the pure function
 * `aggregateArtifacts` and `buildAggregatedRecords` from
 * `src/runtime/artifact-aggregation.ts` plus a fake `MemoryRuntime`-style
 * snapshot list.
 *
 * Scenarios (matching the brief's Phase 3 list):
 *   1. One worker delivers a complete valid project; other workers
 *      deliver partial subsets.
 *   2. Workers deliver conflicting versions of a file.
 *   3. All workers complete correctly.
 *   4. One worker fails while another completes.
 *   5. Coordinator reaches timeout after valid worker output exists.
 *   6. Required verification fails.
 *   7. A fully verified deliverable reaches the correct terminal state.
 *   8. Incomplete or conflicting deliverables never produce false success.
 *
 * Each test asserts the EXACT post-aggregation state — the same shape of
 * response that G7-18E would have produced if the G7-19A fix had been
 * in place. This is the ground truth the gateway's `getArtifacts()` API
 * returns to HTTP clients.
 */
import { describe, it, expect } from 'vitest';

import {
  aggregateArtifacts,
  buildAggregatedRecords,
} from '../../src/runtime/artifact-aggregation.js';
import type { ArtifactSnapshot } from '../../src/runtime/computer.js';

// Helper: build a snapshot entry.
function snap(
  workerId: string,
  path: string,
  content: string,
): ArtifactSnapshot {
  return {
    workerId,
    path,
    bytes: Buffer.byteLength(content, 'utf8'),
    content,
  };
}

// ---------------------------------------------------------------------------
// SCENARIO 1 — One worker delivers complete valid project; others partial
// ---------------------------------------------------------------------------

describe('G7-19A Scenario 1: one complete worker + partial subsets', () => {
  it('returns all 9 files for the complete worker, partial sets for others, no false conflicts', () => {
    // software-engineer-1 wrote all 9 files (the canonical G7-18E repair).
    // documentation-writer-2 wrote only 3 of them.
    // generalist-worker-3 wrote nothing.
    const completeWorker = 'software-engineer-1';
    const partialWorker = 'documentation-writer-2';
    const emptyWorker = 'generalist-worker-3';

    const snapshots: ArtifactSnapshot[] = [
      snap(completeWorker, 'README.md', '...baseline...'),
      snap(completeWorker, 'package.json', '...baseline...'),
      snap(completeWorker, 'public/app.js', '...baseline...'),
      snap(completeWorker, 'public/index.html', '...baseline...'),
      snap(completeWorker, 'public/styles.css', '...baseline...'),
      snap(completeWorker, 'server.js', '...baseline...'),
      snap(completeWorker, 'test/api.test.js', '...repaired-by-se-1...'),
      snap(completeWorker, 'test/db.test.js', '...baseline...'),
      snap(completeWorker, 'test/integration.test.js', '...baseline...'),
      // partial worker wrote only 3 files — same content as complete worker
      // for 2 of them, different content for the third
      snap(partialWorker, 'README.md', '...documentation-writer-edited...'),
      snap(partialWorker, 'package.json', '...documentation-writer-edited...'),
      snap(partialWorker, 'server.js', '...baseline...'),
      // empty worker has no snapshots
    ];
    void emptyWorker; // documented as part of the scenario

    const result = aggregateArtifacts(snapshots);

    expect(result.uniquePathCount).toBe(9); // 9 unique paths across both workers
    expect(result.entryCount).toBe(12); // 9 + 3
    // Three paths have conflicts: README.md, package.json (different content
    // between workers), and that's it — server.js has the same content from
    // both workers, so no conflict.
    expect(result.conflictCount).toBe(2);
    const conflictPaths = result.conflictPaths.map((p) => p.path).sort();
    expect(conflictPaths).toEqual(['README.md', 'package.json']);
    // The repaired api.test.js is present from the complete worker, with no
    // conflict (no other worker wrote to it).
    const apiAgg = result.paths.find((p) => p.path === 'test/api.test.js');
    expect(apiAgg).toBeDefined();
    expect(apiAgg!.versions).toHaveLength(1);
    expect(apiAgg!.versions[0].workerId).toBe(completeWorker);
    expect(apiAgg!.conflict).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// SCENARIO 2 — Workers deliver conflicting versions of a file
// ---------------------------------------------------------------------------

describe('G7-19A Scenario 2: conflicting versions of the same path', () => {
  it('flags conflict=true and lists all conflicting versions in conflictVersions', () => {
    const snapshots: ArtifactSnapshot[] = [
      snap('worker-a', 'output.md', 'version A content'),
      snap('worker-b', 'output.md', 'version B content'),
      snap('worker-c', 'output.md', 'version A content'), // agrees with A
    ];
    const result = aggregateArtifacts(snapshots);

    expect(result.uniquePathCount).toBe(1);
    expect(result.entryCount).toBe(3);
    expect(result.conflictCount).toBe(1);
    expect(result.conflictPaths[0].path).toBe('output.md');
    expect(result.conflictPaths[0].conflict).toBe(true);
    // 3 versions, 2 distinct hashes
    const hashes = new Set(result.conflictPaths[0].versions.map((v) => v.contentHash));
    expect(hashes.size).toBe(2);

    // buildAggregatedRecords populates conflict + conflictVersions per entry
    const records = buildAggregatedRecords(snapshots, false, new Set());
    expect(records).toHaveLength(3);
    // All three records are flagged as conflict (the same path)
    expect(records.every((r) => r.conflict === true)).toBe(true);
    // Each record's conflictVersions lists the OTHER workers' versions
    const recA = records.find((r) => r.workerId === 'worker-a')!;
    expect(recA.conflictVersions).toHaveLength(2);
    const recAOthers = recA.conflictVersions!.map((v) => v.workerId).sort();
    expect(recAOthers).toEqual(['worker-b', 'worker-c']);
  });
});

// ---------------------------------------------------------------------------
// SCENARIO 3 — All workers complete correctly
// ---------------------------------------------------------------------------

describe('G7-19A Scenario 3: all workers complete correctly (no conflicts)', () => {
  it('returns all paths with conflict=false when workers agree', () => {
    const snapshots: ArtifactSnapshot[] = [
      snap('worker-a', 'output.md', 'shared content'),
      snap('worker-b', 'output.md', 'shared content'),
      snap('worker-a', 'README.md', '# Project'),
      snap('worker-b', 'README.md', '# Project'),
    ];
    const result = aggregateArtifacts(snapshots);

    expect(result.uniquePathCount).toBe(2);
    expect(result.entryCount).toBe(4);
    expect(result.conflictCount).toBe(0);
    expect(result.conflictPaths).toEqual([]);
    // Every path has multiple versions but the same hash → no conflict.
    for (const pathAgg of result.paths) {
      expect(pathAgg.versions.length).toBe(2);
      expect(pathAgg.conflict).toBe(false);
      const hashes = new Set(pathAgg.versions.map((v) => v.contentHash));
      expect(hashes.size).toBe(1);
    }

    const records = buildAggregatedRecords(snapshots, false, new Set());
    // No conflict fields populated.
    expect(records.every((r) => r.conflict === undefined)).toBe(true);
    expect(records.every((r) => r.conflictVersions === undefined)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// SCENARIO 4 — One worker fails while another completes
// ---------------------------------------------------------------------------

describe('G7-19A Scenario 4: one worker fails, another completes', () => {
  it('preserves the successful worker\u2019s artifacts even when the other failed', () => {
    // Worker-a produced 2 files; worker-b produced 0 (failed before writing).
    // The aggregation must still surface worker-a's files, because the
    // runtime's listArtifacts scans the workspaces — the snapshots list
    // only contains entries for files that actually exist on disk.
    const snapshots: ArtifactSnapshot[] = [
      snap('worker-a', 'output.md', 'worker-a content'),
      snap('worker-a', 'README.md', '# Project'),
    ];
    const result = aggregateArtifacts(snapshots);

    expect(result.uniquePathCount).toBe(2);
    expect(result.entryCount).toBe(2);
    expect(result.conflictCount).toBe(0);
    // The successful worker's files are all preserved.
    const paths = result.paths.map((p) => p.path).sort();
    expect(paths).toEqual(['README.md', 'output.md']);
    // No conflicts because there's only one version per path.
    for (const pathAgg of result.paths) {
      expect(pathAgg.conflict).toBe(false);
      expect(pathAgg.versions).toHaveLength(1);
    }
  });
});

// ---------------------------------------------------------------------------
// SCENARIO 5 — Coordinator reaches timeout after valid worker output exists
// ---------------------------------------------------------------------------

describe('G7-19A Scenario 5: timeout after valid worker output exists', () => {
  it('aggregation still surfaces the valid output (post-hoc, no timeout dependency)', () => {
    // The aggregation is a pure function over snapshots — it does not
    // depend on whether the orchestrator timed out. As long as the
    // runtime's listArtifacts returns the files on disk, the aggregation
    // surfaces them. This is the G7-18E scenario: the orchestrator timed
    // out, but software-engineer-1's workspace had a complete repair.
    const snapshots: ArtifactSnapshot[] = [
      snap('software-engineer-1', 'README.md', '...baseline...'),
      snap('software-engineer-1', 'package.json', '...baseline...'),
      snap('software-engineer-1', 'public/app.js', '...baseline...'),
      snap('software-engineer-1', 'public/index.html', '...baseline...'),
      snap('software-engineer-1', 'public/styles.css', '...baseline...'),
      snap('software-engineer-1', 'server.js', '...baseline...'),
      snap('software-engineer-1', 'test/api.test.js', '...repaired...'),
      snap('software-engineer-1', 'test/db.test.js', '...baseline...'),
      snap('software-engineer-1', 'test/integration.test.js', '...baseline...'),
    ];
    const result = aggregateArtifacts(snapshots);

    // All 9 files surface — including the one in a subdirectory (test/).
    expect(result.uniquePathCount).toBe(9);
    expect(result.entryCount).toBe(9);
    expect(result.conflictCount).toBe(0);
    // The repaired api.test.js is present, no conflict (only one version).
    const apiAgg = result.paths.find((p) => p.path === 'test/api.test.js');
    expect(apiAgg).toBeDefined();
    expect(apiAgg!.conflict).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// SCENARIO 6 — Required verification fails
// ---------------------------------------------------------------------------

describe('G7-19A Scenario 6: required verification fails', () => {
  it('verified flag is false for every entry when verification did not pass', () => {
    const snapshots: ArtifactSnapshot[] = [
      snap('worker-a', 'output.md', 'correct content'),
      snap('worker-b', 'output.md', 'wrong content'),
    ];
    // verificationOk=false (verification failed or never ran)
    const records = buildAggregatedRecords(snapshots, false, new Set());

    // Conflict detection still runs (it is independent of verification).
    expect(records.every((r) => r.conflict === true)).toBe(true);
    // But verified is false for every entry.
    expect(records.every((r) => r.verified === false)).toBe(true);
  });

  it('verified flag is selective when verification passed for some paths only', () => {
    const snapshots: ArtifactSnapshot[] = [
      snap('worker-a', 'output.md', 'correct content'),
      snap('worker-a', 'README.md', '# Project'),
      snap('worker-a', 'missing.txt', 'should not have been written'),
    ];
    // verification passed, but only output.md and README.md are in
    // verifiedPaths. missing.txt is not verified.
    const records = buildAggregatedRecords(
      snapshots,
      true,
      new Set(['output.md', 'README.md']),
    );
    const out = records.find((r) => r.path === 'output.md')!;
    expect(out.verified).toBe(true);
    const readme = records.find((r) => r.path === 'README.md')!;
    expect(readme.verified).toBe(true);
    const missing = records.find((r) => r.path === 'missing.txt')!;
    expect(missing.verified).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// SCENARIO 7 — Fully verified deliverable reaches the correct terminal state
// ---------------------------------------------------------------------------

describe('G7-19A Scenario 7: fully verified deliverable', () => {
  it('all entries for verified paths have verified=true and no conflicts', () => {
    const snapshots: ArtifactSnapshot[] = [
      snap('worker-a', 'output.md', 'final content'),
      snap('worker-a', 'README.md', '# Final'),
    ];
    // verification passed, both paths verified
    const records = buildAggregatedRecords(
      snapshots,
      true,
      new Set(['output.md', 'README.md']),
    );
    expect(records).toHaveLength(2);
    expect(records.every((r) => r.verified === true)).toBe(true);
    expect(records.every((r) => r.conflict === undefined)).toBe(true);
    // contentHash is populated for every entry (inlined content).
    expect(records.every((r) => typeof r.contentHash === 'string' && r.contentHash.length === 64)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// SCENARIO 8 — Incomplete or conflicting deliverables never produce false success
// ---------------------------------------------------------------------------

describe('G7-19A Scenario 8: no false success for incomplete/conflicting', () => {
  it('conflicting versions are surfaced as conflict=true (never silently picked)', () => {
    const snapshots: ArtifactSnapshot[] = [
      snap('worker-a', 'output.md', 'version A'),
      snap('worker-b', 'output.md', 'version B'),
    ];
    const records = buildAggregatedRecords(snapshots, true, new Set(['output.md']));
    // Even though verification "passed" for output.md, the conflict
    // flag is set — the caller cannot mistake this for clean success.
    expect(records.every((r) => r.conflict === true)).toBe(true);
    expect(records.every((r) => r.verified === true)).toBe(true);
    // The conflictVersions array lists the OTHER worker's version so
    // the caller can see the disagreement.
    for (const r of records) {
      expect(r.conflictVersions).toHaveLength(1);
    }
  });

  it('a partial deliverable (one path out of two written) does not claim full coverage', () => {
    const snapshots: ArtifactSnapshot[] = [
      snap('worker-a', 'output.md', 'content'),
      // README.md was required but never written by anyone
    ];
    const result = aggregateArtifacts(snapshots);
    // Only output.md is present — README.md is absent.
    expect(result.uniquePathCount).toBe(1);
    expect(result.paths.find((p) => p.path === 'output.md')).toBeDefined();
    expect(result.paths.find((p) => p.path === 'README.md')).toBeUndefined();
    // The aggregation does not invent missing files.
    expect(result.paths.every((p) => p.conflict === false)).toBe(true);
  });

  it('empty input produces empty aggregation (no fabricated success)', () => {
    const result = aggregateArtifacts([]);
    expect(result.uniquePathCount).toBe(0);
    expect(result.entryCount).toBe(0);
    expect(result.conflictCount).toBe(0);
    expect(result.paths).toEqual([]);
    expect(result.conflictPaths).toEqual([]);
    const records = buildAggregatedRecords([], true, new Set());
    expect(records).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// SCENARIO BONUS — the G7-18E exact reproduction
// ---------------------------------------------------------------------------

describe('G7-19A bonus: G7-18E exact reproduction (3 workers × 9 paths with conflicts)', () => {
  it('matches the per-path conflict matrix observed in G7-18E', () => {
    // The actual content from G7-18E — see evidence/g7-19a/phase-1-root-cause.md
    // README.md: 3 versions, 2 distinct hashes (9c5c185e vs 718db0f4 ×2)
    // package.json: 3 versions, 2 distinct hashes (4d62a657 vs 587ba47b ×2)
    // test/api.test.js: 3 versions, 3 distinct hashes
    // all other paths: 3 versions, 1 hash (no conflict)
    const baseline = 'baseline-content';
    const se1 = 'software-engineer-1';
    const dw2 = 'documentation-writer-2';
    const gw3 = 'generalist-worker-3';

    const snapshots: ArtifactSnapshot[] = [
      // README.md — 3 versions, 2 distinct hashes
      snap(se1, 'README.md', baseline),
      snap(dw2, 'README.md', 'documentation-writer README'),
      snap(gw3, 'README.md', baseline),
      // package.json — 3 versions, 2 distinct hashes
      snap(se1, 'package.json', baseline),
      snap(dw2, 'package.json', 'documentation-writer package'),
      snap(gw3, 'package.json', baseline),
      // public/* — 3 versions each, all the same baseline (no conflict)
      snap(se1, 'public/app.js', baseline),
      snap(dw2, 'public/app.js', baseline),
      snap(gw3, 'public/app.js', baseline),
      snap(se1, 'public/index.html', baseline),
      snap(dw2, 'public/index.html', baseline),
      snap(gw3, 'public/index.html', baseline),
      snap(se1, 'public/styles.css', baseline),
      snap(dw2, 'public/styles.css', baseline),
      snap(gw3, 'public/styles.css', baseline),
      // server.js — 3 versions, all baseline (no conflict)
      snap(se1, 'server.js', baseline),
      snap(dw2, 'server.js', baseline),
      snap(gw3, 'server.js', baseline),
      // test/api.test.js — 3 versions, 3 distinct hashes (3-way conflict)
      snap(se1, 'test/api.test.js', 'se-1 repair'),
      snap(dw2, 'test/api.test.js', 'documentation-writer repair'),
      snap(gw3, 'test/api.test.js', baseline),
      // test/db.test.js — 3 versions, all baseline (no conflict)
      snap(se1, 'test/db.test.js', baseline),
      snap(dw2, 'test/db.test.js', baseline),
      snap(gw3, 'test/db.test.js', baseline),
      // test/integration.test.js — 3 versions, all baseline (no conflict)
      snap(se1, 'test/integration.test.js', baseline),
      snap(dw2, 'test/integration.test.js', baseline),
      snap(gw3, 'test/integration.test.js', baseline),
    ];

    const result = aggregateArtifacts(snapshots);
    // 9 unique paths × 3 versions each = 27 entries
    expect(result.uniquePathCount).toBe(9);
    expect(result.entryCount).toBe(27);
    // 3 conflicts: README.md, package.json, test/api.test.js
    expect(result.conflictCount).toBe(3);
    const conflictPaths = result.conflictPaths.map((p) => p.path).sort();
    expect(conflictPaths).toEqual(['README.md', 'package.json', 'test/api.test.js']);
    // test/api.test.js is a 3-way conflict (3 distinct hashes).
    const apiAgg = result.paths.find((p) => p.path === 'test/api.test.js')!;
    const apiHashes = new Set(apiAgg.versions.map((v) => v.contentHash));
    expect(apiHashes.size).toBe(3);
    // The other 6 paths have no conflict.
    const nonConflictPaths = result.paths.filter((p) => !p.conflict).map((p) => p.path).sort();
    expect(nonConflictPaths).toEqual([
      'public/app.js',
      'public/index.html',
      'public/styles.css',
      'server.js',
      'test/db.test.js',
      'test/integration.test.js',
    ]);
    // buildAggregatedRecords returns all 27 entries in (workerId, path) order
    const records = buildAggregatedRecords(snapshots, false, new Set());
    expect(records).toHaveLength(27);
    // First 9 are documentation-writer-2 (sorted by workerId first)
    expect(records[0].workerId).toBe('documentation-writer-2');
    expect(records[records.length - 1].workerId).toBe('software-engineer-1');
  });
});

// ---------------------------------------------------------------------------
// SCENARIO BONUS 2 — recursion fix verification (Defect A)
// ---------------------------------------------------------------------------

describe('G7-19A bonus: listArtifacts recursion (Defect A) — files in subdirectories surface', () => {
  it('aggregation surfaces files in subdirectories when the runtime lists them', () => {
    // This is the G7-18E software-engineer-1 case: 9 files in 4 directories.
    // The pre-G7-19A listArtifacts only returned the 3 top-level files;
    // the G7-19A fix walks recursively, so the snapshots list contains
    // all 9. The aggregation is downstream of listArtifacts — its job
    // is to detect conflicts and preserve provenance, not to recurse.
    // This test verifies that WHEN listArtifacts returns subdirectory
    // files (which it now does post-fix), the aggregation surfaces them
    // in the response.
    const snapshots: ArtifactSnapshot[] = [
      snap('software-engineer-1', 'README.md', 'top-level'),
      snap('software-engineer-1', 'package.json', 'top-level'),
      snap('software-engineer-1', 'server.js', 'top-level'),
      snap('software-engineer-1', 'public/app.js', 'subdir:public'),
      snap('software-engineer-1', 'public/index.html', 'subdir:public'),
      snap('software-engineer-1', 'public/styles.css', 'subdir:public'),
      snap('software-engineer-1', 'test/api.test.js', 'subdir:test (repaired)'),
      snap('software-engineer-1', 'test/db.test.js', 'subdir:test'),
      snap('software-engineer-1', 'test/integration.test.js', 'subdir:test'),
    ];
    const result = aggregateArtifacts(snapshots);
    // ALL 9 paths surface, including the 6 in subdirectories.
    expect(result.uniquePathCount).toBe(9);
    expect(result.paths.map((p) => p.path).sort()).toEqual([
      'README.md',
      'package.json',
      'public/app.js',
      'public/index.html',
      'public/styles.css',
      'server.js',
      'test/api.test.js',
      'test/db.test.js',
      'test/integration.test.js',
    ]);
    // The repaired api.test.js is present and has no conflict (only one version).
    const apiAgg = result.paths.find((p) => p.path === 'test/api.test.js')!;
    expect(apiAgg.versions).toHaveLength(1);
    expect(apiAgg.conflict).toBe(false);
  });
});
