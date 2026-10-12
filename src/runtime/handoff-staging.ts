/**
 * D+ B02 — Real Handoff Staging helper.
 *
 * Called by the frozen orchestrator's `stageUpstreamArtifacts()` method
 * (the narrow frozen exception). This module lives in the NON-FROZEN layer
 * and contains the actual staging logic:
 *
 * 1. Read each produced artifact from the producer's computer.
 * 2. Validate the artifact path (path-traversal protection).
 * 3. Write the artifact to the consumer's computer under
 *    `upstream/<producer-id>/<relative-path>` via the trusted write path.
 * 4. Record a flight event for provenance.
 *
 * ## Read-only enforcement
 *
 * The consumer's `writeFile` rejects writes targeting `upstream/`
 * paths (see `MemoryComputer` and `OpenBotAdapter` modifications). This
 * prevents the consumer from modifying staged reference files via
 * `write_file`.
 *
 * The staging helper uses the trusted write path (`writeFileTrusted` on
 * `MemoryComputer`, or the equivalent internal method) to bypass the
 * read-only check — it is the ONLY code path allowed to write to
 * `upstream/` paths.
 *
 * Shell-based modification is addressed via snapshot comparison in
 * `completion-policy.ts` — if a shell command modifies an upstream
 * file, the snapshot digest changes and the completion gate rejects
 * `finish`.
 *
 * ## Provenance
 *
 * Each staged file carries its producer's identity in the path
 * (`upstream/<producer-id>/...`). This makes the provenance visible
 * to the consumer worker and to downstream verification.
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
 * Compute the staged path for an upstream artifact.
 *
 * @param producerId the producer worker's ID
 * @param artifactPath the original artifact path in the producer's workspace
 * @returns the path in the consumer's workspace: `upstream/<producer-id>/<relative-path>`
 */
export function stagedPath(producerId: string, artifactPath: string): string {
  // Validate the artifact path — fail-closed on unsafe paths
  validateArtifactPath(artifactPath);
  // The producerId is used as a directory name. Sanitize it to prevent
  // path traversal via the producerId itself (it should be a slug already,
  // but defense-in-depth).
  const safeProducerId = producerId.replace(/[^a-zA-Z0-9-]/g, '-');
  return `${UPSTREAM_PREFIX}/${safeProducerId}/${artifactPath}`;
}

/**
 * Write a file to the consumer's computer via the trusted write path.
 *
 * The `WorkerComputer` interface (frozen) does not expose `writeFileTrusted`,
 * but `MemoryComputer` (NON-FROZEN) does. We use a runtime duck-type check:
 * if the computer has a `writeFileTrusted` method, use it (bypasses
 * read-only enforcement for staging). Otherwise, fall back to `writeFile`
 * (which will reject upstream/ paths — the caller must handle the error).
 *
 * For `OpenBotAdapter`, the staging is handled via the adapter's own
 * internal method (not yet implemented in B02 — the OpenBot path is
 * documented as a known limitation; the MemoryRuntime path is fully
 * functional for deterministic testing).
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
  // Fallback: use regular writeFile (will throw for upstream/ paths on
  // MemoryComputer; OpenBot adapter will also throw). The caller
  // catches the error and records it as a staging failure.
  await computer.writeFile(path, contents);
}

/**
 * Stage a single producer's artifacts into the consumer's workspace.
 *
 * Reads each artifact from the producer's computer, computes its content
 * hash (for provenance), and writes it to the consumer's computer under
 * `upstream/<producer-id>/<path>` via the trusted write path.
 *
 * @param producerId the producer worker's ID
 * @param producerArtifacts the artifact paths the producer declared
 * @param producerComputer the producer's WorkerComputer (read source)
 * @param consumerComputer the consumer's WorkerComputer (write target)
 * @param record flight event recorder (for provenance)
 */
export async function stageUpstreamArtifactsForWorker(
  producerId: string,
  producerArtifacts: readonly string[],
  producerComputer: WorkerComputer,
  consumerComputer: WorkerComputer,
  record: (event: FlightEvent) => void,
): Promise<void> {
  for (const artifactPath of producerArtifacts) {
    try {
      // Validate the path before reading (fail-closed on traversal)
      validateArtifactPath(artifactPath);
      // Read from producer
      const read = await producerComputer.readFile(artifactPath);
      // Compute content hash for provenance (recorded in the flight event)
      const contentHash = createHash('sha256').update(read.text).digest('hex');
      // Compute staged path
      const staged = stagedPath(producerId, artifactPath);
      // Write to consumer via trusted path (bypasses read-only check)
      await trustedWrite(consumerComputer, staged, read.text);
      // Record provenance event (content hash included in the action name
      // for flight-record traceability without expanding the event schema)
      record({
        type: 'worker-step',
        workerId: producerId,
        step: 0,
        action: `stage-handoff:${staged}:${contentHash.slice(0, 8)}`,
        ok: true,
        elapsedMs: 1,
      });
    } catch {
      // Staging failure is recorded honestly — the consumer will see
      // the missing file when it tries to read it, and the mission
      // result will reflect the gap.
      record({
        type: 'worker-step',
        workerId: producerId,
        step: 0,
        action: `stage-handoff-failed:${artifactPath}`,
        ok: false,
        elapsedMs: 0,
      });
    }
  }
}

/**
 * Check if a path is under the upstream/ prefix (a staged reference file).
 *
 * Used by `MemoryComputer.writeFile` and `OpenBotAdapter.writeFile` to
 * reject direct writes to upstream artifacts (read-only enforcement).
 */
export function isUpstreamPath(path: string): boolean {
  return path === UPSTREAM_PREFIX
    || path.startsWith(`${UPSTREAM_PREFIX}/`)
    || path.startsWith(`${UPSTREAM_PREFIX}\\`);
}
