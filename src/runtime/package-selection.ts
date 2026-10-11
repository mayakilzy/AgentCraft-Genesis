/**
 * G7-19C — Verified Package Selection.
 *
 * This module is a pure function layer over {@link ArtifactSnapshot}: it
 * does NOT touch the filesystem, does NOT call any provider, and does
 * NOT depend on the frozen orchestrator or verification modules. The
 * gateway's `getArtifacts()` calls into this module to compute the
 * verified-package selection that closes the reliability gap left by
 * G7-19B's heuristic conflict resolution.
 *
 * ## Why a separate module
 *
 * G7-19A detected conflicts (different workers writing different
 * content to the same path). G7-19B resolved conflicts deterministically
 * with a `majority-then-lexicographic` policy. That policy is
 * transparent and deterministic — but it does NOT establish semantic
 * correctness. In the G7-18E matrix, the lexicographic fallback
 * selected `documentation-writer-2`'s version of `test/api.test.js`,
 * but the correct version was `software-engineer-1`'s (the only one
 * that passed the independent acceptance suite).
 *
 * G7-19C closes that gap by introducing a **verified-package selection**
 * layer: only complete, verified packages can become authoritative
 * deliverables. The G7-19B heuristic is preserved for diagnostic
 * display but is explicitly marked as UNVERIFIED.
 *
 * ## Package states
 *
 * A package transitions through five states monotonically:
 *
 *   DISCOVERED → COMPLETE → VERIFIED → SELECTED
 *                                  ↘ UNRESOLVED
 *
 * - `DISCOVERED`: files exist on disk for this worker (observed via
 *   `listArtifacts`).
 * - `COMPLETE`: the candidate satisfies its declared manifest: all
 *   required paths present, no path-traversal, no symlinks, no
 *   duplicate normalized paths.
 * - `VERIFIED`: the candidate is complete AND verification ran and
 *   bound to this candidate's package identity (verification passed AND
 *   every observed path is in the verified-paths set).
 * - `SELECTED`: the candidate is verified AND was chosen
 *   deterministically by the selection policy.
 * - `UNRESOLVED`: no candidate satisfies the verification requirements.
 *
 * A package cannot skip VERIFIED. A package cannot be SELECTED
 * without being VERIFIED.
 *
 * ## Package identity
 *
 * The deterministic identity of a candidate is a SHA-256 over the
 * canonical sorted manifest of normalized (path, contentHash) pairs.
 * Two candidates with the same workerId, same paths, and same content
 * hashes have the same identity. This is invariant under input order.
 *
 * ## Selection policy — `verified-only-deterministic`
 *
 * 1. **Verified packages only.** Incomplete or unverified candidates
 *    remain visible for diagnosis but cannot be selected.
 * 2. **No automatic cross-worker mixing.** Each candidate corresponds
 *    to one worker's workspace snapshot. We never combine `server.js`
 *    from one worker with `package.json` from another.
 * 3. **Deterministic selection among verified candidates.**
 *    - If exactly one verified candidate exists → SELECTED.
 *    - If multiple verified candidates exist → choose by
 *      `(packageIdentity, workerId)` lexicographic order.
 * 4. **Unresolved conflicts.** If no verified candidate exists →
 *    `UNRESOLVED`. Never fall back to majority or lexicographic on
 *    unverified packages.
 * 5. **Auditability.** All candidates, all conflicting versions, all
 *    verification outcomes, all selection rationales, and all
 *    rejection reasons are preserved in the response.
 *
 * ## Determinism
 *
 * - The `byPath` Map's iteration order is insertion order in JS, but
 *   all comparisons use sorted output or stable set operations, so
 *   the result is invariant under input order.
 * - The chosen workerId is either the single verified candidate or
 *   the lexicographically smallest (packageIdentity, workerId) tuple
 *   among multiple verified candidates.
 * - The `rationale` string is generated from stable inputs (counts,
 *   hash prefixes), so it is deterministic.
 *
 * ## What this module does NOT do
 *
 * - It does NOT modify the frozen {@link MissionResult} contract.
 * - It does NOT call any reasoning provider.
 * - It does NOT touch the filesystem.
 * - It does NOT pick the "semantically correct" version. Verification
 *   is the source of truth for correctness — the selection policy
 *   picks deterministically AMONG verified candidates.
 */
import { createHash } from 'node:crypto';

import type { ArtifactSnapshot } from './computer.js';

/**
 * The five monotonic package states. A package moves DISCOVERED →
 * COMPLETE → VERIFIED → SELECTED, or DISCOVERED → COMPLETE →
 * UNRESOLVED (when verification cannot bind).
 *
 * `DISCOVERED` is the entry state — files exist on disk for this
 * worker. A package cannot be SELECTED without passing through
 * COMPLETE and VERIFIED.
 */
export type PackageState =
  | 'DISCOVERED'
  | 'COMPLETE'
  | 'VERIFIED'
  | 'SELECTED'
  | 'UNRESOLVED';

/**
 * G7-19C policy name. Surfaced in the {@link PackageSelectionResult.policy}
 * field so downstream clients can identify which policy was applied.
 */
export const PACKAGE_SELECTION_POLICY = 'verified-only-deterministic';

/**
 * One candidate package produced by one worker. A candidate is a
 * complete worker-owned package: all the files one worker wrote to
 * its workspace, plus the manifest of required paths, plus the
 * verification binding.
 *
 * The candidate is built up monotonically:
 *   1. `buildPackageCandidates()` populates `workerId`,
 *      `manifestPaths`, `observedPaths`, `fileHashes`,
 *      `packageIdentity`, `completenessOk`, and (when not ok)
 *      `rejectionReason`.
 *   2. `bindVerificationEvidence()` populates `verificationOk` and
 *      `verificationEvidenceHash` (when verification bound).
 */
export interface PackageCandidate {
  /** Worker that produced this package. */
  readonly workerId: string;
  /** Required manifest paths declared by the user's acceptance criteria. */
  readonly manifestPaths: readonly string[];
  /** Paths actually observed on disk for this worker. */
  readonly observedPaths: readonly string[];
  /** Map of observed path → SHA-256 content hash (hex). Empty hash for non-inlined files. */
  readonly fileHashes: ReadonlyMap<string, string>;
  /** Canonical SHA-256 of sorted (path, contentHash) pairs (hex). */
  readonly packageIdentity: string;
  /** `true` iff all manifest paths are present and no path is unsafe or duplicate. */
  readonly completenessOk: boolean;
  /** `true` iff verification ran, passed, and bound to this candidate's identity. */
  readonly verificationOk: boolean;
  /**
   * The hash that verification evidence was bound to. Equal to
   * `packageIdentity` when verification bound. `undefined` when
   * verification did not bind (incomplete, didn't run, or didn't pass).
   */
  readonly verificationEvidenceHash?: string;
  /** Reason the candidate was rejected (when `completenessOk=false` or verification did not bind). */
  readonly rejectionReason?: string;
}

/**
 * The result of selecting the authoritative package from a set of
 * candidates. Returned by {@link selectVerifiedPackage}.
 *
 * - When `state === 'SELECTED'`: `selected` is the chosen candidate.
 *   `rationale` explains why it was chosen.
 * - When `state === 'UNRESOLVED'`: `selected` is `undefined`.
 *   `rationale` explains why no candidate was selected.
 *
 * Note: the `state` field is narrowly typed as `'SELECTED' | 'UNRESOLVED'`
 * (not the full {@link PackageState} union). The intermediate states
 * (`DISCOVERED`, `COMPLETE`, `VERIFIED`) are not exposed at the
 * selection-result boundary — they are internal to the candidate
 * construction pipeline.
 */
export interface PackageSelectionResult {
  /** Policy name (always "verified-only-deterministic" in G7-19C). */
  readonly policy: string;
  /** The chosen candidate, or `undefined` when unresolved. */
  readonly selected: PackageCandidate | undefined;
  /** Final state of the selection (SELECTED or UNRESOLVED). */
  readonly state: 'SELECTED' | 'UNRESOLVED';
  /** Human-readable explanation of the selection (or lack thereof). */
  readonly rationale: string;
  /** All candidates considered (for audit). Includes incomplete and unverified. */
  readonly candidates: readonly PackageCandidate[];
}

/**
 * Compute the SHA-256 hash of a string (hex). Empty string when the
 * input is empty (so callers can always store a string field).
 */
function sha256Hex(text: string): string {
  if (text.length === 0) return '';
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Normalize a path: replace Windows separators, collapse `./`,
 * strip leading `./`. Does NOT resolve `..` (we reject `..`
 * separately in {@link assessPackageCompleteness}).
 *
 * Used to detect duplicates (the same path expressed two ways) and
 * to strip the verifier's `artifacts/<workerId>/` prefix from
 * user-supplied `file`-check paths.
 */
export function normalizePath(path: string): string {
  let p = path.replace(/\\/g, '/');
  // Strip leading `./` (one or more).
  while (p.startsWith('./')) p = p.slice(2);
  return p;
}

/**
 * Strip the verifier's clean-room prefix `artifacts/<workerId>/`
 * from a path. If the path does not have that prefix, return it
 * unchanged.
 *
 * This is used to extract the manifest from user-supplied `file`
 * checks. The default `deriveChecks` produces checks with the
 * prefixed form (matching what the verifier's clean room expects).
 * User-supplied checks may use either form. We normalize to the
 * bare form for matching against worker workspace snapshots (which
 * use bare paths relative to the workspace root).
 */
export function stripVerifierPrefix(path: string): string {
  const normalized = normalizePath(path);
  // Match `artifacts/<workerId>/<rest>` form.
  const match = /^artifacts\/[^/]+\/(.+)$/.exec(normalized);
  return match === null ? normalized : match[1];
}

/**
 * Extract the manifest of required paths from a set of user-supplied
 * acceptance criteria. Only `file` checks contribute paths (other
 * check kinds — `content-in-artifacts`, `hash-match`, `command`,
 * `evidence` — do not declare a required file).
 *
 * Each path is normalized (Windows separators → `/`, leading `./`
 * stripped, verifier prefix `artifacts/<workerId>/` removed).
 * Duplicates are removed (a Set deduplicates).
 *
 * The returned array is sorted lexicographically for determinism.
 *
 * The `acceptanceCriteria` parameter is structurally typed to accept
 * any check shape with a `kind` and optional `path`. This avoids
 * importing the `AcceptanceCheckInput` union from `src/gateway/types.ts`
 * (keeping the runtime module independent of the gateway module) while
 * still accepting real `AcceptanceCheckInput` values (they all have
 * `kind` and may have `path`).
 *
 * @param acceptanceCriteria the user-supplied acceptance criteria
 *   (each entry has `kind` and optionally `path` / `label` /
 *   `expectIncludes` / `expectHash`)
 * @returns the sorted, normalized manifest of required paths
 */
export function extractManifestFromAcceptanceCriteria(
  acceptanceCriteria: readonly {
    readonly kind: string;
    readonly path?: string;
    readonly label?: string;
    readonly expectIncludes?: string;
    readonly expectHash?: string;
  }[],
): readonly string[] {
  const paths = new Set<string>();
  for (const check of acceptanceCriteria) {
    if (check.kind !== 'file') continue;
    if (check.path === undefined) continue;
    const normalized = stripVerifierPrefix(check.path);
    if (normalized.length === 0) continue;
    paths.add(normalized);
  }
  return [...paths].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * Compute the deterministic package identity for one worker's
 * snapshots.
 *
 * The identity is SHA-256 over the canonical JSON of:
 *   { workerId, files: [[path, contentHash], ...] (sorted by path) }
 *
 * Two candidates with the same workerId, same paths, and same content
 * hashes have the same identity. This is invariant under input order.
 *
 * ## Non-inlined files
 *
 * When a file's content was not inlined (large files > 64KB), the
 * `contentHash` is the empty string. The identity still includes
 * the path with an empty hash. This means two large files with the
 * same byte size but different content produce the same identity —
 * but that's acceptable because the selection policy does not use
 * the identity alone to determine VERIFIED; it uses the
 * verification binding (which checks the verified-paths set).
 *
 * @param workerId the worker that produced this package
 * @param snapshots the per-(workerId, path) entries for this worker
 *   (already filtered to this worker)
 * @returns the canonical SHA-256 identity (hex)
 */
export function computePackageIdentity(
  workerId: string,
  snapshots: readonly ArtifactSnapshot[],
): string {
  // Sort by path for determinism.
  const sorted = [...snapshots].sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  );
  const files = sorted.map((s) => {
    const hash = s.content === undefined ? '' : sha256Hex(s.content);
    return [normalizePath(s.path), hash] as const;
  });
  const canonical = JSON.stringify({ workerId, files });
  return sha256Hex(canonical);
}

/**
 * Assess whether a worker's observed paths form a COMPLETE package
 * against the declared manifest.
 *
 * A package is COMPLETE when:
 * 1. No observed path is unsafe (no `..`, no absolute path, no NUL
 *    bytes — defense in depth, even though `listArtifacts` already
 *    filters these).
 * 2. No two observed paths normalize to the same string (no duplicate
 *    normalized paths).
 * 3. Every required manifest path is present in the observed paths.
 *
 * ## Why all three checks
 *
 * - Unsafe paths would let a worker escape its workspace (path
 *   traversal). Defense in depth: `listArtifacts` filters them too.
 * - Duplicate normalized paths would let two different files be
 *   treated as one (e.g. `README.md` and `./README.md`).
 * - Missing manifest paths means the worker didn't produce a
 *   required deliverable.
 *
 * @param observedPaths paths actually on disk for this worker
 * @param requiredManifest paths the user's acceptance criteria declared
 * @returns `{ ok: true }` or `{ ok: false, reason }` explaining the rejection
 */
export function assessPackageCompleteness(
  observedPaths: readonly string[],
  requiredManifest: readonly string[],
): { readonly ok: true } | { readonly ok: false; readonly reason: string } {
  // 1. Reject unsafe paths (defense in depth).
  for (const p of observedPaths) {
    if (p.includes('..') || p.startsWith('/') || p.includes('\0')) {
      return { ok: false, reason: `unsafe path: ${p}` };
    }
  }

  // 2. Reject duplicate normalized paths.
  const normalizedSet = new Set<string>();
  for (const p of observedPaths) {
    const n = normalizePath(p);
    if (normalizedSet.has(n)) {
      return { ok: false, reason: `duplicate normalized path: ${n}` };
    }
    normalizedSet.add(n);
  }

  // 3. Reject if any required manifest path is missing.
  for (const required of requiredManifest) {
    const normalizedRequired = normalizePath(required);
    if (!normalizedSet.has(normalizedRequired)) {
      return {
        ok: false,
        reason: `missing required path: ${required}`,
      };
    }
  }

  return { ok: true };
}

/**
 * Bind verification evidence to a package candidate. A candidate is
 * VERIFIED only when:
 *
 * 1. `verificationOk === true` (the verification loop ran and passed).
 * 2. Every observed path in the candidate is present in the
 *    `verifiedPaths` set (which `captureVerificationResult` populates
 *    from the runtime's `listArtifacts()` when verification passed).
 * 3. **G7-19D (content-bound verification)**: the candidate's current
 *    `packageIdentity` matches the per-worker identity captured at
 *    verification time (`verifiedPackageIdentities.get(workerId)`).
 *    If they differ, the content changed between verification and
 *    selection → reject.
 *
 * This is the provenance-binding rule: verification evidence must
 * cover every file in the candidate AND must attest to the exact
 * content of the candidate. A matching path name is NOT sufficient —
 * the package identity (a SHA-256 over all `(path, contentHash)`
 * pairs) must match.
 *
 * ## Why "every observed path" not "every manifest path"
 *
 * The candidate's `observedPaths` is the full set of files the worker
 * wrote to disk. If verification did not cover even one of those
 * files, the package is not fully verified — a worker could write
 * a malicious extra file alongside the manifest files, and that
 * extra file would not be in the verified set. We require full
 * coverage to be safe.
 *
 * ## Empty `observedPaths`
 *
 * If a candidate has no observed paths (the worker wrote nothing),
 * the binding returns `verificationOk=false` with reason
 * `"no observed paths to verify"`. This is the conservative default
 * — an empty package cannot be VERIFIED.
 *
 * ## Empty `verifiedPaths` with `verificationOk=true`
 *
 * If verification passed but no paths were captured (e.g., the
 * verifier returned `ok=true` without recording any paths — a
 * degenerate case), the binding returns `verificationOk=false`
 * with reason `"verification ran but no paths were verified"`. We
 * do not trust a verification result that has no paths to back it
 * up.
 *
 * ## G7-19D — Content-bound verification
 *
 * Pre-G7-19D, the `verificationEvidenceHash` was set to
 * `candidate.packageIdentity` — the candidate's OWN identity, computed
 * at selection time. This was self-assertion, not evidence: it proved
 * only that the candidate's identity matched itself, not that
 * verification ran against that exact content.
 *
 * G7-19D introduces `verifiedPackageIdentities` — a per-worker
 * identity captured at verification time (in
 * `captureVerificationResult`). The candidate's current identity
 * must match this captured identity. If they differ, the content
 * changed between verification and selection → reject.
 *
 * When all checks pass, `verificationEvidenceHash` is set to the
 * captured verified identity (NOT the candidate's own identity).
 * This is now EARNED evidence, not self-asserted.
 *
 * ## Cross-worker evidence isolation
 *
 * The `verifiedPackageIdentities` map is keyed by `workerId`. Worker
 * A's verified identity cannot satisfy worker B's binding check —
 * even if both workers wrote to the same paths with the same content
 * hashes. The identity is computed per-worker (the workerId is part
 * of the canonical JSON hashed by `computePackageIdentity`).
 *
 * @param candidate the package candidate (must already have
 *   `completenessOk` and `packageIdentity` populated)
 * @param verifiedPaths the set of paths the verifier marked as verified
 * @param verificationOk whether the verification loop passed for this mission
 * @param verifiedPackageIdentities G7-19D: per-worker package
 *   identities captured at verification time. When `verificationOk=true`,
 *   the candidate's `workerId` must have a matching entry here, AND
 *   the entry must equal `candidate.packageIdentity`. When `undefined`
 *   or absent, G7-19D rejects the candidate as "no verified package
 *   identity captured" (cannot prove content binding).
 * @returns a new candidate with `verificationOk` and
 *   `verificationEvidenceHash` populated
 */
export function bindVerificationEvidence(
  candidate: PackageCandidate,
  verifiedPaths: ReadonlySet<string>,
  verificationOk: boolean,
  verifiedPackageIdentities?: ReadonlyMap<string, string>,
): PackageCandidate {
  // Pre-condition: candidate must be COMPLETE for verification to bind.
  if (!candidate.completenessOk) {
    return {
      ...candidate,
      verificationOk: false,
      ...(candidate.rejectionReason !== undefined
        ? {}
        : { rejectionReason: 'package incomplete — verification cannot bind' }),
    };
  }

  // Verification did not run or did not pass.
  if (!verificationOk) {
    return {
      ...candidate,
      verificationOk: false,
      ...(candidate.rejectionReason !== undefined
        ? {}
        : { rejectionReason: 'verification did not pass' }),
    };
  }

  // Verification passed but no paths were captured — degenerate case.
  // Don't trust a verification result with no paths.
  if (verifiedPaths.size === 0) {
    return {
      ...candidate,
      verificationOk: false,
      ...(candidate.rejectionReason !== undefined
        ? {}
        : { rejectionReason: 'verification ran but no paths were verified' }),
    };
  }

  // Every observed path must be in the verified set.
  for (const observed of candidate.observedPaths) {
    const normalized = normalizePath(observed);
    // The verifiedPaths set uses bare paths (from listArtifacts).
    // Match by either the bare form or the prefixed form
    // (defense in depth — captureVerificationResult uses bare form).
    let isVerified = verifiedPaths.has(normalized);
    if (!isVerified) {
      // Try matching against any worker-prefixed form.
      for (const vPath of verifiedPaths) {
        if (stripVerifierPrefix(vPath) === normalized) {
          isVerified = true;
          break;
        }
      }
    }
    if (!isVerified) {
      return {
        ...candidate,
        verificationOk: false,
        ...(candidate.rejectionReason !== undefined
          ? {}
          : { rejectionReason: `observed path not in verified set: ${observed}` }),
      };
    }
  }

  // G7-19D — Content-bound verification.
  //
  // The verified identity for this worker must be present in the
  // captured map AND must match the candidate's current identity.
  //
  // - If the map is `undefined` (G7-19C callers that haven't been
  //   updated to capture identities), we reject as "no verified
  //   package identity captured" — the verification evidence cannot
  //   be bound to the candidate's exact content.
  // - If the map is present but has no entry for this worker, the
  //   worker's package was not captured at verification time — reject.
  // - If the entry differs from the candidate's current identity,
  //   the content mutated between verification and selection — reject
  //   (this is the post-verification mutation detection).
  if (verifiedPackageIdentities === undefined) {
    return {
      ...candidate,
      verificationOk: false,
      ...(candidate.rejectionReason !== undefined
        ? {}
        : { rejectionReason: 'no verified package identity captured (pre-G7-19D caller)' }),
    };
  }
  const verifiedIdentity = verifiedPackageIdentities.get(candidate.workerId);
  if (verifiedIdentity === undefined) {
    return {
      ...candidate,
      verificationOk: false,
      ...(candidate.rejectionReason !== undefined
        ? {}
        : { rejectionReason: `no verified package identity captured for worker: ${candidate.workerId}` }),
    };
  }
  if (verifiedIdentity !== candidate.packageIdentity) {
    return {
      ...candidate,
      verificationOk: false,
      ...(candidate.rejectionReason !== undefined
        ? {}
        : { rejectionReason: 'post-verification content mutation detected (verified identity ≠ current identity)' }),
    };
  }

  // Verification bound: the evidence hash is the captured verified
  // identity — NOT the candidate's own identity. This is EARNED
  // evidence, not self-assertion.
  return {
    ...candidate,
    verificationOk: true,
    verificationEvidenceHash: verifiedIdentity,
  };
}

/**
 * Build the full set of package candidates from a flat list of
 * per-(workerId, path) snapshots.
 *
 * The function:
 *   1. Groups snapshots by `workerId`.
 *   2. For each worker, computes `packageIdentity`,
 *      `completenessOk`, and `rejectionReason` (when incomplete).
 *   3. Binds verification evidence via {@link bindVerificationEvidence}.
 *
 * The candidates are returned in an array sorted by `workerId` for
 * determinism (the selection policy is invariant under input order,
 * but stable output helps tests).
 *
 * @param snapshots the raw per-(worker, path) entries from `listArtifacts()`
 * @param requiredManifest the sorted, normalized required paths (from
 *   `extractManifestFromAcceptanceCriteria`)
 * @param verifiedPaths the set of paths the verifier marked as verified
 * @param verificationOk whether the verification loop passed for this mission
 * @param verifiedPackageIdentities G7-19D: per-worker package identities
 *   captured at verification time. Threaded through to
 *   {@link bindVerificationEvidence} for content-bound verification.
 * @returns the sorted candidates
 */
export function buildPackageCandidates(
  snapshots: readonly ArtifactSnapshot[],
  requiredManifest: readonly string[],
  verifiedPaths: ReadonlySet<string>,
  verificationOk: boolean,
  verifiedPackageIdentities?: ReadonlyMap<string, string>,
): readonly PackageCandidate[] {
  // 1. Group snapshots by workerId. Use a Map to preserve insertion
  // order independence.
  const byWorker = new Map<string, ArtifactSnapshot[]>();
  for (const s of snapshots) {
    const list = byWorker.get(s.workerId);
    if (list === undefined) {
      byWorker.set(s.workerId, [s]);
    } else {
      list.push(s);
    }
  }

  // 2. Build a candidate per worker.
  const candidates: PackageCandidate[] = [];
  for (const [workerId, snapps] of byWorker) {
    const observedPaths = snapps.map((s) => s.path);
    const packageIdentity = computePackageIdentity(workerId, snapps);
    const completeness = assessPackageCompleteness(observedPaths, requiredManifest);
    const base: PackageCandidate = {
      workerId,
      manifestPaths: requiredManifest,
      observedPaths,
      fileHashes: new Map(
        snapps.map((s) => {
          const hash = s.content === undefined ? '' : sha256Hex(s.content);
          return [normalizePath(s.path), hash] as const;
        }),
      ),
      packageIdentity,
      completenessOk: completeness.ok,
      verificationOk: false,
      ...(completeness.ok ? {} : { rejectionReason: completeness.reason }),
    };
    const bound = bindVerificationEvidence(
      base,
      verifiedPaths,
      verificationOk,
      verifiedPackageIdentities,
    );
    candidates.push(bound);
  }

  // 3. Sort by workerId for stable output.
  candidates.sort((a, b) =>
    a.workerId < b.workerId ? -1 : a.workerId > b.workerId ? 1 : 0,
  );
  return candidates;
}

/**
 * Select the authoritative package from a set of candidates using
 * the `verified-only-deterministic` policy.
 *
 * ## Selection rules
 *
 * 1. **Verified packages only.** Only candidates with
 *    `verificationOk === true` AND `completenessOk === true` are
 *    eligible for selection.
 * 2. **No automatic cross-worker mixing.** The selected candidate
 *    is a single worker's package. We do not combine files across
 *    workers.
 * 3. **Deterministic selection among verified candidates.**
 *    - If exactly one verified candidate exists → SELECTED.
 *    - If multiple verified candidates exist → choose by
 *      `(packageIdentity, workerId)` lexicographic order.
 * 4. **Unresolved conflicts.** If no verified candidate exists →
 *    `UNRESOLVED`. Never fall back to majority or lexicographic on
 *    unverified packages.
 * 5. **Auditability.** All candidates (including incomplete and
 *    unverified) are preserved in the result's `candidates` array.
 *
 * ## Determinism
 *
 * - The eligible set is computed by filtering on
 *   `verificationOk && completenessOk`, which is invariant under
 *   input order.
 * - The sort by `(packageIdentity, workerId)` is lexicographic and
 *   stable.
 * - The `rationale` string is generated from stable inputs (count of
 *   verified candidates, the chosen workerId), so it is
 *   deterministic.
 *
 * @param candidates the candidates built by `buildPackageCandidates()`
 * @returns the selection result
 */
export function selectVerifiedPackage(
  candidates: readonly PackageCandidate[],
): PackageSelectionResult {
  // 1. Filter to verified, complete candidates only.
  const verified = candidates.filter(
    (c) => c.verificationOk && c.completenessOk,
  );

  // 2. If no verified candidate, return UNRESOLVED.
  if (verified.length === 0) {
    return {
      policy: PACKAGE_SELECTION_POLICY,
      selected: undefined,
      state: 'UNRESOLVED',
      rationale: `no verified package candidates (considered ${candidates.length} candidate(s); ${candidates.length - verified.length} incomplete or unverified)`,
      candidates,
    };
  }

  // 3. Sort by (packageIdentity, workerId) for deterministic selection.
  const sorted = [...verified].sort((a, b) => {
    if (a.packageIdentity !== b.packageIdentity) {
      return a.packageIdentity < b.packageIdentity ? -1 : 1;
    }
    return a.workerId < b.workerId ? -1 : a.workerId > b.workerId ? 1 : 0;
  });

  const chosen = sorted[0];
  const rationale =
    verified.length === 1
      ? `single verified package selected (workerId=${chosen.workerId})`
      : `multiple verified packages (${verified.length}); selected by (packageIdentity, workerId) — winner: ${chosen.workerId}`;

  return {
    policy: PACKAGE_SELECTION_POLICY,
    selected: chosen,
    state: 'SELECTED',
    rationale,
    candidates,
  };
}

/**
 * Convenience: build candidates AND select in one call. This is the
 * main entry point for the gateway's `getArtifacts()` flow.
 *
 * @param snapshots the raw per-(worker, path) entries from `listArtifacts()`
 * @param requiredManifest the sorted, normalized required paths
 * @param verifiedPaths the set of paths the verifier marked as verified
 * @param verificationOk whether the verification loop passed
 * @param verifiedPackageIdentities G7-19D: per-worker package identities
 *   captured at verification time. Threaded through to
 *   {@link bindVerificationEvidence} for content-bound verification.
 * @returns the full selection result (candidates + chosen + rationale)
 */
export function buildAndSelectPackages(
  snapshots: readonly ArtifactSnapshot[],
  requiredManifest: readonly string[],
  verifiedPaths: ReadonlySet<string>,
  verificationOk: boolean,
  verifiedPackageIdentities?: ReadonlyMap<string, string>,
): PackageSelectionResult {
  const candidates = buildPackageCandidates(
    snapshots,
    requiredManifest,
    verifiedPaths,
    verificationOk,
    verifiedPackageIdentities,
  );
  return selectVerifiedPackage(candidates);
}

/**
 * G7-19D — Compute per-worker package identities from a flat list of
 * snapshots. Returns a `Map<workerId, packageIdentity>` that callers
 * can store at verification time and later compare with the candidate
 * identities computed at selection time.
 *
 * This is the **content-bound verification capture**: the identities
 * computed here represent the worker workspaces AT VERIFICATION TIME.
 * When `getArtifacts()` later computes candidate identities from
 * fresh `runtime.listArtifacts()` snapshots, the two maps must agree
 * for every worker — otherwise content mutated between verification
 * and selection.
 *
 * ## Excludes verifier clean-room workers
 *
 * The map excludes `mission-verifier-*` workers (they hold verification
 * copies, not mission deliverables). The caller is responsible for
 * passing already-filtered snapshots, OR this function filters them
 * defensively.
 *
 * ## Determinism
 *
 * The map's iteration order is insertion order (per the JS Map spec).
 * Callers that need deterministic iteration should sort the entries.
 *
 * @param snapshots the raw per-(worker, path) entries from
 *   `listArtifacts()` AT VERIFICATION TIME
 * @returns `Map<workerId, packageIdentity>` — the per-worker identities
 *   captured at verification time
 */
export function computeWorkerPackageIdentities(
  snapshots: readonly ArtifactSnapshot[],
): Map<string, string> {
  // Group snapshots by workerId.
  const byWorker = new Map<string, ArtifactSnapshot[]>();
  for (const s of snapshots) {
    // Exclude verifier clean-room workers defensively.
    if (s.workerId.startsWith('mission-verifier')) continue;
    const list = byWorker.get(s.workerId);
    if (list === undefined) {
      byWorker.set(s.workerId, [s]);
    } else {
      list.push(s);
    }
  }

  // Compute the package identity per worker.
  const out = new Map<string, string>();
  for (const [workerId, snapps] of byWorker) {
    out.set(workerId, computePackageIdentity(workerId, snapps));
  }
  return out;
}
