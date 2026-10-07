/**
 * G6-01 — Minimal artifact registry.
 *
 * Section 39-40 of the G6-01 mission brief require investigation of
 * whether production correctness needs a minimal artifact record, and
 * a registry with metadata (mission ID, worker ID, type, location,
 * created time, verification state, provider, lineage).
 *
 * This module is the SMALLEST artifact registry that closes the P1 H-41
 * gap ("artifact persistence"). It is NOT a content-addressable store,
 * NOT a UI backend, NOT a version-control system. It is a JSONL-backed
 * ledger of artifact records, one line per artifact, durable across
 * process restarts.
 *
 * Why JSONL (reusing existing storage primitives — Section 39):
 *   - FlightRecorder already uses JSONL per mission.
 *   - ExperienceStore uses JSON evidence files.
 *   - No new database technology (anti-bloat rule).
 *   - Append-only writes are atomic on POSIX filesystems.
 *
 * Anti-bloat: one small file. No database. No schema library. No query
 * engine. The registry answers two questions: "what artifacts did this
 * mission produce?" and "what is the content hash of this artifact?"
 */

import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The artifact type. Mirrors the existing `Evidence.kind` vocabulary so
 * the registry composes naturally with flight records.
 */
export type ArtifactType = 'artifact' | 'log' | 'test-run' | 'metric';

/**
 * The verification state of an artifact. Mirrors the VerificationResult
 * outcomes: an artifact is `unverified` until the verifier has examined
 * it, `verified` if every check that touched it passed, `failed` if any
 * check failed, and `partial` if some checks passed and some failed.
 */
export type ArtifactVerificationState =
  | 'unverified'
  | 'verified'
  | 'failed'
  | 'partial';

/**
 * A single artifact record. The fields are the minimal subset justified
 * by Section 40: verification (contentHash), recovery (missionId +
 * workerId + path), audit (createdAt + updatedAt), lineage (provider +
 * sourceWorkerId when the artifact was derived from another worker's
 * output).
 *
 * Fields NOT included (deferred to G6-06 freeze per Section 40):
 *   - artifact ID (the composite key missionId:workerId:path is unique)
 *   - version (artifacts are write-once in v1; future versions append)
 *   - UI metadata (icon, description, preview) — that is G7's concern
 */
export interface ArtifactRecord {
  /** ISO timestamp when the artifact was first recorded. */
  readonly createdAt: string;
  /** ISO timestamp of the last verification state update. */
  readonly updatedAt: string;
  /** Mission that produced the artifact. */
  readonly missionId: string;
  /** Worker that produced the artifact. */
  readonly workerId: string;
  /** Workspace-relative path of the artifact in the worker's computer. */
  readonly path: string;
  /** Artifact type (artifact, log, test-run, metric). */
  readonly type: ArtifactType;
  /** Provider that hosted the worker (openbot, opendots, openmuse). */
  readonly provider: string;
  /** SHA-256 of the artifact content (hex). Empty when content was unreadable. */
  readonly contentHash: string;
  /** Artifact size in bytes. -1 when content was unreadable. */
  readonly bytes: number;
  /** Current verification state. */
  readonly verificationState: ArtifactVerificationState;
  /**
   * When the artifact was derived from another worker's output (e.g.
   * a coordinator's integrated summary), the source worker's id. Empty
   * for primary artifacts.
   */
  readonly sourceWorkerId?: string;
}

/** Internal record format on disk (one JSON object per line). */
interface StoredRecord extends ArtifactRecord {
  readonly schemaVersion: 1;
}

const SCHEMA_VERSION = 1 as const;

/**
 * Compute the SHA-256 hash of artifact content. Returns an empty string
 * when the content is empty (so the hash field is always a valid hex
 * string or empty — never undefined).
 */
export function hashContent(content: string): string {
  if (content.length === 0) return '';
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

/**
 * Build an artifact record from raw inputs. The caller supplies the
 * content (read from the worker's computer); this function computes the
 * hash and bytes fields.
 */
export function buildArtifactRecord(input: {
  readonly missionId: string;
  readonly workerId: string;
  readonly path: string;
  readonly type?: ArtifactType;
  readonly provider: string;
  readonly content: string;
  readonly sourceWorkerId?: string;
}): ArtifactRecord {
  const now = new Date().toISOString();
  return {
    createdAt: now,
    updatedAt: now,
    missionId: input.missionId,
    workerId: input.workerId,
    path: input.path,
    type: input.type ?? 'artifact',
    provider: input.provider,
    contentHash: hashContent(input.content),
    bytes: Buffer.byteLength(input.content, 'utf8'),
    verificationState: 'unverified',
    ...(input.sourceWorkerId === undefined ? {} : { sourceWorkerId: input.sourceWorkerId }),
  };
}

/**
 * The artifact registry. Persists records to a JSONL file under a
 * caller-chosen directory (typically `data/artifact-records/` alongside
 * `data/flight-records/`). Reads are linear scans — the file is small
 * (one line per artifact, bounded by mission count).
 *
 * The registry is append-only: existing records are never modified
 * except via `updateVerificationState`, which appends a new line with
 * the same composite key and an updated `updatedAt` timestamp. Readers
 * always prefer the latest record for a given (missionId, workerId, path).
 */
export class ArtifactRegistry {
  private readonly filePath: string;

  constructor(options: { readonly dir: string; readonly filename?: string }) {
    mkdirSync(options.dir, { recursive: true });
    this.filePath = join(options.dir, options.filename ?? 'artifact-records.jsonl');
  }

  /** Persist a new artifact record. Returns the stored record. */
  record(entry: ArtifactRecord): ArtifactRecord {
    const stored: StoredRecord = { ...entry, schemaVersion: SCHEMA_VERSION };
    appendFileSync(this.filePath, `${JSON.stringify(stored)}\n`, 'utf8');
    return entry;
  }

  /**
   * Update the verification state of an artifact. Appends a new record
   * with the same composite key and an updated `updatedAt` timestamp.
   * The original record remains in the file (audit trail); readers
   * prefer the latest.
   */
  updateVerificationState(
    missionId: string,
    workerId: string,
    path: string,
    state: ArtifactVerificationState,
  ): ArtifactRecord | undefined {
    const latest = this.findLatest(missionId, workerId, path);
    if (latest === undefined) return undefined;
    const updated: ArtifactRecord = {
      ...latest,
      updatedAt: new Date().toISOString(),
      verificationState: state,
    };
    this.record(updated);
    return updated;
  }

  /** Find the latest record for a given artifact, or undefined. */
  findLatest(
    missionId: string,
    workerId: string,
    path: string,
  ): ArtifactRecord | undefined {
    const matches = this.readAll().filter(
      (r) =>
        r.missionId === missionId && r.workerId === workerId && r.path === path,
    );
    if (matches.length === 0) return undefined;
    return matches[matches.length - 1];
  }

  /** Return all records for a given mission (any worker, any path). */
  forMission(missionId: string): ArtifactRecord[] {
    return this.readAll().filter((r) => r.missionId === missionId);
  }

  /** Read all records from disk. Returns an empty array when the file does not exist. */
  readAll(): ArtifactRecord[] {
    if (!existsSync(this.filePath)) return [];
    const text = readFileSync(this.filePath, 'utf8');
    const records: ArtifactRecord[] = [];
    for (const line of text.split('\n')) {
      if (line.trim().length === 0) continue;
      try {
        const parsed = JSON.parse(line) as StoredRecord;
        if (parsed.schemaVersion !== SCHEMA_VERSION) continue;
        // Strip the schemaVersion field before returning.
        const { schemaVersion: _stripped, ...record } = parsed;
        void _stripped;
        records.push(record);
      } catch {
        // Skip malformed lines — the file is append-only and a partial
        // write should never break reads.
      }
    }
    return records;
  }

  /** Path to the underlying JSONL file (for tests and inspection). */
  get path(): string {
    return this.filePath;
  }
}
