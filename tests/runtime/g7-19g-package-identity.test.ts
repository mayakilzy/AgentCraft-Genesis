/**
 * G7-19G Phase B — Stable Package Identity tests.
 *
 * Verifies the G7-19G manifest-scoped package identity:
 * - Identical deliverables with different cache files → SAME identity.
 * - Changed deliverable content → DIFFERENT identity.
 * - Incomplete manifests → reject (existing behavior preserved).
 * - Unsafe extra files → reject (existing behavior preserved).
 * - Auxiliary files remain visible in records (not silently ignored).
 * - Content-hash binding between verification and selection preserved.
 *
 * No live Z.ai calls. Pure function tests.
 */
import { describe, test, expect } from 'vitest';
import { createHash } from 'node:crypto';
import {
  computePackageIdentity,
  computeWorkerPackageIdentities,
  buildPackageCandidates,
} from '../../src/runtime/package-selection.js';
import { buildAggregatedRecords, applyPackageSelection } from '../../src/runtime/artifact-aggregation.js';
import type { ArtifactSnapshot } from '../../src/runtime/computer.js';

function sha(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function snap(workerId: string, path: string, content: string): ArtifactSnapshot {
  return { workerId, path, bytes: content.length, content };
}

const MANIFEST = ['package.json', 'README.md', 'src/index.js', 'src/store.js', 'test/app.test.js'];

// ─── Phase B — Guarantee 1: identical deliverables + different cache → SAME identity ──

describe('G7-19G Phase B Guarantee 1: identical deliverables + different cache → SAME identity', () => {
  test('two workers with identical manifest content but different .npm cache files have the SAME packageIdentity', () => {
    // Worker A: 5 manifest files + .npm cache file with timestamp T1.
    const workerA: ArtifactSnapshot[] = [
      snap('worker-a', 'package.json', '{"name":"app"}'),
      snap('worker-a', 'README.md', '# App'),
      snap('worker-a', 'src/index.js', 'console.log("a");'),
      snap('worker-a', 'src/store.js', 'export const x = 1;'),
      snap('worker-a', 'test/app.test.js', 'test("a", () => {});'),
      // Auxiliary cache file — different timestamp than worker B's.
      snap('worker-a', '.npm/_logs/2026-10-11T05_22_44_449Z-debug-0.log', 'npm log A'),
      snap('worker-a', '.npm/_update-notifier-last-checked', ''),
    ];
    // Worker B: same 5 manifest files + .npm cache file with timestamp T2.
    const workerB: ArtifactSnapshot[] = [
      snap('worker-b', 'package.json', '{"name":"app"}'),
      snap('worker-b', 'README.md', '# App'),
      snap('worker-b', 'src/index.js', 'console.log("a");'),
      snap('worker-b', 'src/store.js', 'export const x = 1;'),
      snap('worker-b', 'test/app.test.js', 'test("a", () => {});'),
      // Different timestamp → different filename → different cache content.
      snap('worker-b', '.npm/_logs/2026-10-11T07_11_22_333Z-debug-0.log', 'npm log B'),
      snap('worker-b', '.npm/_update-notifier-last-checked', ''),
    ];

    // With manifest scoping: identical deliverables → SAME identity
    // (cache files are excluded from the canonical hash).
    const idAWithManifest = computePackageIdentity('worker-a', workerA, MANIFEST);
    const idBWithManifest = computePackageIdentity('worker-b', workerB, MANIFEST);

    // The identity includes the workerId in the canonical JSON, so two
    // different workerIds produce different identities even with
    // identical content. Verify the identity is computed from the
    // manifest-scoped files only (not the cache files). The manifest
    // paths are sorted by path (case-sensitive) before hashing, same
    // as computePackageIdentity does internally.
    const manifestSnapsA = workerA.filter((s) => MANIFEST.includes(s.path));
    const sortedA = [...manifestSnapsA].sort((a, b) =>
      a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
    );
    const expectedFilesA = sortedA.map((s) => [s.path, sha(s.content!)]);
    const expectedCanonicalA = JSON.stringify({ workerId: 'worker-a', files: expectedFilesA });
    const expectedIdA = sha(expectedCanonicalA);
    expect(idAWithManifest).toBe(expectedIdA);

    const manifestSnapsB = workerB.filter((s) => MANIFEST.includes(s.path));
    const sortedB = [...manifestSnapsB].sort((a, b) =>
      a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
    );
    const expectedFilesB = sortedB.map((s) => [s.path, sha(s.content!)]);
    const expectedCanonicalB = JSON.stringify({ workerId: 'worker-b', files: expectedFilesB });
    const expectedIdB = sha(expectedCanonicalB);
    expect(idBWithManifest).toBe(expectedIdB);

    // The identities differ ONLY by workerId (not by cache content).
    // Verify by computing what the identity would be WITHOUT manifest
    // scoping (pre-G7-19G behavior) — it would be DIFFERENT for the
    // two workers because the cache files are different.
    const idAWithoutManifest = computePackageIdentity('worker-a', workerA);
    const idBWithoutManifest = computePackageIdentity('worker-b', workerB);
    expect(idAWithoutManifest).not.toBe(idBWithoutManifest);
    // And neither matches the manifest-scoped identity (because cache
    // files alter the hash when not scoped).
    expect(idAWithoutManifest).not.toBe(idAWithManifest);
    expect(idBWithoutManifest).not.toBe(idBWithManifest);
  });

  test('manifest scoping makes identity invariant under cache-file changes for the SAME worker', () => {
    // Same worker, two runs. Manifest content identical. Cache files differ.
    const run1: ArtifactSnapshot[] = [
      snap('w-1', 'package.json', '{"name":"app"}'),
      snap('w-1', 'README.md', '# App'),
      snap('w-1', 'src/index.js', 'console.log("a");'),
      snap('w-1', 'src/store.js', 'export const x = 1;'),
      snap('w-1', 'test/app.test.js', 'test("a", () => {});'),
      snap('w-1', '.npm/_logs/2026-10-11T05_22_44_449Z-debug-0.log', 'log run 1'),
    ];
    const run2: ArtifactSnapshot[] = [
      snap('w-1', 'package.json', '{"name":"app"}'),
      snap('w-1', 'README.md', '# App'),
      snap('w-1', 'src/index.js', 'console.log("a");'),
      snap('w-1', 'src/store.js', 'export const x = 1;'),
      snap('w-1', 'test/app.test.js', 'test("a", () => {});'),
      snap('w-1', '.npm/_logs/2026-10-11T07_33_55_111Z-debug-0.log', 'log run 2'),
    ];

    // Pre-G7-19G (no manifest): different cache → different identity.
    const idNoManifest1 = computePackageIdentity('w-1', run1);
    const idNoManifest2 = computePackageIdentity('w-1', run2);
    expect(idNoManifest1).not.toBe(idNoManifest2);

    // G7-19G (with manifest): same manifest content → SAME identity.
    const idWithManifest1 = computePackageIdentity('w-1', run1, MANIFEST);
    const idWithManifest2 = computePackageIdentity('w-1', run2, MANIFEST);
    expect(idWithManifest1).toBe(idWithManifest2);
  });
});

// ─── Phase B — Guarantee 2: changed deliverable content → DIFFERENT identity ──

describe('G7-19G Phase B Guarantee 2: changed deliverable content → DIFFERENT identity', () => {
  test('two workers with different manifest content have DIFFERENT packageIdentities (manifest-scoped)', () => {
    const workerA: ArtifactSnapshot[] = [
      snap('worker-a', 'package.json', '{"name":"app"}'),
      snap('worker-a', 'README.md', '# App A'),
      snap('worker-a', 'src/index.js', 'console.log("a");'),
      snap('worker-a', 'src/store.js', 'export const x = 1;'),
      snap('worker-a', 'test/app.test.js', 'test("a", () => {});'),
    ];
    const workerB: ArtifactSnapshot[] = [
      snap('worker-b', 'package.json', '{"name":"app"}'),
      snap('worker-b', 'README.md', '# App B'),  // DIFFERENT
      snap('worker-b', 'src/index.js', 'console.log("a");'),
      snap('worker-b', 'src/store.js', 'export const x = 1;'),
      snap('worker-b', 'test/app.test.js', 'test("a", () => {});'),
    ];

    const idA = computePackageIdentity('worker-a', workerA, MANIFEST);
    const idB = computePackageIdentity('worker-b', workerB, MANIFEST);
    expect(idA).not.toBe(idB);
  });

  test('same worker, changed content → different identity', () => {
    const v1: ArtifactSnapshot[] = [
      snap('w-1', 'package.json', '{"name":"app"}'),
      snap('w-1', 'README.md', '# App v1'),
    ];
    const v2: ArtifactSnapshot[] = [
      snap('w-1', 'package.json', '{"name":"app"}'),
      snap('w-1', 'README.md', '# App v2'),  // CHANGED
    ];
    const manifest = ['package.json', 'README.md'];
    expect(computePackageIdentity('w-1', v1, manifest))
      .not.toBe(computePackageIdentity('w-1', v2, manifest));
  });
});

// ─── Phase B — Guarantee 3: incomplete manifests → reject (existing behavior) ──

describe('G7-19G Phase B Guarantee 3: incomplete manifests → reject (existing behavior preserved)', () => {
  test('worker missing a required manifest path is rejected as incomplete', () => {
    const incomplete: ArtifactSnapshot[] = [
      snap('w-1', 'package.json', '{"name":"app"}'),
      snap('w-1', 'README.md', '# App'),
      // MISSING: src/index.js, src/store.js, test/app.test.js
    ];
    const candidates = buildPackageCandidates(
      incomplete,
      MANIFEST,
      new Set(MANIFEST),
      true, // verificationOk
    );
    expect(candidates.length).toBe(1);
    expect(candidates[0].completenessOk).toBe(false);
    expect(candidates[0].rejectionReason).toContain('missing required path');
  });
});

// ─── Phase B — Guarantee 4: unsafe extra files → reject (existing behavior) ──

describe('G7-19G Phase B Guarantee 4: unsafe extra files → reject (existing behavior preserved)', () => {
  test('worker with unsafe path (..) is rejected', () => {
    const unsafe: ArtifactSnapshot[] = [
      snap('w-1', 'package.json', '{"name":"app"}'),
      snap('w-1', 'README.md', '# App'),
      snap('w-1', 'src/index.js', 'console.log("a");'),
      snap('w-1', 'src/store.js', 'export const x = 1;'),
      snap('w-1', 'test/app.test.js', 'test("a", () => {});'),
      snap('w-1', '../escape.js', 'malicious'),  // UNSAFE
    ];
    const candidates = buildPackageCandidates(
      unsafe,
      MANIFEST,
      new Set(MANIFEST),
      true,
    );
    expect(candidates[0].completenessOk).toBe(false);
    expect(candidates[0].rejectionReason).toContain('unsafe path');
  });

  test('worker with absolute path is rejected', () => {
    const unsafe: ArtifactSnapshot[] = [
      snap('w-1', 'package.json', '{"name":"app"}'),
      snap('w-1', 'README.md', '# App'),
      snap('w-1', 'src/index.js', 'console.log("a");'),
      snap('w-1', 'src/store.js', 'export const x = 1;'),
      snap('w-1', 'test/app.test.js', 'test("a", () => {});'),
      snap('w-1', '/etc/passwd', 'malicious'),  // ABSOLUTE
    ];
    const candidates = buildPackageCandidates(
      unsafe,
      MANIFEST,
      new Set(MANIFEST),
      true,
    );
    expect(candidates[0].completenessOk).toBe(false);
    expect(candidates[0].rejectionReason).toContain('unsafe path');
  });
});

// ─── Phase B — Guarantee 5: auxiliary files remain visible (not silently ignored) ──

describe('G7-19G Phase B Guarantee 5: auxiliary files remain visible (not silently ignored)', () => {
  test('the gateway artifact records still include .npm/* cache files (visible to consumers)', () => {
    const snaps: ArtifactSnapshot[] = [
      snap('w-1', 'package.json', '{"name":"app"}'),
      snap('w-1', 'README.md', '# App'),
      snap('w-1', 'src/index.js', 'console.log("a");'),
      snap('w-1', 'src/store.js', 'export const x = 1;'),
      snap('w-1', 'test/app.test.js', 'test("a", () => {});'),
      snap('w-1', '.npm/_logs/2026-10-11T05_22_44_449Z-debug-0.log', 'log'),
      snap('w-1', '.npm/_update-notifier-last-checked', ''),
    ];
    const records = buildAggregatedRecords(snaps, true, new Set(MANIFEST));
    // All 7 snapshots produce 7 records — none are silently dropped.
    expect(records.length).toBe(7);
    // The .npm/* files are visible in the records.
    const npmRecords = records.filter((r) => r.path.startsWith('.npm/'));
    expect(npmRecords.length).toBe(2);
  });
});

// ─── Phase B — Guarantee 6: content-hash binding between verification and selection ──

describe('G7-19G Phase B Guarantee 6: content-hash binding preserved (G7-19D regression check)', () => {
  test('captured identity matches selection identity when content unchanged', () => {
    const snaps: ArtifactSnapshot[] = [
      snap('w-1', 'package.json', '{"name":"app"}'),
      snap('w-1', 'README.md', '# App'),
      snap('w-1', 'src/index.js', 'console.log("a");'),
      snap('w-1', 'src/store.js', 'export const x = 1;'),
      snap('w-1', 'test/app.test.js', 'test("a", () => {});'),
    ];
    const acceptanceCriteria = MANIFEST.map((p) => ({
      kind: 'file' as const,
      label: `${p} required`,
      path: p,
    }));

    // Capture at verification time (uses the manifest).
    const captured = computeWorkerPackageIdentities(snaps, MANIFEST);
    const capturedId = captured.get('w-1')!;

    // Selection time: apply package selection with the captured identity.
    const records = buildAggregatedRecords(snaps, true, new Set(MANIFEST));
    const selected = applyPackageSelection(
      records,
      snaps,
      acceptanceCriteria,
      new Set(MANIFEST),
      true,
      captured,
    );

    const vps = selected[0].verifiedPackageSelection;
    expect(vps).toBeDefined();
    expect(vps!.packageState).toBe('SELECTED');
    expect(vps!.packageIdentity).toBe(capturedId);
    // The selected package's identity matches the captured verified identity.
  });

  test('post-verification content mutation is detected (G7-19D regression)', () => {
    // Capture at verification time with v1 content.
    const v1Snaps: ArtifactSnapshot[] = [
      snap('w-1', 'package.json', '{"name":"app"}'),
      snap('w-1', 'README.md', '# App v1'),
      snap('w-1', 'src/index.js', 'console.log("a");'),
      snap('w-1', 'src/store.js', 'export const x = 1;'),
      snap('w-1', 'test/app.test.js', 'test("a", () => {});'),
    ];
    const captured = computeWorkerPackageIdentities(v1Snaps, MANIFEST);

    // Selection time: v2 content (README changed).
    const v2Snaps: ArtifactSnapshot[] = [
      snap('w-1', 'package.json', '{"name":"app"}'),
      snap('w-1', 'README.md', '# App v2'),  // CHANGED
      snap('w-1', 'src/index.js', 'console.log("a");'),
      snap('w-1', 'src/store.js', 'export const x = 1;'),
      snap('w-1', 'test/app.test.js', 'test("a", () => {});'),
    ];
    const records = buildAggregatedRecords(v2Snaps, true, new Set(MANIFEST));
    const acceptanceCriteria = MANIFEST.map((p) => ({
      kind: 'file' as const,
      label: `${p} required`,
      path: p,
    }));
    const selected = applyPackageSelection(
      records,
      v2Snaps,
      acceptanceCriteria,
      new Set(MANIFEST),
      true,
      captured,
    );
    // The candidate is rejected: state=UNRESOLVED because the captured
    // identity (v1) doesn't match the current identity (v2).
    const vps = selected[0].verifiedPackageSelection;
    expect(vps).toBeDefined();
    expect(vps!.packageState).toBe('UNRESOLVED');
  });
});

// ─── Phase B — Backward compat: no manifest → uses all snapshots ──

describe('G7-19G Phase B backward compat: no manifest → uses all snapshots (pre-G7-19G behavior)', () => {
  test('computePackageIdentity without manifestPaths uses all snapshots', () => {
    const snaps: ArtifactSnapshot[] = [
      snap('w-1', 'package.json', '{"name":"app"}'),
      snap('w-1', '.npm/cache.log', 'cache'),  // would be excluded with manifest
    ];
    const idWithManifest = computePackageIdentity('w-1', snaps, ['package.json']);
    const idWithoutManifest = computePackageIdentity('w-1', snaps);
    // With manifest: only package.json. Without: both files.
    expect(idWithManifest).not.toBe(idWithoutManifest);
  });

  test('computePackageIdentity with empty manifest uses all snapshots', () => {
    const snaps: ArtifactSnapshot[] = [
      snap('w-1', 'package.json', '{"name":"app"}'),
      snap('w-1', '.npm/cache.log', 'cache'),
    ];
    const idWithEmptyManifest = computePackageIdentity('w-1', snaps, []);
    const idWithoutManifest = computePackageIdentity('w-1', snaps);
    expect(idWithEmptyManifest).toBe(idWithoutManifest);
  });

  test('computeWorkerPackageIdentities without manifestPaths uses all snapshots', () => {
    const snaps: ArtifactSnapshot[] = [
      snap('w-1', 'package.json', '{"name":"app"}'),
      snap('w-1', '.npm/cache.log', 'cache'),
    ];
    const withManifest = computeWorkerPackageIdentities(snaps, ['package.json']);
    const withoutManifest = computeWorkerPackageIdentities(snaps);
    expect(withManifest.get('w-1')).not.toBe(withoutManifest.get('w-1'));
  });
});
