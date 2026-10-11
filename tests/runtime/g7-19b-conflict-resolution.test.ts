/**
 * G7-19B — Phase 3: Deterministic conflict resolution tests.
 *
 * No real Z.ai calls. No real OpenBot processes. Uses the pure function
 * `resolveConflict` and `buildAggregatedRecords` from
 * `src/runtime/artifact-aggregation.ts`.
 *
 * Scenarios (matching the brief's Phase 3 list):
 *   1. Three workers produce three different versions of a file.
 *   2. Two workers produce the same version; one disagrees.
 *   3. The same worker produces multiple versions (same hash, no conflict).
 *   4. Empty input.
 *   5. A single worker (no conflict possible).
 *   6. A 10-worker conflict (large-scale determinism).
 *   7. The exact G7-18E conflict matrix (9 paths × 3 versions, 3 conflicts).
 *   8. Conflict resolution does not pick a "random" version — re-running
 *      with the same inputs produces the same chosen version.
 *   9. All conflicting versions remain accessible via the audit trail.
 *
 * Each test asserts the EXACT resolution result — the chosen
 * authoritativeWorkerId, the policy name, and the rationale string.
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';

import {
  resolveConflict,
  buildAggregatedRecords,
  CONFLICT_RESOLUTION_POLICY,
} from '../../src/runtime/artifact-aggregation.js';
import type { ArtifactSnapshot } from '../../src/runtime/computer.js';
import type { ArtifactVersion } from '../../src/runtime/artifact-aggregation.js';

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

// Helper: convert a snapshot to an ArtifactVersion (the shape
// resolveConflict expects). Computes the contentHash via SHA-256
// using the same rule as the aggregation module.
function toVersion(s: ArtifactSnapshot): ArtifactVersion {
  const hash = s.content && s.content.length > 0
    ? createHash('sha256').update(s.content, 'utf8').digest('hex')
    : '';
  return {
    workerId: s.workerId,
    contentHash: hash,
    bytes: s.bytes,
    ...(s.content === undefined ? {} : { content: s.content }),
  };
}

// Helper: convert a list of snapshots (all same path) to versions.
function toVersions(snaps: ArtifactSnapshot[]): ArtifactVersion[] {
  return snaps.map(toVersion);
}

// ---------------------------------------------------------------------------
// SCENARIO 1 — Three workers produce three different versions of a file
// ---------------------------------------------------------------------------

describe('G7-19B Scenario 1: 3-way conflict (no majority) → lexicographic fallback', () => {
  it('picks the lexicographically smallest workerId with a transparent rationale', () => {
    // Three workers each wrote a different version of output.md.
    const snaps: ArtifactSnapshot[] = [
      snap('worker-c', 'output.md', 'content C'),
      snap('worker-a', 'output.md', 'content A'),
      snap('worker-b', 'output.md', 'content B'),
    ];
    const versions = toVersions(snaps);
    const result = resolveConflict(versions);

    expect(result.policy).toBe(CONFLICT_RESOLUTION_POLICY);
    // No majority (3 distinct hashes, 1 vote each) → lexicographic fallback.
    // Lexicographically smallest workerId is "worker-a".
    expect(result.authoritativeWorkerId).toBe('worker-a');
    // The chosen contentHash is worker-a's hash.
    const workerAVersion = versions.find((v) => v.workerId === 'worker-a')!;
    expect(result.authoritativeContentHash).toBe(workerAVersion.contentHash);
    // The rationale documents the fallback explicitly.
    expect(result.rationale).toContain('no majority');
    expect(result.rationale).toContain('3 distinct versions');
    expect(result.rationale).toContain('lexicographic workerId');
  });
});

// ---------------------------------------------------------------------------
// SCENARIO 2 — Two workers produce the same version; one disagrees
// ---------------------------------------------------------------------------

describe('G7-19B Scenario 2: 2+1 split → majority vote', () => {
  it('picks the majority version, with the smallest workerId among the winners', () => {
    // Two workers wrote "shared content"; one worker wrote different content.
    const snaps: ArtifactSnapshot[] = [
      snap('worker-a', 'output.md', 'shared content'),
      snap('worker-b', 'output.md', 'different content'),
      snap('worker-c', 'output.md', 'shared content'),
    ];
    const versions = toVersions(snaps);
    const result = resolveConflict(versions);

    expect(result.policy).toBe(CONFLICT_RESOLUTION_POLICY);
    // Majority: 2 of 3 versions have the "shared content" hash.
    // Lexicographically smallest workerId among the winners: worker-a < worker-c.
    expect(result.authoritativeWorkerId).toBe('worker-a');
    // The chosen contentHash is the majority hash.
    const workerAVersion = versions.find((v) => v.workerId === 'worker-a')!;
    expect(result.authoritativeContentHash).toBe(workerAVersion.contentHash);
    // The rationale documents the majority.
    expect(result.rationale).toContain('majority vote');
    expect(result.rationale).toContain('2 of 3 versions agree');
  });
});

// ---------------------------------------------------------------------------
// SCENARIO 3 — The same worker produces multiple versions (same hash)
// ---------------------------------------------------------------------------

describe('G7-19B Scenario 3: same content from multiple workers → no conflict', () => {
  it('does not invoke resolveConflict because aggregateArtifacts flags no conflict', () => {
    // All three workers wrote the same content. aggregateArtifacts
    // will flag conflict=false (one distinct hash). buildAggregatedRecords
    // therefore does NOT populate conflictResolution.
    const snaps: ArtifactSnapshot[] = [
      snap('worker-a', 'output.md', 'identical content'),
      snap('worker-b', 'output.md', 'identical content'),
      snap('worker-c', 'output.md', 'identical content'),
    ];
    const records = buildAggregatedRecords(snaps, false, new Set());

    // 3 records (one per worker), no conflict, no conflictResolution field.
    expect(records).toHaveLength(3);
    for (const r of records) {
      expect(r.conflict).toBeUndefined(); // no conflict
      expect(r.conflictResolution).toBeUndefined(); // no resolution needed
      expect(r.conflictVersions).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// SCENARIO 4 — Empty input
// ---------------------------------------------------------------------------

describe('G7-19B Scenario 4: empty input', () => {
  it('resolveConflict returns empty authoritative fields with "no versions" rationale', () => {
    const result = resolveConflict([]);
    expect(result.policy).toBe(CONFLICT_RESOLUTION_POLICY);
    expect(result.authoritativeWorkerId).toBe('');
    expect(result.authoritativeContentHash).toBe('');
    expect(result.rationale).toBe('no versions to resolve');
  });

  it('buildAggregatedRecords returns empty array for empty input', () => {
    const records = buildAggregatedRecords([], false, new Set());
    expect(records).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// SCENARIO 5 — A single worker (no conflict possible)
// ---------------------------------------------------------------------------

describe('G7-19B Scenario 5: single worker, no conflict', () => {
  it('does not populate conflictResolution when there is only one version', () => {
    const snaps: ArtifactSnapshot[] = [
      snap('worker-a', 'output.md', 'only content'),
    ];
    const records = buildAggregatedRecords(snaps, false, new Set());

    expect(records).toHaveLength(1);
    expect(records[0].conflict).toBeUndefined();
    expect(records[0].conflictResolution).toBeUndefined();
    expect(records[0].conflictVersions).toBeUndefined();
    // contentHash IS populated (inlined content).
    expect(typeof records[0].contentHash).toBe('string');
    expect((records[0].contentHash as string).length).toBe(64);
  });
});

// ---------------------------------------------------------------------------
// SCENARIO 6 — A 10-worker conflict (large-scale determinism)
// ---------------------------------------------------------------------------

describe('G7-19B Scenario 6: 10-worker conflict', () => {
  it('handles a 4+3+2+1 split deterministically (plurality wins)', () => {
    // 10 workers, 4 distinct content hashes, with vote counts [4, 3, 2, 1].
    // The hash with 4 votes is the unique plurality winner.
    const snaps: ArtifactSnapshot[] = [];
    // 4 workers write "content-D" (the plurality winner)
    for (const w of ['worker-04', 'worker-05', 'worker-06', 'worker-07']) {
      snaps.push(snap(w, 'output.md', 'content-D'));
    }
    // 3 workers write "content-C"
    for (const w of ['worker-08', 'worker-09', 'worker-10']) {
      snaps.push(snap(w, 'output.md', 'content-C'));
    }
    // 2 workers write "content-B"
    for (const w of ['worker-02', 'worker-03']) {
      snaps.push(snap(w, 'output.md', 'content-B'));
    }
    // 1 worker writes "content-A"
    snaps.push(snap('worker-01', 'output.md', 'content-A'));

    const versions = toVersions(snaps);
    const result = resolveConflict(versions);

    expect(result.policy).toBe(CONFLICT_RESOLUTION_POLICY);
    // Plurality: 4 of 10 versions have "content-D" hash. Lexicographically
    // smallest workerId among the 4 winners is "worker-04".
    expect(result.authoritativeWorkerId).toBe('worker-04');
    expect(result.rationale).toContain('majority vote');
    expect(result.rationale).toContain('4 of 10 versions agree');
  });

  it('handles a 5+5 tie deterministically (lexicographic fallback)', () => {
    // 10 workers, 2 distinct content hashes, with vote counts [5, 5].
    // Tier 1 fails (tie), so Tier 2 lexicographic fallback applies.
    const snaps: ArtifactSnapshot[] = [];
    // 5 workers write "content-X"
    for (const w of ['worker-01', 'worker-03', 'worker-05', 'worker-07', 'worker-09']) {
      snaps.push(snap(w, 'output.md', 'content-X'));
    }
    // 5 workers write "content-Y"
    for (const w of ['worker-02', 'worker-04', 'worker-06', 'worker-08', 'worker-10']) {
      snaps.push(snap(w, 'output.md', 'content-Y'));
    }

    const versions = toVersions(snaps);
    const result = resolveConflict(versions);

    expect(result.policy).toBe(CONFLICT_RESOLUTION_POLICY);
    // Tie → lexicographic fallback → smallest workerId among ALL is "worker-01".
    expect(result.authoritativeWorkerId).toBe('worker-01');
    expect(result.rationale).toContain('no majority');
    expect(result.rationale).toContain('2 distinct versions');
    expect(result.rationale).toContain('lexicographic workerId');
  });
});

// ---------------------------------------------------------------------------
// SCENARIO 7 — The exact G7-18E conflict matrix
// ---------------------------------------------------------------------------

describe('G7-19B Scenario 7: G7-18E exact conflict matrix', () => {
  it('resolves README.md (2+1 split) via majority vote', () => {
    // README.md: se-1 (baseline), dw-2 (different), gw-3 (baseline).
    // Majority = baseline, written by se-1 and gw-3. Smallest workerId
    // among the winners: "generalist-worker-3" < "software-engineer-1".
    const snaps: ArtifactSnapshot[] = [
      snap('software-engineer-1', 'README.md', 'baseline content'),
      snap('documentation-writer-2', 'README.md', 'documentation-writer README'),
      snap('generalist-worker-3', 'README.md', 'baseline content'),
    ];
    const versions = toVersions(snaps);
    const result = resolveConflict(versions);

    expect(result.policy).toBe(CONFLICT_RESOLUTION_POLICY);
    // 2 of 3 versions have the baseline hash. Lexicographically smallest
    // workerId among the winners is "generalist-worker-3".
    expect(result.authoritativeWorkerId).toBe('generalist-worker-3');
    expect(result.rationale).toContain('majority vote');
    expect(result.rationale).toContain('2 of 3 versions agree');
  });

  it('resolves test/api.test.js (3-way conflict) via lexicographic fallback', () => {
    // test/api.test.js: se-1 (repaired), dw-2 (different), gw-3 (baseline).
    // 3 distinct hashes, no majority → lexicographic fallback.
    const snaps: ArtifactSnapshot[] = [
      snap('software-engineer-1', 'test/api.test.js', 'se-1 repair'),
      snap('documentation-writer-2', 'test/api.test.js', 'documentation-writer repair'),
      snap('generalist-worker-3', 'test/api.test.js', 'baseline content'),
    ];
    const versions = toVersions(snaps);
    const result = resolveConflict(versions);

    expect(result.policy).toBe(CONFLICT_RESOLUTION_POLICY);
    // 3 distinct hashes → Tier 2 lexicographic fallback.
    // Lexicographically smallest workerId among ALL:
    //   "documentation-writer-2" < "generalist-worker-3" < "software-engineer-1"
    expect(result.authoritativeWorkerId).toBe('documentation-writer-2');
    expect(result.rationale).toContain('no majority');
    expect(result.rationale).toContain('3 distinct versions');
    expect(result.rationale).toContain('lexicographic workerId');
  });

  it('resolves the full 9-path G7-18E matrix consistently', () => {
    // The full G7-18E conflict matrix:
    // - README.md: 2+1 split (majority = baseline by se-1+gw-3)
    // - package.json: 2+1 split (majority = baseline by se-1+gw-3)
    // - public/*: 3 unanimous (no conflict)
    // - server.js: 3 unanimous (no conflict)
    // - test/api.test.js: 3-way (no majority)
    // - test/db.test.js, test/integration.test.js: 3 unanimous (no conflict)
    const baseline = 'baseline content';
    const snaps: ArtifactSnapshot[] = [
      // README.md — 2+1 split
      snap('software-engineer-1', 'README.md', baseline),
      snap('documentation-writer-2', 'README.md', 'documentation-writer README'),
      snap('generalist-worker-3', 'README.md', baseline),
      // package.json — 2+1 split
      snap('software-engineer-1', 'package.json', baseline),
      snap('documentation-writer-2', 'package.json', 'documentation-writer package'),
      snap('generalist-worker-3', 'package.json', baseline),
      // public/* — unanimous (no conflict)
      snap('software-engineer-1', 'public/app.js', baseline),
      snap('documentation-writer-2', 'public/app.js', baseline),
      snap('generalist-worker-3', 'public/app.js', baseline),
      snap('software-engineer-1', 'public/index.html', baseline),
      snap('documentation-writer-2', 'public/index.html', baseline),
      snap('generalist-worker-3', 'public/index.html', baseline),
      snap('software-engineer-1', 'public/styles.css', baseline),
      snap('documentation-writer-2', 'public/styles.css', baseline),
      snap('generalist-worker-3', 'public/styles.css', baseline),
      // server.js — unanimous (no conflict)
      snap('software-engineer-1', 'server.js', baseline),
      snap('documentation-writer-2', 'server.js', baseline),
      snap('generalist-worker-3', 'server.js', baseline),
      // test/api.test.js — 3-way conflict
      snap('software-engineer-1', 'test/api.test.js', 'se-1 repair'),
      snap('documentation-writer-2', 'test/api.test.js', 'documentation-writer repair'),
      snap('generalist-worker-3', 'test/api.test.js', baseline),
      // test/db.test.js — unanimous (no conflict)
      snap('software-engineer-1', 'test/db.test.js', baseline),
      snap('documentation-writer-2', 'test/db.test.js', baseline),
      snap('generalist-worker-3', 'test/db.test.js', baseline),
      // test/integration.test.js — unanimous (no conflict)
      snap('software-engineer-1', 'test/integration.test.js', baseline),
      snap('documentation-writer-2', 'test/integration.test.js', baseline),
      snap('generalist-worker-3', 'test/integration.test.js', baseline),
    ];

    const records = buildAggregatedRecords(snaps, false, new Set());
    expect(records).toHaveLength(27);

    // For README.md: 3 records, all conflict=true, exactly ONE isAuthoritative=true.
    const readmeRecords = records.filter((r) => r.path === 'README.md');
    expect(readmeRecords).toHaveLength(3);
    expect(readmeRecords.every((r) => r.conflict === true)).toBe(true);
    expect(readmeRecords.every((r) => r.conflictResolution !== undefined)).toBe(true);
    const readmeAuth = readmeRecords.filter((r) => r.conflictResolution!.isAuthoritative);
    expect(readmeAuth).toHaveLength(1);
    expect(readmeAuth[0].workerId).toBe('generalist-worker-3');
    expect(readmeAuth[0].conflictResolution!.policy).toBe(CONFLICT_RESOLUTION_POLICY);
    expect(readmeAuth[0].conflictResolution!.authoritativeWorkerId).toBe('generalist-worker-3');
    expect(readmeAuth[0].conflictResolution!.rationale).toContain('majority vote');

    // For test/api.test.js: 3 records, all conflict=true, exactly ONE
    // isAuthoritative=true. Authoritative is documentation-writer-2
    // (lexicographically smallest workerId).
    const apiRecords = records.filter((r) => r.path === 'test/api.test.js');
    expect(apiRecords).toHaveLength(3);
    expect(apiRecords.every((r) => r.conflict === true)).toBe(true);
    const apiAuth = apiRecords.filter((r) => r.conflictResolution!.isAuthoritative);
    expect(apiAuth).toHaveLength(1);
    expect(apiAuth[0].workerId).toBe('documentation-writer-2');
    expect(apiAuth[0].conflictResolution!.authoritativeWorkerId).toBe('documentation-writer-2');
    expect(apiAuth[0].conflictResolution!.rationale).toContain('no majority');
    expect(apiAuth[0].conflictResolution!.rationale).toContain('3 distinct versions');

    // For public/app.js: 3 records, NO conflict, no conflictResolution.
    const pubAppRecords = records.filter((r) => r.path === 'public/app.js');
    expect(pubAppRecords).toHaveLength(3);
    expect(pubAppRecords.every((r) => r.conflict === undefined)).toBe(true);
    expect(pubAppRecords.every((r) => r.conflictResolution === undefined)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// SCENARIO 8 — Determinism: same inputs → same output
// ---------------------------------------------------------------------------

describe('G7-19B Scenario 8: determinism (no random selection)', () => {
  it('produces the same chosen version across multiple runs with shuffled input', () => {
    // Same 3-way conflict, but presented in different orders.
    const contentA = 'content A';
    const contentB = 'content B';
    const contentC = 'content C';
    const snaps1: ArtifactSnapshot[] = [
      snap('worker-a', 'output.md', contentA),
      snap('worker-b', 'output.md', contentB),
      snap('worker-c', 'output.md', contentC),
    ];
    const snaps2: ArtifactSnapshot[] = [
      snap('worker-c', 'output.md', contentC),
      snap('worker-a', 'output.md', contentA),
      snap('worker-b', 'output.md', contentB),
    ];
    const snaps3: ArtifactSnapshot[] = [
      snap('worker-b', 'output.md', contentB),
      snap('worker-c', 'output.md', contentC),
      snap('worker-a', 'output.md', contentA),
    ];

    const r1 = resolveConflict(toVersions(snaps1));
    const r2 = resolveConflict(toVersions(snaps2));
    const r3 = resolveConflict(toVersions(snaps3));

    // All three runs produce identical output (same workerId, same hash,
    // same rationale). The order of inputs does not affect the result.
    expect(r1.authoritativeWorkerId).toBe(r2.authoritativeWorkerId);
    expect(r2.authoritativeWorkerId).toBe(r3.authoritativeWorkerId);
    expect(r1.authoritativeContentHash).toBe(r2.authoritativeContentHash);
    expect(r2.authoritativeContentHash).toBe(r3.authoritativeContentHash);
    expect(r1.rationale).toBe(r2.rationale);
    expect(r2.rationale).toBe(r3.rationale);

    // The chosen workerId is worker-a (lexicographically smallest).
    expect(r1.authoritativeWorkerId).toBe('worker-a');
  });

  it('produces the same chosen version for the 2+1 split across multiple runs', () => {
    // Same 2+1 split, presented in different orders.
    const shared = 'shared content';
    const different = 'different content';
    const snaps1: ArtifactSnapshot[] = [
      snap('worker-a', 'output.md', shared),
      snap('worker-b', 'output.md', different),
      snap('worker-c', 'output.md', shared),
    ];
    const snaps2: ArtifactSnapshot[] = [
      snap('worker-c', 'output.md', shared),
      snap('worker-a', 'output.md', shared),
      snap('worker-b', 'output.md', different),
    ];

    const r1 = resolveConflict(toVersions(snaps1));
    const r2 = resolveConflict(toVersions(snaps2));

    expect(r1.authoritativeWorkerId).toBe(r2.authoritativeWorkerId);
    expect(r1.authoritativeContentHash).toBe(r2.authoritativeContentHash);
    expect(r1.rationale).toBe(r2.rationale);

    // Majority: 2 of 3 have the shared hash. Smallest workerId among
    // the winners is worker-a.
    expect(r1.authoritativeWorkerId).toBe('worker-a');
  });
});

// ---------------------------------------------------------------------------
// SCENARIO 9 — All conflicting versions remain accessible (audit trail)
// ---------------------------------------------------------------------------

describe('G7-19B Scenario 9: audit trail preservation', () => {
  it('preserves all conflicting versions in conflictVersions + identifies the authoritative one in conflictResolution', () => {
    // 3 workers wrote 3 different versions of output.md.
    const snaps: ArtifactSnapshot[] = [
      snap('worker-a', 'output.md', 'content A'),
      snap('worker-b', 'output.md', 'content B'),
      snap('worker-c', 'output.md', 'content C'),
    ];
    const records = buildAggregatedRecords(snaps, false, new Set());

    expect(records).toHaveLength(3);

    // Every record has conflict=true, conflictVersions populated,
    // and conflictResolution populated.
    for (const r of records) {
      expect(r.conflict).toBe(true);
      expect(r.conflictVersions).toBeDefined();
      expect(r.conflictVersions).toHaveLength(2); // the other 2 versions
      expect(r.conflictResolution).toBeDefined();
      expect(r.conflictResolution!.policy).toBe(CONFLICT_RESOLUTION_POLICY);
    }

    // Exactly ONE record is authoritative (isAuthoritative=true).
    const auth = records.filter((r) => r.conflictResolution!.isAuthoritative);
    expect(auth).toHaveLength(1);
    expect(auth[0].workerId).toBe('worker-a'); // lexicographically smallest

    // The other 2 records are NOT authoritative.
    const nonAuth = records.filter((r) => !r.conflictResolution!.isAuthoritative);
    expect(nonAuth).toHaveLength(2);
    for (const r of nonAuth) {
      expect(r.conflictResolution!.isAuthoritative).toBe(false);
      // But they still carry the same authoritativeWorkerId, so the caller
      // can identify the chosen version from any record.
      expect(r.conflictResolution!.authoritativeWorkerId).toBe('worker-a');
    }

    // The authoritative record's contentHash matches the conflictResolution's
    // authoritativeContentHash.
    expect(auth[0].contentHash).toBe(auth[0].conflictResolution!.authoritativeContentHash);

    // All 3 versions are accessible via conflictVersions on any record.
    // From worker-a's record, conflictVersions lists worker-b and worker-c.
    const workerARecord = records.find((r) => r.workerId === 'worker-a')!;
    const otherWorkerIds = workerARecord.conflictVersions!.map((v) => v.workerId).sort();
    expect(otherWorkerIds).toEqual(['worker-b', 'worker-c']);

    // The conflictVersions entries carry contentHash + bytes (audit trail).
    for (const v of workerARecord.conflictVersions!) {
      expect(typeof v.contentHash).toBe('string');
      expect(v.contentHash.length).toBe(64); // SHA-256 hex
      expect(typeof v.bytes).toBe('number');
    }
  });
});

// ---------------------------------------------------------------------------
// BONUS — Verify the policy name constant is exported
// ---------------------------------------------------------------------------

describe('G7-19B bonus: policy name constant', () => {
  it('exports CONFLICT_RESOLUTION_POLICY = "majority-then-lexicographic"', () => {
    expect(CONFLICT_RESOLUTION_POLICY).toBe('majority-then-lexicographic');
  });
});
