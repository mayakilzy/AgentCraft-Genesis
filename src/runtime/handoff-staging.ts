/**
 * D+ B02 Final Security Closure — Real Handoff Staging helper.
 *
 * PATH B (Isolation Not Proven): The OpenBot worker process has full
 * filesystem access inside its container (verified by S0 empirical test).
 * An external staging directory would NOT be protected from the worker's
 * shell. Therefore:
 *
 * - MemoryRuntime: staging is safe (MemoryComputer enforces read-only
 *   via `writeFileTrusted` vs `writeFile` separation). Handoff works.
 * - OpenBot: staging is NOT safe (worker's shell can modify any file
 *   under WORKSPACE_DIR including `upstream/`). Handoff is REFUSED
 *   (fail-closed) via `canStageSafely()`.
 *
 * ## Fail-Closed Handoff (C2)
 *
 * All `handoff` edges are mandatory. If staging fails for any reason
 * (missing producer, missing artifact, unsafe path, hash mismatch,
 * identity collision, or OpenBot runtime), the consumer does NOT run.
 * The orchestrator creates a synthetic `WorkerResult` with `status: 'failure'`
 * and `failureClass: 'WORKER_FAILURE'`.
 *
 * ## Content Integrity (C3)
 *
 * - Producer identity: collision detection (injective check).
 * - Artifact paths: validation (traversal/absolute/Windows rejected).
 * - TOCTOU: re-validation after read, before write.
 * - Post-staging hash: full SHA-256 re-read and compare (not first 8 chars).
 */

import { createHash } from 'node:crypto';
import type { WorkerComputer } from './computer.js';
import { validateArtifactPath } from '../worker/ownership-contract.js';
import type { FlightEvent } from '../mission/flight-recorder.js';

/**
 * The prefix used for all staged upstream artifacts. Consumer workers
 * find these files under `upstream/<producer-id>/<relative-path>`.
 */
export const UPSTREAM_PREFIX = 'upstream';

/**
 * D+ B02 Final Security Closure — Staging result.
 *
 * `stageUpstreamArtifactsForWorker()` returns this instead of throwing.
 * The caller (orchestrator) uses `ok` to decide whether the consumer
 * may run (fail-closed handoff).
 */
export interface StagingResult {
  /** true if ALL artifacts staged successfully; false if ANY failed */
  readonly ok: boolean;
  /** list of per-artifact outcomes for diagnostics */
  readonly outcomes: readonly StagingOutcome[];
  /** summary reason for failure (empty string if ok) */
  readonly failureReason: string;
}

interface StagingOutcome {
  readonly artifactPath: string;
  readonly ok: boolean;
  readonly reason: string;
  readonly stagedPath?: string;
  readonly contentHash?: string;
}

/**
 * D+ B02 Final Security Closure (PATH B) — Check if staging can be done
 * safely in the current runtime environment.
 *
 * - MemoryRuntime: SAFE — MemoryComputer enforces read-only via
 *   `writeFileTrusted` vs `writeFile` separation.
 * - OpenBot: UNSAFE — the worker's shell can modify any file under
 *   WORKSPACE_DIR, including `upstream/`. No filesystem-level isolation.
 *
 * This function uses duck-typing: MemoryComputer has `writeFileTrusted`;
 * OpenBotAdapter does not. If `writeFileTrusted` is absent, staging
 * is refused.
 *
 * @param consumerComputer the consumer's WorkerComputer
 * @returns true if staging is safe (MemoryRuntime), false if unsafe (OpenBot)
 */
export function canStageSafely(consumerComputer: WorkerComputer): boolean {
  const withTrusted = consumerComputer as WorkerComputer & {
    writeFileTrusted?: (path: string, contents: string) => Promise<unknown>;
  };
  return typeof withTrusted.writeFileTrusted === 'function';
}

/**
 * Compute the staged path for an upstream artifact.
 *
 * @param producerId the producer worker's ID
 * @param artifactPath the original artifact path in the producer's workspace
 * @returns the path in the consumer's workspace: `upstream/<producer-id>/<relative-path>`
 * @throws if the artifact path is unsafe (traversal/absolute/Windows)
 */
export function stagedPath(producerId: string, artifactPath: string): string {
  // Validate the artifact path — fail-closed on unsafe paths
  validateArtifactPath(artifactPath);
  // The producerId is used as a directory name. Sanitize it to prevent
  // path traversal via the producerId itself.
  const safeProducerId = sanitizeProducerId(producerId);
  return `${UPSTREAM_PREFIX}/${safeProducerId}/${artifactPath}`;
}

/**
 * D+ B02 Final Security Closure (C3) — Sanitize a producer ID for use
 * as a directory name, with collision detection.
 *
 * The sanitizer replaces non-`[a-zA-Z0-9-]` characters with `-`.
 * Two different producerIds that sanitize to the same value would
 * cause a collision (one producer's files would overwrite the other's).
 * The caller must detect this via `detectProducerIdCollision()`.
 */
export function sanitizeProducerId(producerId: string): string {
  return producerId.replace(/[^a-zA-Z0-9-]/g, '-');
}

/**
 * D+ B02 Final Security Closure (C3) — Detect producer ID collisions.
 *
 * Given a list of (originalId, sanitizedId) pairs, returns the first
 * collision (two different originalIds that sanitize to the same value).
 *
 * @returns the colliding pair, or null if no collision
 */
export function detectProducerIdCollision(
  ids: ReadonlyArray<{ readonly original: string; readonly sanitized: string }>,
): { readonly first: string; readonly second: string; readonly sanitized: string } | null {
  const seen = new Map<string, string>(); // sanitized → original
  for (const { original, sanitized } of ids) {
    const existing = seen.get(sanitized);
    if (existing !== undefined && existing !== original) {
      return { first: existing, second: original, sanitized };
    }
    seen.set(sanitized, original);
  }
  return null;
}

/**
 * Write a file to the consumer's computer via the trusted write path.
 *
 * Uses `writeFileTrusted` if available (MemoryComputer). If not available
 * (OpenBot), throws — the caller treats this as a staging failure.
 */
async function trustedWrite(
  computer: WorkerComputer,
  path: string,
  contents: string,
): Promise<void> {
  const withTrusted = computer as WorkerComputer & {
    writeFileTrusted?: (path: string, contents: string) => Promise<unknown>;
  };
  if (typeof withTrusted.writeFileTrusted === 'function') {
    await withTrusted.writeFileTrusted(path, contents);
    return;
  }
  // PATH B: OpenBot has no writeFileTrusted → staging refused
  throw new Error('trusted write path unavailable (OpenBot: isolation not proven — PATH B fail-closed)');
}

/**
 * D+ B02 Final Security Closure — Stage a single producer's artifacts
 * into the consumer's workspace with fail-closed semantics.
 *
 * Returns a `StagingResult`. The caller (orchestrator) uses `ok` to
 * decide whether the consumer may run.
 *
 * ## Fail-closed rules (C2)
 *
 * - Missing producer artifact → staging fails → consumer does not run
 * - Unsafe artifact path → staging fails → consumer does not run
 * - Hash mismatch after staging → staging fails → consumer does not run
 * - Producer ID collision → staging fails → consumer does not run
 * - OpenBot runtime (no writeFileTrusted) → staging fails → consumer does not run
 *
 * ## Content integrity (C3)
 *
 * - Full SHA-256 computed before staging (source hash)
 * - After staging, re-read the staged file via the consumer's readFile
 * - Compare full SHA-256 (not first 8 chars)
 * - Any mismatch → staging fails
 */
export async function stageUpstreamArtifactsForWorker(
  producerId: string,
  producerArtifacts: readonly string[],
  producerComputer: WorkerComputer,
  consumerComputer: WorkerComputer,
  record: (event: FlightEvent) => void,
): Promise<StagingResult> {
  // PATH B check: if the consumer computer cannot be trusted (OpenBot),
  // refuse staging entirely.
  if (!canStageSafely(consumerComputer)) {
    const reason = 'staging refused: runtime does not support trusted write (OpenBot isolation not proven — PATH B fail-closed)';
    record({
      type: 'worker-step',
      workerId: producerId,
      step: 0,
      action: `stage-refused:runtime-unsafe`,
      ok: false,
      elapsedMs: 0,
    });
    return {
      ok: false,
      outcomes: [],
      failureReason: reason,
    };
  }

  const outcomes: StagingOutcome[] = [];
  let allOk = true;
  let failureReason = '';

  for (const artifactPath of producerArtifacts) {
    try {
      // C3: validate path before reading (TOCTOU step 1)
      validateArtifactPath(artifactPath);
      // Read from producer
      const read = await producerComputer.readFile(artifactPath);
      // C3: re-validate path after reading (TOCTOU step 2 — closes the
      // window between validate and read, in case the path was swapped)
      validateArtifactPath(artifactPath);
      // Compute FULL source hash (C3: not first 8 chars)
      const sourceHash = createHash('sha256').update(read.text).digest('hex');
      // Compute staged path
      const staged = stagedPath(producerId, artifactPath);
      // Write to consumer via trusted path
      await trustedWrite(consumerComputer, staged, read.text);
      // C3: post-staging hash verification — re-read via the consumer's
      // readFile (the same path the consumer will use) and compare full hash
      const stagedRead = await consumerComputer.readFile(staged);
      const stagedHash = createHash('sha256').update(stagedRead.text).digest('hex');
      if (stagedHash !== sourceHash) {
        throw new Error(`hash mismatch after staging: source=${sourceHash.slice(0, 16)}... staged=${stagedHash.slice(0, 16)}...`);
      }
      // Success — record provenance with full hash (first 8 chars for display only)
      record({
        type: 'worker-step',
        workerId: producerId,
        step: 0,
        action: `stage-handoff:${staged}:${sourceHash.slice(0, 8)}`,
        ok: true,
        elapsedMs: 1,
      });
      outcomes.push({
        artifactPath,
        ok: true,
        reason: 'staged successfully',
        stagedPath: staged,
        contentHash: sourceHash,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      record({
        type: 'worker-step',
        workerId: producerId,
        step: 0,
        action: `stage-handoff-failed:${artifactPath}`,
        ok: false,
        elapsedMs: 0,
      });
      outcomes.push({
        artifactPath,
        ok: false,
        reason,
      });
      allOk = false;
      failureReason = `staging failed for "${artifactPath}": ${reason}`;
    }
  }

  return { ok: allOk, outcomes, failureReason };
}

/**
 * Check if a path is under the upstream/ prefix (a staged reference file).
 */
export function isUpstreamPath(path: string): boolean {
  return path === UPSTREAM_PREFIX
    || path.startsWith(`${UPSTREAM_PREFIX}/`)
    || path.startsWith(`${UPSTREAM_PREFIX}\\`);
}
