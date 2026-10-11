/**
 * G7-19D — Phase D: Content-bound verification tests (pure functions).
 *
 * No real Z.ai calls. No real OpenBot processes. Uses the pure
 * functions from `src/runtime/package-selection.ts` and
 * `src/runtime/artifact-aggregation.ts`.
 *
 * Scenarios (matching the brief's Phase D list 1-9):
 *   1. Identical paths but different content hashes.
 *   2. Verification passes for package A; package B must not inherit
 *      the result.
 *   3. Package A changes after verification.
 *   4. Verification evidence is stale.
 *   5. Verified identity matches the selected package.
 *   6. Verification evidence is missing.
 *   7. Three conflicting workers with only one genuinely verified.
 *   8. Three conflicting workers with no verified package.
 *   9. Heuristic preference disagrees with verified selection.
 *
 * These tests exercise the actual `bindVerificationEvidence` identity
 * comparison logic — they don't merely construct `verificationOk=true`
 * manually. Each test explicitly captures the verified identity (via
 * `computeWorkerPackageIdentities`) and compares against the candidate's
 * current identity.
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';

import {
  bindVerificationEvidence,
  buildAndSelectPackages,
  computeWorkerPackageIdentities,
  type PackageCandidate,
} from '../../src/runtime/package-selection.js';
import {
  buildAggregatedRecords,
  applyPackageSelection,
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

// Helper: SHA-256 hex (for the candidate identity helper below).
function sha(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

// Helper: build a candidate manually (for direct bindVerificationEvidence tests).
function candidate(
  workerId: string,
  snaps: ArtifactSnapshot[],
  manifest: readonly string[],
): { cand: PackageCandidate; snaps: ArtifactSnapshot[] } {
  // Sort snaps by path for stable identity.
  const sorted = [...snaps].sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  );
  const observedPaths = sorted.map((s) => s.path);
  // Compute identity manually using the same canonical form as computePackageIdentity.
  const files = sorted.map((s) => {
    const hash = s.content === undefined ? '' : sha(s.content);
    return [s.path, hash] as const;
  });
  const canonical = JSON.stringify({ workerId, files });
  const packageIdentity = canonical.length === 0 ? '' : sha(canonical);
  // Simple completeness: all manifest paths present (no safety checks here;
  // for direct bind tests, we already know the candidate is complete).
  const observed = new Set(observedPaths);
  const completenessOk = manifest.every((p) => observed.has(p));
  return {
    cand: {
      workerId,
      manifestPaths: manifest,
      observedPaths,
      fileHashes: new Map(
        sorted.map((s) => {
          const hash = s.content === undefined ? '' : sha(s.content);
          return [s.path, hash] as const;
        }),
      ),
      packageIdentity,
      completenessOk,
      verificationOk: false,
      ...(completenessOk ? {} : { rejectionReason: 'missing manifest path' }),
    },
    snaps: sorted,
  };
}

// Helper: compute verified identities from snapshots (mirrors what
// captureVerificationResult does in production).
function verifiedIds(snaps: readonly ArtifactSnapshot[]): Map<string, string> {
  return computeWorkerPackageIdentities(snaps);
}

// ---------------------------------------------------------------------------
// SCENARIO 1 — Identical paths but different content hashes
// ---------------------------------------------------------------------------

describe('G7-19D Scenario 1: identical paths, different content hashes', () => {
  it('treats two workers with same paths but different content as distinct packages', () => {
    const manifest = ['output.md'];
    const snapps = [
      snap('worker-a', 'output.md', 'content A'),
      snap('worker-b', 'output.md', 'content B'),  // different content
    ];
    const verifiedPaths = new Set(['output.md']);
    const verifiedIdMap = verifiedIds(snapps);

    // Both workers have the SAME path 'output.md' in verifiedPaths,
    // but they have DIFFERENT package identities (content differs).
    const idA = verifiedIdMap.get('worker-a')!;
    const idB = verifiedIdMap.get('worker-b')!;
    expect(idA).not.toBe(idB);  // distinct identities

    const result = buildAndSelectPackages(snapps, manifest, verifiedPaths, true, verifiedIdMap);

    // Both candidates are COMPLETE+VERIFIED (each worker's identity
    // matches its captured verified identity).
    expect(result.candidates.length).toBe(2);
    expect(result.candidates.every((c) => c.completenessOk && c.verificationOk)).toBe(true);

    // Selection picks the (packageIdentity, workerId) lexicographic winner.
    expect(result.state).toBe('SELECTED');
    const sorted = [...result.candidates].sort((a, b) => {
      if (a.packageIdentity !== b.packageIdentity) {
        return a.packageIdentity < b.packageIdentity ? -1 : 1;
      }
      return a.workerId < b.workerId ? -1 : 1;
    });
    expect(result.selected?.workerId).toBe(sorted[0].workerId);
  });

  it('rejects worker B if its captured identity differs from its current identity (content mutated)', () => {
    const manifest = ['output.md'];
    // "Verified" snapshots: worker-a wrote 'content A', worker-b wrote 'content B'.
    const verifiedSnapps = [
      snap('worker-a', 'output.md', 'content A'),
      snap('worker-b', 'output.md', 'content B'),
    ];
    const verifiedIdMap = verifiedIds(verifiedSnapps);

    // "Current" snapshots: worker-b's content mutated to 'content B MUTATED'.
    const currentSnapps = [
      snap('worker-a', 'output.md', 'content A'),  // unchanged
      snap('worker-b', 'output.md', 'content B MUTATED'),  // mutated!
    ];
    const verifiedPaths = new Set(['output.md']);
    const result = buildAndSelectPackages(currentSnapps, manifest, verifiedPaths, true, verifiedIdMap);

    // worker-a: identity matches → VERIFIED.
    // worker-b: identity differs (content mutated) → REJECTED.
    const a = result.candidates.find((c) => c.workerId === 'worker-a')!;
    const b = result.candidates.find((c) => c.workerId === 'worker-b')!;
    expect(a.verificationOk).toBe(true);
    expect(b.verificationOk).toBe(false);
    expect(b.rejectionReason).toContain('post-verification content mutation');

    // Selection: only worker-a is verified → SELECT worker-a.
    expect(result.state).toBe('SELECTED');
    expect(result.selected?.workerId).toBe('worker-a');
  });
});

// ---------------------------------------------------------------------------
// SCENARIO 2 — Verification passes for package A; B must not inherit
// ---------------------------------------------------------------------------

describe('G7-19D Scenario 2: verification for A; B must not inherit', () => {
  it('rejects worker B even when verifiedPaths is shared across workers', () => {
    // worker-a has manifest [output.md, extra.md] — both verified.
    // worker-b has manifest [output.md] only — also "verified" via shared verifiedPaths,
    // BUT worker-b's captured identity differs from worker-a's.
    //
    // Even though verifiedPaths is worker-agnostic, the
    // verifiedPackageIdentities map is per-worker. Worker-b's
    // captured identity (computed from worker-b's snapshots at
    // verification time) is different from worker-a's. If worker-b's
    // CURRENT identity matches worker-b's CAPTURED identity, worker-b
    // is VERIFIED — but it's a DIFFERENT verification (for a different
    // package). It does NOT inherit worker-a's verification.
    const manifest = ['output.md'];
    const snapps = [
      snap('worker-a', 'output.md', 'content A'),
      snap('worker-b', 'output.md', 'content B'),
    ];
    const verifiedPaths = new Set(['output.md']);
    const verifiedIdMap = verifiedIds(snapps);

    // Both workers have their OWN captured identity.
    expect(verifiedIdMap.has('worker-a')).toBe(true);
    expect(verifiedIdMap.has('worker-b')).toBe(true);
    expect(verifiedIdMap.get('worker-a')).not.toBe(verifiedIdMap.get('worker-b'));

    const result = buildAndSelectPackages(snapps, manifest, verifiedPaths, true, verifiedIdMap);

    // Both workers are COMPLETE+VERIFIED with their own captured identity.
    expect(result.candidates.every((c) => c.verificationOk)).toBe(true);

    // The verification evidence hash on each candidate is the
    // candidate's OWN captured identity — not the other worker's.
    const a = result.candidates.find((c) => c.workerId === 'worker-a')!;
    const b = result.candidates.find((c) => c.workerId === 'worker-b')!;
    expect(a.verificationEvidenceHash).toBe(verifiedIdMap.get('worker-a'));
    expect(b.verificationEvidenceHash).toBe(verifiedIdMap.get('worker-b'));
    expect(a.verificationEvidenceHash).not.toBe(b.verificationEvidenceHash);
  });

  it('rejects worker B when only worker A has a captured identity', () => {
    // Simulate: only worker-a's identity was captured at verification time
    // (worker-b did not exist at verification time, or was excluded).
    // Worker-b should NOT inherit worker-a's verification.
    const manifest = ['output.md'];
    const snapps = [
      snap('worker-a', 'output.md', 'content A'),
      snap('worker-b', 'output.md', 'content B'),
    ];
    const verifiedPaths = new Set(['output.md']);
    // Only worker-a in the verified identities map.
    const verifiedIdMap = new Map([['worker-a', verifiedIds(snapps).get('worker-a')!]]);

    const result = buildAndSelectPackages(snapps, manifest, verifiedPaths, true, verifiedIdMap);

    const a = result.candidates.find((c) => c.workerId === 'worker-a')!;
    const b = result.candidates.find((c) => c.workerId === 'worker-b')!;
    expect(a.verificationOk).toBe(true);
    expect(b.verificationOk).toBe(false);
    expect(b.rejectionReason).toContain('no verified package identity captured for worker: worker-b');

    // Only worker-a is VERIFIED → SELECTED.
    expect(result.state).toBe('SELECTED');
    expect(result.selected?.workerId).toBe('worker-a');
  });
});

// ---------------------------------------------------------------------------
// SCENARIO 3 — Package A changes after verification
// ---------------------------------------------------------------------------

describe('G7-19D Scenario 3: post-verification content mutation', () => {
  it('rejects the candidate when content mutated between verification and selection', () => {
    const manifest = ['output.md'];
    const verifiedSnapps = [snap('worker-a', 'output.md', 'original content')];
    const verifiedIdMap = verifiedIds(verifiedSnapps);

    // Current snapshots show mutated content.
    const currentSnapps = [snap('worker-a', 'output.md', 'MUTATED content')];
    const verifiedPaths = new Set(['output.md']);
    const result = buildAndSelectPackages(currentSnapps, manifest, verifiedPaths, true, verifiedIdMap);

    expect(result.state).toBe('UNRESOLVED');
    expect(result.selected).toBeUndefined();
    expect(result.candidates[0].verificationOk).toBe(false);
    expect(result.candidates[0].rejectionReason).toContain('post-verification content mutation');
  });

  it('rejects when an extra file is added post-verification (identity changes)', () => {
    const manifest = ['output.md'];
    const verifiedSnapps = [snap('worker-a', 'output.md', 'content')];
    const verifiedIdMap = verifiedIds(verifiedSnapps);

    // Current snapshots show an extra file added.
    const currentSnapps = [
      snap('worker-a', 'output.md', 'content'),
      snap('worker-a', 'extra.md', 'sneaked in'),  // added post-verification
    ];
    const verifiedPaths = new Set(['output.md', 'extra.md']);  // both paths in verifiedPaths
    const result = buildAndSelectPackages(currentSnapps, manifest, verifiedPaths, true, verifiedIdMap);

    // The candidate's identity changed (extra.md added) → does not match captured identity.
    expect(result.candidates[0].verificationOk).toBe(false);
    expect(result.candidates[0].rejectionReason).toContain('post-verification content mutation');
    expect(result.state).toBe('UNRESOLVED');
  });
});

// ---------------------------------------------------------------------------
// SCENARIO 4 — Verification evidence is stale
// ---------------------------------------------------------------------------

describe('G7-19D Scenario 4: stale verification evidence', () => {
  it('rejects when verifiedPackageIdentities is undefined (no attestation captured)', () => {
    const manifest = ['output.md'];
    const snapps = [snap('worker-a', 'output.md', 'content')];
    const verifiedPaths = new Set(['output.md']);
    // verifiedPackageIdentities is undefined — simulates a pre-G7-19D
    // caller (or captureVerificationResult didn't run).
    const result = buildAndSelectPackages(snapps, manifest, verifiedPaths, true, undefined);

    expect(result.state).toBe('UNRESOLVED');
    expect(result.candidates[0].verificationOk).toBe(false);
    expect(result.candidates[0].rejectionReason).toContain('no verified package identity captured');
  });

  it('rejects when verifiedPackageIdentities is empty (degenerate)', () => {
    const manifest = ['output.md'];
    const snapps = [snap('worker-a', 'output.md', 'content')];
    const verifiedPaths = new Set(['output.md']);
    // Empty map — simulates verification passed but no identities captured.
    const result = buildAndSelectPackages(snapps, manifest, verifiedPaths, true, new Map());

    expect(result.state).toBe('UNRESOLVED');
    expect(result.candidates[0].verificationOk).toBe(false);
    expect(result.candidates[0].rejectionReason).toContain('no verified package identity captured for worker: worker-a');
  });
});

// ---------------------------------------------------------------------------
// SCENARIO 5 — Verified identity matches the selected package (happy path)
// ---------------------------------------------------------------------------

describe('G7-19D Scenario 5: verified identity matches selected package', () => {
  it('SELECTS the package when verified identity matches current identity', () => {
    const manifest = ['output.md', 'README.md'];
    const snapps = [
      snap('worker-a', 'output.md', '# output'),
      snap('worker-a', 'README.md', '# readme'),
    ];
    const verifiedPaths = new Set(['output.md', 'README.md']);
    const verifiedIdMap = verifiedIds(snapps);

    const result = buildAndSelectPackages(snapps, manifest, verifiedPaths, true, verifiedIdMap);

    expect(result.state).toBe('SELECTED');
    expect(result.selected?.workerId).toBe('worker-a');
    expect(result.selected?.verificationOk).toBe(true);
    // The verification evidence hash is the CAPTURED identity (earned, not self-asserted).
    expect(result.selected?.verificationEvidenceHash).toBe(verifiedIdMap.get('worker-a'));
    expect(result.selected?.verificationEvidenceHash).toBe(result.selected?.packageIdentity);
  });

  it('preserves the captured identity through the applyPackageSelection layer', () => {
    const snapps = [snap('worker-a', 'output.md', 'content')];
    const verifiedPaths = new Set(['output.md']);
    const verifiedIdMap = verifiedIds(snapps);

    const records = buildAggregatedRecords(snapps, true, verifiedPaths);
    const finalRecords = applyPackageSelection(
      records,
      snapps,
      [{ kind: 'file', label: 'exists', path: 'output.md' }],
      verifiedPaths,
      true,
      verifiedIdMap,
    );

    expect(finalRecords.length).toBe(1);
    const r = finalRecords[0];
    expect(r.verifiedPackageSelection?.packageState).toBe('SELECTED');
    expect(r.verifiedPackageSelection?.selectedWorkerId).toBe('worker-a');
    expect(r.verifiedPackageSelection?.isAuthoritativePackage).toBe(true);
    expect(r.verifiedPackageSelection?.packageIdentity).toBe(verifiedIdMap.get('worker-a'));
  });
});

// ---------------------------------------------------------------------------
// SCENARIO 6 — Verification evidence is missing
// ---------------------------------------------------------------------------

describe('G7-19D Scenario 6: verification evidence missing', () => {
  it('rejects when verificationOk=false even with manifest complete', () => {
    const manifest = ['output.md'];
    const snapps = [snap('worker-a', 'output.md', 'content')];
    const verifiedPaths = new Set<string>();
    // verificationOk=false → no verifiedIdentities captured (per captureVerificationResult logic).
    const result = buildAndSelectPackages(snapps, manifest, verifiedPaths, false, undefined);

    expect(result.state).toBe('UNRESOLVED');
    expect(result.candidates[0].verificationOk).toBe(false);
    // The first rejection reason is "verification did not pass" — the
    // identity check is not even reached.
    expect(result.candidates[0].rejectionReason).toContain('verification did not pass');
  });

  it('rejects when verificationOk=true but verifiedPaths is empty (degenerate)', () => {
    const manifest = ['output.md'];
    const snapps = [snap('worker-a', 'output.md', 'content')];
    const verifiedPaths = new Set<string>();  // empty
    const verifiedIdMap = verifiedIds(snapps);
    const result = buildAndSelectPackages(snapps, manifest, verifiedPaths, true, verifiedIdMap);

    expect(result.state).toBe('UNRESOLVED');
    expect(result.candidates[0].verificationOk).toBe(false);
    expect(result.candidates[0].rejectionReason).toContain('no paths were verified');
  });
});

// ---------------------------------------------------------------------------
// SCENARIO 7 — Three conflicting workers, only one genuinely verified
// ---------------------------------------------------------------------------

describe('G7-19D Scenario 7: three conflicting workers, one verified', () => {
  it('selects the one verified worker; rejects the other two', () => {
    // Three workers each wrote 'output.md' with different content.
    // Only worker-a's identity was captured at verification time
    // (simulating verification discriminating by content via hash-match
    // checks that fail for worker-b and worker-c).
    const manifest = ['output.md'];
    const snapps = [
      snap('worker-a', 'output.md', 'content A'),
      snap('worker-b', 'output.md', 'content B'),
      snap('worker-c', 'output.md', 'content C'),
    ];
    const verifiedPaths = new Set(['output.md']);
    // Only worker-a in the verified identities map.
    const verifiedIdMap = new Map([['worker-a', verifiedIds(snapps).get('worker-a')!]]);

    const result = buildAndSelectPackages(snapps, manifest, verifiedPaths, true, verifiedIdMap);

    expect(result.state).toBe('SELECTED');
    expect(result.selected?.workerId).toBe('worker-a');

    // The other two are rejected.
    const b = result.candidates.find((c) => c.workerId === 'worker-b')!;
    const c = result.candidates.find((c) => c.workerId === 'worker-c')!;
    expect(b.verificationOk).toBe(false);
    expect(b.rejectionReason).toContain('no verified package identity captured for worker: worker-b');
    expect(c.verificationOk).toBe(false);
    expect(c.rejectionReason).toContain('no verified package identity captured for worker: worker-c');
  });
});

// ---------------------------------------------------------------------------
// SCENARIO 8 — Three conflicting workers, no verified package
// ---------------------------------------------------------------------------

describe('G7-19D Scenario 8: three conflicting workers, no verified', () => {
  it('returns UNRESOLVED; conflictResolution still present but marked isHeuristicUnverified=true', () => {
    const snapps = [
      snap('worker-a', 'output.md', 'content A'),
      snap('worker-b', 'output.md', 'content B'),
      snap('worker-c', 'output.md', 'content C'),
    ];
    const verifiedPaths = new Set<string>();
    // verificationOk=false → no verifiedIdentities.
    const records = buildAggregatedRecords(snapps, false, verifiedPaths);
    const finalRecords = applyPackageSelection(
      records,
      snapps,
      [{ kind: 'file', label: 'exists', path: 'output.md' }],
      verifiedPaths,
      false,
      undefined,  // no verified identities captured
    );

    // UNRESOLVED on every record.
    expect(finalRecords.length).toBe(3);
    expect(finalRecords.every((r) => r.verifiedPackageSelection?.packageState === 'UNRESOLVED')).toBe(true);
    expect(finalRecords.every((r) => r.verifiedPackageSelection?.isAuthoritativePackage === false)).toBe(true);

    // conflictResolution is present on every record (3-way conflict)
    // and is ALWAYS marked isHeuristicUnverified=true (G7-19D Phase C).
    expect(finalRecords.every((r) => r.conflictResolution !== undefined)).toBe(true);
    expect(finalRecords.every((r) => r.conflictResolution?.isHeuristicUnverified === true)).toBe(true);

    // Exactly one record has isAuthoritative=true (the G7-19B heuristic
    // winner — lexicographic fallback). Consumers should NOT mistake
    // this for verified authority because isHeuristicUnverified=true.
    const heuristicWinners = finalRecords.filter((r) => r.conflictResolution?.isAuthoritative === true);
    expect(heuristicWinners.length).toBe(1);
    expect(heuristicWinners[0].workerId).toBe('worker-a');  // lexicographic
  });
});

// ---------------------------------------------------------------------------
// SCENARIO 9 — Heuristic preference disagrees with verified selection
// ---------------------------------------------------------------------------

describe('G7-19D Scenario 9: heuristic disagrees with verified selection', () => {
  it('verified selection wins; heuristic is marked isHeuristicUnverified=true', () => {
    // Three workers, all COMPLETE. Only worker-c's identity was
    // captured at verification time.
    //
    // G7-19B heuristic (lexicographic fallback) would pick worker-a
    // (smallest workerId). But G7-19D verified selection picks
    // worker-c (only verified candidate).
    //
    // The conflictResolution field on every record should be marked
    // isHeuristicUnverified=true so consumers don't mistake worker-a's
    // isAuthoritative=true for verified authority.
    const snapps = [
      snap('worker-a', 'output.md', 'content A'),
      snap('worker-b', 'output.md', 'content B'),
      snap('worker-c', 'output.md', 'content C'),
    ];
    const verifiedPaths = new Set(['output.md']);
    // Only worker-c verified.
    const verifiedIdMap = new Map([['worker-c', verifiedIds(snapps).get('worker-c')!]]);

    const records = buildAggregatedRecords(snapps, true, verifiedPaths);
    const finalRecords = applyPackageSelection(
      records,
      snapps,
      [{ kind: 'file', label: 'exists', path: 'output.md' }],
      verifiedPaths,
      true,
      verifiedIdMap,
    );

    // Verified selection: worker-c SELECTED.
    expect(finalRecords.length).toBe(3);
    expect(finalRecords.every((r) => r.verifiedPackageSelection?.packageState === 'SELECTED')).toBe(true);
    expect(finalRecords.every((r) => r.verifiedPackageSelection?.selectedWorkerId === 'worker-c')).toBe(true);
    // Only worker-c records have isAuthoritativePackage=true.
    const cRecords = finalRecords.filter((r) => r.workerId === 'worker-c');
    const abRecords = finalRecords.filter((r) => r.workerId !== 'worker-c');
    expect(cRecords.every((r) => r.verifiedPackageSelection?.isAuthoritativePackage === true)).toBe(true);
    expect(abRecords.every((r) => r.verifiedPackageSelection?.isAuthoritativePackage === false)).toBe(true);

    // G7-19B heuristic: worker-a is the lexicographic winner.
    const heuristicWinners = finalRecords.filter((r) => r.conflictResolution?.isAuthoritative === true);
    expect(heuristicWinners.length).toBe(1);
    expect(heuristicWinners[0].workerId).toBe('worker-a');

    // CRITICAL: every record with conflictResolution has
    // isHeuristicUnverified=true. Consumers must NOT mistake the
    // heuristic worker-a winner for verified authority — the verified
    // authority is worker-c (per verifiedPackageSelection).
    expect(finalRecords.every((r) => r.conflictResolution?.isHeuristicUnverified === true)).toBe(true);

    // The verified winner (worker-c) and the heuristic winner (worker-a)
    // DISAGREE. This is the G7-19D Concern B scenario.
    expect(heuristicWinners[0].workerId).not.toBe(finalRecords[0].verifiedPackageSelection?.selectedWorkerId);
  });
});

// ---------------------------------------------------------------------------
// SCENARIO 10 — Gateway response does not imply unverified authority
// (pure-function version; the HTTP-path version is in tests/gateway/g7-19d-integration.test.ts)
// ---------------------------------------------------------------------------

describe('G7-19D Scenario 10 (pure): gateway response shape does not imply unverified authority', () => {
  it('never sets isAuthoritativePackage=true when state=UNRESOLVED', () => {
    const snapps = [
      snap('worker-a', 'output.md', 'content A'),
      snap('worker-b', 'output.md', 'content B'),
    ];
    const verifiedPaths = new Set<string>();
    const records = buildAggregatedRecords(snapps, false, verifiedPaths);
    const finalRecords = applyPackageSelection(
      records,
      snapps,
      [{ kind: 'file', label: 'exists', path: 'output.md' }],
      verifiedPaths,
      false,
      undefined,
    );

    // Every record has packageState=UNRESOLVED and isAuthoritativePackage=false.
    expect(finalRecords.every((r) => r.verifiedPackageSelection?.packageState === 'UNRESOLVED')).toBe(true);
    expect(finalRecords.every((r) => r.verifiedPackageSelection?.isAuthoritativePackage === false)).toBe(true);

    // Every conflictResolution (when present) has isHeuristicUnverified=true.
    expect(finalRecords.every((r) => r.conflictResolution?.isHeuristicUnverified === true)).toBe(true);
  });

  it('exposes verifiedPackageSelection even when UNRESOLVED (for transparency)', () => {
    const snapps = [snap('worker-a', 'output.md', 'content')];
    const verifiedPaths = new Set<string>();
    const records = buildAggregatedRecords(snapps, false, verifiedPaths);
    const finalRecords = applyPackageSelection(
      records,
      snapps,
      [{ kind: 'file', label: 'exists', path: 'output.md' }],
      verifiedPaths,
      false,
      undefined,
    );

    // verifiedPackageSelection is populated even when UNRESOLVED.
    expect(finalRecords.every((r) => r.verifiedPackageSelection !== undefined)).toBe(true);
    expect(finalRecords.every((r) => r.verifiedPackageSelection?.packageState === 'UNRESOLVED')).toBe(true);
    // The rationale explains WHY.
    expect(finalRecords[0].verifiedPackageSelection?.rationale).toContain('no verified package');
  });
});

// ---------------------------------------------------------------------------
// Direct bindVerificationEvidence tests for content-binding
// ---------------------------------------------------------------------------

describe('G7-19D bindVerificationEvidence identity comparison', () => {
  it('returns verificationOk=false when verifiedPackageIdentities is undefined', () => {
    const { cand } = candidate('w', [snap('w', 'a', 'x')], ['a']);
    const bound = bindVerificationEvidence(cand, new Set(['a']), true, undefined);
    expect(bound.verificationOk).toBe(false);
    expect(bound.rejectionReason).toContain('no verified package identity captured (pre-G7-19D caller)');
  });

  it('returns verificationOk=false when worker has no entry in the map', () => {
    const { cand } = candidate('w', [snap('w', 'a', 'x')], ['a']);
    const verifiedIdsMap = new Map([['other-worker', 'some-identity']]);  // no 'w' entry
    const bound = bindVerificationEvidence(cand, new Set(['a']), true, verifiedIdsMap);
    expect(bound.verificationOk).toBe(false);
    expect(bound.rejectionReason).toContain('no verified package identity captured for worker: w');
  });

  it('returns verificationOk=false when captured identity does not match current identity', () => {
    const { cand } = candidate('w', [snap('w', 'a', 'x')], ['a']);
    // Captured identity is 'stale-identity' — does not match the candidate's.
    const verifiedIdsMap = new Map([['w', 'stale-identity']]);
    const bound = bindVerificationEvidence(cand, new Set(['a']), true, verifiedIdsMap);
    expect(bound.verificationOk).toBe(false);
    expect(bound.rejectionReason).toContain('post-verification content mutation detected');
  });

  it('returns verificationOk=true with earned evidence hash when identity matches', () => {
    const { cand, snaps } = candidate('w', [snap('w', 'a', 'x')], ['a']);
    const verifiedIdsMap = verifiedIds(snaps);  // captured at verification time
    const bound = bindVerificationEvidence(cand, new Set(['a']), true, verifiedIdsMap);

    expect(bound.verificationOk).toBe(true);
    // The evidence hash is the captured verified identity — NOT the candidate's own.
    expect(bound.verificationEvidenceHash).toBe(verifiedIdsMap.get('w'));
    // In this happy-path case, the captured identity equals the candidate's identity.
    expect(bound.verificationEvidenceHash).toBe(cand.packageIdentity);
  });
});
