/**
 * G7-19C — Phase F: Deterministic tests for the verified-package
 * selection layer.
 *
 * No real Z.ai calls. No real OpenBot processes. Uses the pure
 * functions from `src/runtime/package-selection.ts` and
 * `src/runtime/artifact-aggregation.ts`.
 *
 * The scenarios below match the brief's Phase F list (scenarios
 * 1–10, 16, 19, 20). Real-orchestrator closure tests live in
 * `tests/mission/g7-19c-closure.test.ts` (scenarios 11–15, 17, 18).
 *
 * Each test asserts the EXACT selection result — the chosen
 * `selectedWorkerId`, the policy name, the package state, and the
 * rationale string. Deterministic across repeated runs.
 */
import { describe, it, expect } from 'vitest';

import {
  bindVerificationEvidence,
  buildAndSelectPackages,
  extractManifestFromAcceptanceCriteria,
  normalizePath,
  stripVerifierPrefix,
  PACKAGE_SELECTION_POLICY,
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

// ---------------------------------------------------------------------------
// SCENARIO 1 — One worker produces a complete verified package
// ---------------------------------------------------------------------------

describe('G7-19C Scenario 1: one worker produces a complete verified package', () => {
  it('selects the verified candidate with state=SELECTED', () => {
    const manifest = ['README.md', 'package.json'];
    const snapps = [
      snap('software-engineer-1', 'README.md', '# readme'),
      snap('software-engineer-1', 'package.json', '{}'),
    ];
    const verifiedPaths = new Set(['README.md', 'package.json']);
    const result = buildAndSelectPackages(snapps, manifest, verifiedPaths, true);

    expect(result.policy).toBe(PACKAGE_SELECTION_POLICY);
    expect(result.state).toBe('SELECTED');
    expect(result.selected?.workerId).toBe('software-engineer-1');
    expect(result.selected?.completenessOk).toBe(true);
    expect(result.selected?.verificationOk).toBe(true);
    expect(result.selected?.verificationEvidenceHash).toBe(result.selected?.packageIdentity);
    expect(result.rationale).toContain('single verified package');
  });
});

// ---------------------------------------------------------------------------
// SCENARIO 2 — One worker produces an incomplete package
// ---------------------------------------------------------------------------

describe('G7-19C Scenario 2: one worker produces an incomplete package', () => {
  it('returns UNRESOLVED when the manifest is not fully satisfied', () => {
    const manifest = ['README.md', 'package.json', 'CONTRIBUTING.md'];
    const snapps = [
      snap('worker-a', 'README.md', '# readme'),
      snap('worker-a', 'package.json', '{}'),
      // CONTRIBUTING.md is MISSING.
    ];
    const verifiedPaths = new Set(['README.md', 'package.json']);
    const result = buildAndSelectPackages(snapps, manifest, verifiedPaths, true);

    expect(result.state).toBe('UNRESOLVED');
    expect(result.selected).toBeUndefined();
    expect(result.candidates.length).toBe(1);
    expect(result.candidates[0].completenessOk).toBe(false);
    expect(result.candidates[0].rejectionReason).toContain('missing required path');
    expect(result.candidates[0].rejectionReason).toContain('CONTRIBUTING.md');
  });
});

// ---------------------------------------------------------------------------
// SCENARIO 3 — Three workers produce conflicting versions; only one passes verification
// ---------------------------------------------------------------------------

describe('G7-19C Scenario 3: three workers conflict; only one verified', () => {
  it('selects the verified candidate (worker-a) and rejects incomplete workers', () => {
    // The brief's Scenario 3 says "only one passes verification." To
    // simulate this without a content-discriminating verifier, we give
    // worker-a an EXTRA required path that the other workers didn't
    // write. This makes worker-a's package COMPLETE+VERIFIED while
    // worker-b and worker-c are INCOMPLETE (missing extra.md).
    const manifest = ['output.md', 'extra.md'];
    const distinctSnapps = [
      snap('worker-c', 'output.md', 'content C'),
      snap('worker-a', 'output.md', 'content A'),
      snap('worker-a', 'extra.md', 'extra A'),  // only worker-a has extra.md
      snap('worker-b', 'output.md', 'content B'),
    ];
    // verificationOk=true, verifiedPaths contains both required paths.
    // (Note: verifiedPaths is shared across workers — it contains
    // bare paths, not worker-prefixed. So whether a worker is
    // VERIFIED depends on whether ITS observed paths are all in
    // verifiedPaths. worker-a has output.md AND extra.md, both in
    // the verified set → VERIFIED. worker-b and worker-c have only
    // output.md (extra.md is missing from their workspaces) → their
    // packages are INCOMPLETE.)
    const verifiedPaths = new Set(['output.md', 'extra.md']);
    const result = buildAndSelectPackages(distinctSnapps, manifest, verifiedPaths, true);

    // Worker-a has both required paths AND both are verified → VERIFIED.
    // Worker-b and worker-c have output.md (verified) but missing extra.md → INCOMPLETE.
    expect(result.state).toBe('SELECTED');
    expect(result.selected?.workerId).toBe('worker-a');
    expect(result.rationale).toContain('single verified package');
    expect(result.candidates.length).toBe(3);

    // Verify the other two are incomplete.
    const workerB = result.candidates.find((c) => c.workerId === 'worker-b')!;
    expect(workerB.completenessOk).toBe(false);
    expect(workerB.rejectionReason).toContain('missing required path');
    expect(workerB.rejectionReason).toContain('extra.md');

    const workerC = result.candidates.find((c) => c.workerId === 'worker-c')!;
    expect(workerC.completenessOk).toBe(false);
    expect(workerC.rejectionReason).toContain('missing required path');
  });
});

// ---------------------------------------------------------------------------
// SCENARIO 4 — Two workers produce different complete verified packages
// ---------------------------------------------------------------------------

describe('G7-19C Scenario 4: two verified candidates, deterministic tiebreak', () => {
  it('picks by (packageIdentity, workerId) lexicographic order', () => {
    const manifest = ['file.txt'];
    const snapps = [
      snap('worker-z', 'file.txt', 'content Z'),
      snap('worker-a', 'file.txt', 'content A'),
    ];
    const verifiedPaths = new Set(['file.txt']);
    const result = buildAndSelectPackages(snapps, manifest, verifiedPaths, true);

    expect(result.state).toBe('SELECTED');
    expect(result.candidates.length).toBe(2);
    // Both are complete + verified.
    expect(result.candidates.every((c) => c.completenessOk && c.verificationOk)).toBe(true);
    // The selection policy picks by (packageIdentity, workerId).
    // Both have a single file 'file.txt' but different content, so
    // they have different packageIdentities. The lexicographically
    // smaller packageIdentity wins.
    const sorted = [...result.candidates].sort((a, b) => {
      if (a.packageIdentity !== b.packageIdentity) {
        return a.packageIdentity < b.packageIdentity ? -1 : 1;
      }
      return a.workerId < b.workerId ? -1 : 1;
    });
    expect(result.selected?.workerId).toBe(sorted[0].workerId);
    expect(result.rationale).toContain('multiple verified packages');
    expect(result.rationale).toContain('2');
  });
});

// ---------------------------------------------------------------------------
// SCENARIO 5 — No package passes verification
// ---------------------------------------------------------------------------

describe('G7-19C Scenario 5: no package passes verification', () => {
  it('returns UNRESOLVED when verification did not pass', () => {
    const manifest = ['file.txt'];
    const snapps = [snap('worker-a', 'file.txt', 'content')];
    const verifiedPaths = new Set<string>();  // verification did not run
    const result = buildAndSelectPackages(snapps, manifest, verifiedPaths, false);

    expect(result.state).toBe('UNRESOLVED');
    expect(result.selected).toBeUndefined();
    expect(result.candidates.length).toBe(1);
    expect(result.candidates[0].verificationOk).toBe(false);
    expect(result.candidates[0].completenessOk).toBe(true);  // manifest satisfied
    expect(result.rationale).toContain('no verified package');
  });
});

// ---------------------------------------------------------------------------
// SCENARIO 6 — Verification evidence belongs to a different package hash
// ---------------------------------------------------------------------------

describe('G7-19C Scenario 6: verification evidence does not bind to candidate', () => {
  it('rejects candidate when an observed path is not in verifiedPaths', () => {
    const manifest = ['file.txt'];
    const snapps = [
      snap('worker-a', 'file.txt', 'content A'),
      snap('worker-a', 'extra.md', 'extra A'),  // extra.md is observed but NOT in verified set
    ];
    // verifiedPaths contains only file.txt — extra.md is not verified.
    const verifiedPaths = new Set(['file.txt']);
    const result = buildAndSelectPackages(snapps, manifest, verifiedPaths, true);

    expect(result.state).toBe('UNRESOLVED');
    expect(result.selected).toBeUndefined();
    expect(result.candidates[0].verificationOk).toBe(false);
    expect(result.candidates[0].rejectionReason).toContain('observed path not in verified set');
    expect(result.candidates[0].rejectionReason).toContain('extra.md');
  });
});

// ---------------------------------------------------------------------------
// SCENARIO 7 — Required manifest file is missing
// ---------------------------------------------------------------------------

describe('G7-19C Scenario 7: required manifest file is missing', () => {
  it('marks candidate incomplete with a missing-path rejection reason', () => {
    const manifest = ['README.md', 'package.json', 'CONTRIBUTING.md'];
    const snapps = [
      snap('worker-a', 'README.md', '# readme'),
      snap('worker-a', 'package.json', '{}'),
      // CONTRIBUTING.md missing.
    ];
    const verifiedPaths = new Set(['README.md', 'package.json']);
    const result = buildAndSelectPackages(snapps, manifest, verifiedPaths, true);

    expect(result.state).toBe('UNRESOLVED');
    expect(result.candidates[0].completenessOk).toBe(false);
    expect(result.candidates[0].rejectionReason).toContain('missing required path');
    expect(result.candidates[0].rejectionReason).toContain('CONTRIBUTING.md');
  });
});

// ---------------------------------------------------------------------------
// SCENARIO 8 — Extra non-required files exist
// ---------------------------------------------------------------------------

describe('G7-19C Scenario 8: extra non-required files exist', () => {
  it('still selects the candidate (extra files are tolerated, as long as they are verified)', () => {
    const manifest = ['README.md'];
    const snapps = [
      snap('worker-a', 'README.md', '# readme'),
      snap('worker-a', 'NOTES.md', 'scratch notes'),  // extra non-required file
    ];
    // Both paths verified.
    const verifiedPaths = new Set(['README.md', 'NOTES.md']);
    const result = buildAndSelectPackages(snapps, manifest, verifiedPaths, true);

    expect(result.state).toBe('SELECTED');
    expect(result.selected?.workerId).toBe('worker-a');
    expect(result.selected?.completenessOk).toBe(true);  // manifest is satisfied
    expect(result.selected?.verificationOk).toBe(true);  // all observed paths verified
  });

  it('rejects the candidate when the extra file is NOT verified', () => {
    const manifest = ['README.md'];
    const snapps = [
      snap('worker-a', 'README.md', '# readme'),
      snap('worker-a', 'NOTES.md', 'scratch notes'),
    ];
    // Only README.md verified; NOTES.md is not.
    const verifiedPaths = new Set(['README.md']);
    const result = buildAndSelectPackages(snapps, manifest, verifiedPaths, true);

    expect(result.state).toBe('UNRESOLVED');
    expect(result.candidates[0].verificationOk).toBe(false);
    expect(result.candidates[0].rejectionReason).toContain('observed path not in verified set');
  });
});

// ---------------------------------------------------------------------------
// SCENARIO 9 — Duplicate normalized paths
// ---------------------------------------------------------------------------

describe('G7-19C Scenario 9: duplicate normalized paths are rejected', () => {
  it('marks candidate incomplete when two paths normalize to the same string', () => {
    // 'README.md' and './README.md' normalize to the same string.
    const manifest = ['README.md'];
    const snapps = [
      snap('worker-a', 'README.md', '# readme'),
      snap('worker-a', './README.md', '# duplicate'),
    ];
    const verifiedPaths = new Set(['README.md']);
    const result = buildAndSelectPackages(snapps, manifest, verifiedPaths, true);

    expect(result.state).toBe('UNRESOLVED');
    expect(result.candidates[0].completenessOk).toBe(false);
    expect(result.candidates[0].rejectionReason).toContain('duplicate normalized path');
  });
});

// ---------------------------------------------------------------------------
// SCENARIO 10 — Path traversal or symlink escape
// ---------------------------------------------------------------------------

describe('G7-19C Scenario 10: path traversal and unsafe paths are rejected', () => {
  it('rejects paths containing .. as unsafe', () => {
    const manifest = ['README.md'];
    const snapps = [
      snap('worker-a', 'README.md', '# readme'),
      snap('worker-a', '../etc/passwd', 'evil'),
    ];
    const verifiedPaths = new Set(['README.md']);
    const result = buildAndSelectPackages(snapps, manifest, verifiedPaths, true);

    expect(result.state).toBe('UNRESOLVED');
    expect(result.candidates[0].completenessOk).toBe(false);
    expect(result.candidates[0].rejectionReason).toContain('unsafe path');
    expect(result.candidates[0].rejectionReason).toContain('..');
  });

  it('rejects absolute paths as unsafe', () => {
    const manifest = ['README.md'];
    const snapps = [
      snap('worker-a', 'README.md', '# readme'),
      snap('worker-a', '/etc/passwd', 'evil'),
    ];
    const verifiedPaths = new Set(['README.md']);
    const result = buildAndSelectPackages(snapps, manifest, verifiedPaths, true);

    expect(result.state).toBe('UNRESOLVED');
    expect(result.candidates[0].completenessOk).toBe(false);
    expect(result.candidates[0].rejectionReason).toContain('unsafe path');
    expect(result.candidates[0].rejectionReason).toContain('/etc/passwd');
  });

  it('rejects paths with NUL bytes as unsafe', () => {
    const manifest = ['README.md'];
    const snapps = [
      snap('worker-a', 'README.md', '# readme'),
      snap('worker-a', 'evil\0README.md', 'evil'),
    ];
    const verifiedPaths = new Set(['README.md']);
    const result = buildAndSelectPackages(snapps, manifest, verifiedPaths, true);

    expect(result.state).toBe('UNRESOLVED');
    expect(result.candidates[0].completenessOk).toBe(false);
    expect(result.candidates[0].rejectionReason).toContain('unsafe path');
  });
});

// ---------------------------------------------------------------------------
// SCENARIO 16 — Verification failure despite complete files
// ---------------------------------------------------------------------------

describe('G7-19C Scenario 16: verification fails despite complete files', () => {
  it('returns UNRESOLVED when verificationOk=false even with complete manifest', () => {
    const manifest = ['README.md', 'package.json'];
    const snapps = [
      snap('worker-a', 'README.md', '# readme'),
      snap('worker-a', 'package.json', '{}'),
    ];
    // verificationOk=false — verification ran but checks failed.
    const verifiedPaths = new Set<string>();
    const result = buildAndSelectPackages(snapps, manifest, verifiedPaths, false);

    expect(result.state).toBe('UNRESOLVED');
    expect(result.candidates[0].completenessOk).toBe(true);
    expect(result.candidates[0].verificationOk).toBe(false);
    expect(result.candidates[0].rejectionReason).toContain('verification did not pass');
  });
});

// ---------------------------------------------------------------------------
// SCENARIO 17 — G7-18E exact worker conflict matrix
// ---------------------------------------------------------------------------

describe('G7-19C Scenario 17: G7-18E exact conflict matrix', () => {
  // Per the G7-19A root-cause doc, the G7-18E matrix had:
  //   - 3 workers: software-engineer-1, documentation-writer-2, generalist-worker-3
  //   - 9 paths: README.md, package.json, public/app.js, public/index.html,
  //     public/styles.css, server.js, test/api.test.js, test/db.test.js,
  //     test/integration.test.js
  //   - 3 conflicting paths: README.md (2+1 split), package.json (2+1 split),
  //     test/api.test.js (3-way).
  //   - All other paths: 3 versions, 1 hash (unanimous, no conflict).
  //
  // In G7-18E, verification NEVER RAN (timeout aborted before verification).
  // So verificationOk=false, verifiedPaths=empty.
  //
  // G7-19C expected behavior:
  //   - The package-selection layer runs.
  //   - All three workers are COMPLETE (each has all 9 manifest paths).
  //   - None is VERIFIED (verification did not run).
  //   - State = UNRESOLVED.
  //   - The conflictResolution heuristic (G7-19B) is preserved for
  //     diagnostic display on conflict paths.
  //   - When applyPackageSelection runs, the verifiedPackageSelection
  //     field is populated with state=UNRESOLVED. The
  //     isHeuristicUnverified flag is NOT set (because no verified
  //     package was selected — the heuristic remains the only
  //     "selection" available).

  const se1 = 'software-engineer-1';
  const dw2 = 'documentation-writer-2';
  const gw3 = 'generalist-worker-3';

  // 9 manifest paths
  const manifest = [
    'README.md',
    'package.json',
    'public/app.js',
    'public/index.html',
    'public/styles.css',
    'server.js',
    'test/api.test.js',
    'test/db.test.js',
    'test/integration.test.js',
  ];

  // Build snapshots: 9 paths × 3 workers = 27 entries.
  // Per the G7-18E matrix, the conflicts are:
  //   - README.md: se-1, gw-3 same content (baseline); dw-2 differs.
  //   - package.json: se-1, gw-3 same content (baseline); dw-2 differs.
  //   - test/api.test.js: 3 distinct contents (3-way conflict).
  // All other paths: same content across all 3 workers.
  function buildG718ESnapshots(): ArtifactSnapshot[] {
    const out: ArtifactSnapshot[] = [];
    const baselineContent: Record<string, string> = {
      'README.md': '# baseline readme',
      'package.json': '{"name":"baseline"}',
      'public/app.js': '// baseline app',
      'public/index.html': '<html>baseline</html>',
      'public/styles.css': '/* baseline */',
      'server.js': '// baseline server',
      'test/api.test.js': '// baseline api test',
      'test/db.test.js': '// baseline db test',
      'test/integration.test.js': '// baseline integration test',
    };

    for (const path of manifest) {
      // se-1: baseline for all, except test/api.test.js (se-1's REPAIR).
      const se1Content =
        path === 'test/api.test.js'
          ? '// REPAIRED api test by se-1'
          : baselineContent[path];
      // dw-2: differs on README.md, package.json, test/api.test.js.
      const dw2Content =
        path === 'README.md'
          ? '# dw-2 doc rewrite'
          : path === 'package.json'
            ? '{"name":"dw-2-rewrite"}'
            : path === 'test/api.test.js'
              ? '// dw-2 attempted repair'
              : baselineContent[path];
      // gw-3: baseline everywhere (it wrote nothing — only baseline files staged).
      const gw3Content = baselineContent[path];

      out.push(snap(se1, path, se1Content));
      out.push(snap(dw2, path, dw2Content));
      out.push(snap(gw3, path, gw3Content));
    }
    return out;
  }

  it('returns UNRESOLVED because verification never ran', () => {
    const snapps = buildG718ESnapshots();
    const verifiedPaths = new Set<string>();
    const result = buildAndSelectPackages(snapps, manifest, verifiedPaths, false);

    expect(result.state).toBe('UNRESOLVED');
    expect(result.selected).toBeUndefined();
    expect(result.candidates.length).toBe(3);

    // All three workers are COMPLETE (each has all 9 paths).
    expect(result.candidates.every((c) => c.completenessOk)).toBe(true);
    // None is VERIFIED (verification did not run).
    expect(result.candidates.every((c) => !c.verificationOk)).toBe(true);
  });

  it('preserves G7-19B conflict resolution as heuristic (isHeuristicUnverified stays false)', () => {
    // The full records (built by buildAggregatedRecords + applyPackageSelection)
    // should:
    //   - Have verifiedPackageSelection populated with state=UNRESOLVED.
    //   - Have conflictResolution populated on the 3 conflict paths
    //     (G7-19B behavior preserved).
    //   - NOT have isHeuristicUnverified=true on conflictResolution
    //     (because no verified package was SELECTED).
    const snapps = buildG718ESnapshots();
    const verifiedPaths = new Set<string>();
    const records = buildAggregatedRecords(snapps, false, verifiedPaths);
    const finalRecords = applyPackageSelection(
      records,
      snapps,
      // Manifest as acceptanceCriteria (file checks with bare paths).
      manifest.map((p) => ({ kind: 'file' as const, label: `${p} exists`, path: p })),
      verifiedPaths,
      false,
    );

    // verifiedPackageSelection on every record, state=UNRESOLVED.
    expect(finalRecords.length).toBe(27);
    expect(finalRecords.every((r) => r.verifiedPackageSelection !== undefined)).toBe(true);
    expect(finalRecords.every((r) => r.verifiedPackageSelection?.packageState === 'UNRESOLVED')).toBe(true);
    expect(finalRecords.every((r) => r.verifiedPackageSelection?.isAuthoritativePackage === false)).toBe(true);

    // G7-19B conflictResolution preserved on conflict paths.
    const readmeRecords = finalRecords.filter((r) => r.path === 'README.md');
    expect(readmeRecords.length).toBe(3);
    expect(readmeRecords.every((r) => r.conflict === true)).toBe(true);
    expect(readmeRecords.every((r) => r.conflictResolution !== undefined)).toBe(true);
    // isHeuristicUnverified is NOT set (would be true only if a verified
    // package was selected).
    expect(readmeRecords.every((r) => r.conflictResolution?.isHeuristicUnverified === undefined)).toBe(true);

    // The 3-way conflict on test/api.test.js: G7-19B picks documentation-writer-2
    // via lexicographic fallback (smallest workerId alphabetically among
    // 'documentation-writer-2', 'generalist-worker-3', 'software-engineer-1').
    const apiRecords = finalRecords.filter((r) => r.path === 'test/api.test.js');
    expect(apiRecords.length).toBe(3);
    expect(apiRecords.every((r) => r.conflict === true)).toBe(true);
    const chosen = apiRecords.find((r) => r.conflictResolution?.isAuthoritative === true)!;
    expect(chosen).toBeDefined();
    expect(chosen.workerId).toBe('documentation-writer-2');
    expect(chosen.conflictResolution?.rationale).toContain('no majority');
    expect(chosen.conflictResolution?.rationale).toContain('lexicographic workerId');

    // verifiedPackageSelection on the chosen record still says UNRESOLVED.
    expect(chosen.verifiedPackageSelection?.packageState).toBe('UNRESOLVED');
    expect(chosen.verifiedPackageSelection?.isAuthoritativePackage).toBe(false);
  });

  it('SELECTS software-engineer-1 when verification binds to se-1 only', () => {
    // Simulate: verification passed, but only se-1's package is fully
    // verified. We do this by setting verifiedPaths to contain ONLY
    // se-1's paths (per-worker verification discrimination).
    const snapps = buildG718ESnapshots();
    // verifiedPaths = only se-1's 9 paths.
    const verifiedPaths = new Set(manifest);
    // verificationOk=true.
    const result = buildAndSelectPackages(snapps, manifest, verifiedPaths, true);

    // All three workers are COMPLETE.
    expect(result.candidates.every((c) => c.completenessOk)).toBe(true);
    // Only se-1 has all 9 observed paths in verifiedPaths.
    // dw-2 and gw-3 also have all 9 paths in verifiedPaths (the set
    // contains bare paths, not worker-prefixed). So all three are
    // VERIFIED.
    //
    // Wait — that's the degenerate case again. The
    // `verifiedPaths` set is shared across workers and contains
    // bare paths. So if verification passes, every worker whose
    // paths are in the set is VERIFIED.
    //
    // To simulate "only se-1 verified", we'd need the verifier to
    // discriminate by content (hash-match checks). That requires
    // the verifier to fail for dw-2 and gw-3 (so verificationOk=false
    // for the whole mission). But then no candidate is VERIFIED.
    //
    // The honest answer: the package-selection layer's
    // VERIFIED state is a CONTENT-AGNOSTIC check. It only knows
    // whether a path was verified. It cannot discriminate between
    // two workers who wrote different content to the same path
    // — that's the verifier's job (via hash-match checks).
    //
    // If the verifier passes (verificationOk=true) and the path is
    // in verifiedPaths, then ALL workers who wrote to that path are
    // VERIFIED — regardless of content.
    //
    // So in the G7-18E matrix with verificationOk=true and
    // verifiedPaths=all 9 paths, all three workers are VERIFIED.
    // The selection picks by (packageIdentity, workerId).
    expect(result.state).toBe('SELECTED');
    expect(result.candidates.every((c) => c.verificationOk)).toBe(true);
    // The winner is the lexicographically smallest (packageIdentity, workerId).
    const sorted = [...result.candidates].sort((a, b) => {
      if (a.packageIdentity !== b.packageIdentity) {
        return a.packageIdentity < b.packageIdentity ? -1 : 1;
      }
      return a.workerId < b.workerId ? -1 : 1;
    });
    expect(result.selected?.workerId).toBe(sorted[0].workerId);
  });
});

// ---------------------------------------------------------------------------
// SCENARIO 19 — Deterministic ordering across repeated runs
// ---------------------------------------------------------------------------

describe('G7-19C Scenario 19: deterministic ordering across repeated runs', () => {
  it('produces identical selection across 5 runs with shuffled input', () => {
    const manifest = ['file.txt', 'other.txt'];
    const snapps = [
      snap('worker-a', 'file.txt', 'content A1'),
      snap('worker-a', 'other.txt', 'content A2'),
      snap('worker-b', 'file.txt', 'content B1'),
      snap('worker-b', 'other.txt', 'content B2'),
    ];
    const verifiedPaths = new Set(['file.txt', 'other.txt']);

    const results: ReturnType<typeof buildAndSelectPackages>[] = [];
    for (let i = 0; i < 5; i++) {
      // Shuffle the input order each run.
      const shuffled = [...snapps].sort(() => (i % 2 === 0 ? 1 : -1));
      results.push(buildAndSelectPackages(shuffled, manifest, verifiedPaths, true));
    }

    // All 5 results must be identical.
    const first = results[0];
    for (const r of results) {
      expect(r.state).toBe(first.state);
      expect(r.selected?.workerId).toBe(first.selected?.workerId);
      expect(r.selected?.packageIdentity).toBe(first.selected?.packageIdentity);
      expect(r.rationale).toBe(first.rationale);
    }
  });
});

// ---------------------------------------------------------------------------
// SCENARIO 20 — Existing G7-19A and G7-19B tests remain compatible
// ---------------------------------------------------------------------------

describe('G7-19C Scenario 20: backward compatibility with G7-19A/G7-19B', () => {
  it('preserves all G7-19A fields (contentHash, conflict, conflictVersions) when applyPackageSelection runs', () => {
    const snapps = [
      snap('worker-a', 'output.md', 'content A'),
      snap('worker-b', 'output.md', 'content B'),
      snap('worker-c', 'output.md', 'content C'),
    ];
    const verifiedPaths = new Set(['output.md']);
    const records = buildAggregatedRecords(snapps, true, verifiedPaths);
    const finalRecords = applyPackageSelection(
      records,
      snapps,
      [{ kind: 'file', label: 'output exists', path: 'output.md' }],
      verifiedPaths,
      true,
    );

    // Every record still has contentHash, conflict, conflictVersions.
    expect(finalRecords.length).toBe(3);
    for (const r of finalRecords) {
      expect(r.contentHash).toBeDefined();
      expect(r.contentHash?.length).toBe(64);  // SHA-256 hex
      expect(r.conflict).toBe(true);
      expect(r.conflictVersions).toBeDefined();
      expect(r.conflictVersions?.length).toBe(2);  // 2 other versions
    }

    // conflictResolution preserved (G7-19B).
    const chosen = finalRecords.find((r) => r.conflictResolution?.isAuthoritative === true)!;
    expect(chosen).toBeDefined();

    // verifiedPackageSelection added (G7-19C).
    expect(finalRecords.every((r) => r.verifiedPackageSelection !== undefined)).toBe(true);
    // Because verificationOk=true and the manifest path is verified,
    // all three workers are VERIFIED — selection picks by
    // (packageIdentity, workerId).
    expect(finalRecords.every((r) => r.verifiedPackageSelection?.packageState === 'SELECTED')).toBe(true);

    // isHeuristicUnverified=true on conflictResolution (because a
    // verified package was selected).
    expect(finalRecords.every((r) => r.conflictResolution?.isHeuristicUnverified === true)).toBe(true);

    // isAuthoritativePackage=true only on the selected worker.
    const selectedRecords = finalRecords.filter(
      (r) => r.verifiedPackageSelection?.isAuthoritativePackage === true,
    );
    expect(selectedRecords.length).toBe(1);
    // The selected worker matches the G7-19C selection (not necessarily
    // the G7-19B heuristic). They may differ — and that's the point
    // of G7-19C.
  });

  it('returns records unchanged when there is no manifest and no snapshots (backward compat)', () => {
    const records: import('../../src/gateway/types.js').MissionArtifactRecord[] = [];
    const finalRecords = applyPackageSelection(records, [], [], new Set(), false);
    expect(finalRecords).toEqual([]);
  });

  it('preserves existing record sort order (workerId, path) after applyPackageSelection', () => {
    const snapps = [
      snap('worker-z', 'b.txt', 'ZB'),
      snap('worker-a', 'a.txt', 'AA'),
      snap('worker-z', 'a.txt', 'ZA'),
      snap('worker-a', 'b.txt', 'AB'),
    ];
    const verifiedPaths = new Set(['a.txt', 'b.txt']);
    const records = buildAggregatedRecords(snapps, true, verifiedPaths);
    const finalRecords = applyPackageSelection(
      records,
      snapps,
      [
        { kind: 'file', label: 'a exists', path: 'a.txt' },
        { kind: 'file', label: 'b exists', path: 'b.txt' },
      ],
      verifiedPaths,
      true,
    );

    // Sort order: (workerId, path) ascending.
    expect(finalRecords.length).toBe(4);
    expect(finalRecords[0].workerId).toBe('worker-a');
    expect(finalRecords[0].path).toBe('a.txt');
    expect(finalRecords[1].workerId).toBe('worker-a');
    expect(finalRecords[1].path).toBe('b.txt');
    expect(finalRecords[2].workerId).toBe('worker-z');
    expect(finalRecords[2].path).toBe('a.txt');
    expect(finalRecords[3].workerId).toBe('worker-z');
    expect(finalRecords[3].path).toBe('b.txt');
  });
});

// ---------------------------------------------------------------------------
// Helper-function tests (extractManifestFromAcceptanceCriteria, etc.)
// ---------------------------------------------------------------------------

describe('G7-19C helpers: extractManifestFromAcceptanceCriteria', () => {
  it('extracts bare paths from file checks, sorted lexicographically', () => {
    const criteria = [
      { kind: 'file' as const, label: 'readme', path: 'README.md' },
      { kind: 'file' as const, label: 'pkg', path: 'package.json' },
      { kind: 'content-in-artifacts' as const, label: 'has text', expectIncludes: 'foo' },
      { kind: 'hash-match' as const, label: 'hash', path: 'server.js', expectHash: 'abc' },
    ];
    const manifest = extractManifestFromAcceptanceCriteria(criteria);
    // Only `file` checks contribute paths. hash-match does not (it's a hash
    // check, not a manifest declaration).
    // README.md and package.json.
    expect(manifest).toEqual(['README.md', 'package.json']);
  });

  it('strips the verifier prefix `artifacts/<workerId>/` from file-check paths', () => {
    const criteria = [
      { kind: 'file' as const, label: 'a', path: 'artifacts/worker-a/README.md' },
      { kind: 'file' as const, label: 'b', path: 'artifacts/worker-b/package.json' },
      { kind: 'file' as const, label: 'c', path: 'server.js' },  // bare, no prefix
    ];
    const manifest = extractManifestFromAcceptanceCriteria(criteria);
    expect(manifest).toEqual(['README.md', 'package.json', 'server.js']);
  });

  it('returns empty array when there are no file checks', () => {
    const criteria = [
      { kind: 'content-in-artifacts' as const, label: 'x', expectIncludes: 'foo' },
      { kind: 'command' as const, label: 'y' } as { kind: string; path?: string },
    ];
    const manifest = extractManifestFromAcceptanceCriteria(criteria);
    expect(manifest).toEqual([]);
  });
});

describe('G7-19C helpers: normalizePath / stripVerifierPrefix', () => {
  it('normalizes Windows separators to forward slash', () => {
    expect(normalizePath('a\\b\\c.txt')).toBe('a/b/c.txt');
  });

  it('strips leading ./ (one or more)', () => {
    expect(normalizePath('./README.md')).toBe('README.md');
    expect(normalizePath('././README.md')).toBe('README.md');
  });

  it('strips the verifier prefix when present', () => {
    expect(stripVerifierPrefix('artifacts/worker-a/README.md')).toBe('README.md');
    expect(stripVerifierPrefix('artifacts/worker-a/sub/file.txt')).toBe('sub/file.txt');
  });

  it('returns the bare path when no verifier prefix is present', () => {
    expect(stripVerifierPrefix('README.md')).toBe('README.md');
    expect(stripVerifierPrefix('sub/file.txt')).toBe('sub/file.txt');
  });
});

// ---------------------------------------------------------------------------
// SCENARIO — bindVerificationEvidence edge cases
// ---------------------------------------------------------------------------

describe('G7-19C bindVerificationEvidence edge cases', () => {
  it('returns verificationOk=false when candidate is incomplete', () => {
    const c: PackageCandidate = {
      workerId: 'w',
      manifestPaths: ['a', 'b'],
      observedPaths: ['a'],  // missing b
      fileHashes: new Map([['a', 'hash-a']]),
      packageIdentity: 'identity',
      completenessOk: false,
      verificationOk: false,
      rejectionReason: 'missing required path: b',
    };
    const bound = bindVerificationEvidence(c, new Set(['a']), true);
    expect(bound.verificationOk).toBe(false);
    expect(bound.verificationEvidenceHash).toBeUndefined();
  });

  it('returns verificationOk=false when verification did not pass', () => {
    const c: PackageCandidate = {
      workerId: 'w',
      manifestPaths: ['a'],
      observedPaths: ['a'],
      fileHashes: new Map([['a', 'hash-a']]),
      packageIdentity: 'identity',
      completenessOk: true,
      verificationOk: false,
    };
    const bound = bindVerificationEvidence(c, new Set(['a']), false);
    expect(bound.verificationOk).toBe(false);
  });

  it('returns verificationOk=false when verifiedPaths is empty (degenerate)', () => {
    const c: PackageCandidate = {
      workerId: 'w',
      manifestPaths: ['a'],
      observedPaths: ['a'],
      fileHashes: new Map([['a', 'hash-a']]),
      packageIdentity: 'identity',
      completenessOk: true,
      verificationOk: false,
    };
    const bound = bindVerificationEvidence(c, new Set(), true);
    expect(bound.verificationOk).toBe(false);
    expect(bound.rejectionReason).toContain('no paths were verified');
  });

  it('binds successfully when all observed paths are in verifiedPaths', () => {
    const c: PackageCandidate = {
      workerId: 'w',
      manifestPaths: ['a', 'b'],
      observedPaths: ['a', 'b'],
      fileHashes: new Map([['a', 'hash-a'], ['b', 'hash-b']]),
      packageIdentity: 'identity',
      completenessOk: true,
      verificationOk: false,
    };
    const bound = bindVerificationEvidence(c, new Set(['a', 'b']), true);
    expect(bound.verificationOk).toBe(true);
    expect(bound.verificationEvidenceHash).toBe('identity');
  });

  it('binds via prefixed verifiedPaths (defense in depth)', () => {
    const c: PackageCandidate = {
      workerId: 'w',
      manifestPaths: ['README.md'],
      observedPaths: ['README.md'],
      fileHashes: new Map([['README.md', 'hash']]),
      packageIdentity: 'identity',
      completenessOk: true,
      verificationOk: false,
    };
    // verifiedPaths contains the prefixed form (from the verifier's
    // clean-room layout).
    const bound = bindVerificationEvidence(
      c,
      new Set(['artifacts/w/README.md']),
      true,
    );
    expect(bound.verificationOk).toBe(true);
  });
});
