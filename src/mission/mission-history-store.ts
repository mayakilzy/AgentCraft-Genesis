/**
 * G7-15B — Durable Mission History Store.
 *
 * Persists terminal (and recoverable-interrupted) mission records as atomic
 * per-mission JSON files on disk, mirroring the existing FileProjectStore
 * pattern (write-to-temp + atomic-rename). This closes the G7-11B prerequisite
 * "decide on restart-durable mission history" and the FM-15 failure mode
 * (mission state unavailable after restart).
 *
 * Storage layout (one file per mission — atomic rewrite-by-id):
 *   data/missions/{missionId}.mission.json
 *
 * Why a single compact file per mission (instead of the G7-12 .conv/.msgs
 * JSONL split): a mission history record has no append-only event stream.
 * The flight recorder already owns the event stream (and MissionService uses
 * the in-memory variant for live missions; file flight records are written
 * by experiments, not by the gateway). The history store persists ONLY the
 * terminal snapshot — a bounded, small, fixed-shape record. A single
 * rewrite-by-id file keeps the record atomic, simplifies restart recovery,
 * and avoids the multi-file consistency risk.
 *
 * Reuse decisions (per G7-15B "Prefer existing JSON/JSONL storage patterns"):
 *   - Atomic write pattern: copied from `src/project/project-store.ts:1030-1082`.
 *   - Corrupt-record preservation: a corrupt file is NEVER silently replaced;
 *     `readMission` returns `undefined` for malformed JSON so the caller can
 *     decide (MissionService logs and skips). The original bytes remain on
 *     disk for manual recovery (same as FileProjectStore's ProjectCorruptError
 *     philosophy, but without throwing — the history store is best-effort).
 *   - No new dependencies. Pure `node:fs` + `node:path`.
 *
 * Truthful recovery semantics (B2):
 *   - Completed missions remain SUCCEEDED after restart (recorded as-is).
 *   - Failed missions remain FAILED after restart (recorded as-is).
 *   - Interrupted missions (was RUNNING/ACCEPTED when the process died)
 *     have a persisted record showing the pre-crash status. On restart,
 *     MissionService.recoverHistory() rewrites these to FAILED with
 *     failureClass='RUNTIME_FAILURE' and a truthful failureMessage. The
 *     rewrite is itself an atomic file write, so the recovered record is
 *     durable across subsequent restarts.
 *   - Never invent success: the recovery path does NOT fabricate artifacts,
 *     verification, or a MissionResult.status='success'. The recovered
 *     MissionResult is always `status: 'failure'` with empty evidence.
 *
 * Concurrency (single-process model — same as FileProjectStore):
 *   - All store methods are SYNCHRONOUS (writeFileSync, renameSync, readFileSync).
 *   - Within a single Node.js process, concurrent calls are serialized by the
 *     event loop. Two concurrent writes to the SAME missionId are
 *     last-writer-wins (the orchestrator's terminal handler runs after the
 *     start handler, so the terminal record is the final one).
 *   - Two concurrent writes to DIFFERENT missionIds use different temp files
 *     (`.tmp.{missionId}.{pid}.{timestamp}.mission.json`), so they do not
 *     collide.
 *
 * Durability (same as FileProjectStore):
 *   - Atomic file replacement via writeFileSync(tmp) + renameSync(tmp, final).
 *   - Crash / power-loss durability: NOT claimed (no fsync). Same as
 *     FileProjectStore. Operators requiring power-loss durability must add
 *     fsync() — out of scope.
 *
 * Bounded disk behavior:
 *   - One file per mission: O(missions) files, each ~1-2 KB.
 *   - No append-only growth (rewrite-by-id; the record is fixed-shape).
 *   - The MissionService sweeper does NOT touch the history store —
 *     terminal missions are evicted from the IN-PROCESS registry but their
 *     history records persist indefinitely. A future operator tooling slice
 *     can add a history-retention sweep if disk growth becomes a concern.
 *
 * No secrets in persisted records:
 *   - The MissionService scrubs `failureMessage` and `goalOutcome` before
 *     passing them to the history store (reusing the existing scrubSecrets
 *     helper). The history store does NOT re-scrub — it trusts the caller.
 *   - The record does NOT store the full MissionResult.evidence (which could
 *     contain tool output); it stores only the summary, status, and cost.
 *   - The record does NOT store artifacts content — only artifact paths
 *     and verified flags (which are non-sensitive metadata).
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  readdirSync,
  unlinkSync,
} from 'node:fs';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const MISSION_HISTORY_SCHEMA_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * The durable mission history record. A fixed-shape, JSON-serializable
 * snapshot of a mission at a terminal (or recoverable-interrupted) state.
 *
 * This is a SUBSET of MissionSnapshot + MissionResult — it carries only
 * the fields needed for truthful post-restart recovery. It deliberately
 * does NOT duplicate the full flight event stream or artifact content.
 */
export interface MissionHistoryRecord {
  readonly schemaVersion: typeof MISSION_HISTORY_SCHEMA_VERSION;
  readonly missionId: string;
  readonly callerId: string;
  readonly label?: string;
  readonly idempotencyKey?: string;
  /** The pre-recovery status (ACCEPTED, RUNNING, or a terminal status). */
  status: MissionHistoryStatus;
  readonly acceptedAt: string;
  finishedAt?: string;
  readonly goalOutcome: string;
  /** Terminal MissionResult summary (only for terminal records). */
  resultSummary?: string;
  resultStatus?: 'success' | 'partial' | 'failure';
  readonly costUsd?: number;
  readonly costTokens?: number;
  readonly costWallMs?: number;
  readonly costHumanInterventions?: number;
  /** Failure class (existing FailureClass taxonomy). */
  failureClass?: string;
  /** Scrubbed failure message. */
  failureMessage?: string;
  /** Artifact paths + verified flags (metadata only; no content). */
  artifacts?: ReadonlyArray<{ readonly path: string; readonly verified: boolean; readonly bytes: number }>;
  /** Set to true when this record was recovered (interrupted → FAILED). */
  recoveredFromInterruption?: boolean;
}

export type MissionHistoryStatus =
  | 'ACCEPTED'
  | 'RUNNING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'PARTIAL'
  | 'CANCELLATION_REQUESTED'
  | 'CANCELLED';

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class MissionHistoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MissionHistoryError';
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Validate that an ID is a safe filesystem segment (no path traversal,
 * no null bytes, no control chars). Reused from FileProjectStore's pattern.
 */
function isSafeIdSegment(id: string): boolean {
  if (typeof id !== 'string' || id.length === 0 || id.length > 200) return false;
  if (id.includes('/') || id.includes('\\') || id.includes('..')) return false;
  if (id.includes('\0')) return false;
  // UUIDs and similar: alphanumeric + dash + underscore.
  return /^[A-Za-z0-9_-]+$/.test(id);
}

// ---------------------------------------------------------------------------
// FileMissionHistoryStore
// ---------------------------------------------------------------------------

export interface MissionHistoryStoreOptions {
  readonly dir?: string;
}

export class FileMissionHistoryStore {
  private readonly dir: string;

  constructor(options: MissionHistoryStoreOptions = {}) {
    this.dir = options.dir ?? 'data/missions';
    mkdirSync(this.dir, { recursive: true });
  }

  // --- Public API ---

  /**
   * Persist (or update) a mission history record. Atomic: write-to-temp
   * then rename. If the write fails, the previous valid file is preserved.
   */
  write(record: MissionHistoryRecord): void {
    if (record.schemaVersion !== MISSION_HISTORY_SCHEMA_VERSION) {
      throw new MissionHistoryError(
        `unsupported schemaVersion: ${record.schemaVersion}`,
      );
    }
    if (!isSafeIdSegment(record.missionId)) {
      throw new MissionHistoryError('missionId is not a safe identifier');
    }
    if (!isSafeIdSegment(record.callerId)) {
      throw new MissionHistoryError('callerId is not a safe identifier');
    }

    const finalPath = this.missionPath(record.missionId);
    const tmpPath = this.tmpPath(record.missionId);
    try {
      const payload = JSON.stringify(record, null, 2);
      writeFileSync(tmpPath, payload, 'utf8');
      // Atomic rename — POSIX rename() is atomic; the file is either the old
      // valid version or the new valid version — never partial.
      renameSync(tmpPath, finalPath);
    } catch (err) {
      // Clean up the temp file — leave the previous valid file untouched.
      try {
        if (existsSync(tmpPath)) unlinkSync(tmpPath);
      } catch {
        // Best-effort cleanup; the temp file will not be loaded (different naming).
      }
      throw err;
    }
  }

  /**
   * Read a single mission history record. Returns `undefined` if the file
   * does not exist OR is corrupt (malformed JSON / wrong schemaVersion).
   * Corrupt files are preserved on disk for manual recovery (same as
   * FileProjectStore's philosophy) — this method does NOT throw on corrupt
   * data; it logs to stderr and returns undefined so the caller can decide.
   */
  read(missionId: string): MissionHistoryRecord | undefined {
    if (!isSafeIdSegment(missionId)) return undefined;
    const path = this.missionPath(missionId);
    if (!existsSync(path)) return undefined;
    try {
      const raw = readFileSync(path, 'utf8');
      const parsed = JSON.parse(raw) as MissionHistoryRecord;
      if (parsed.schemaVersion !== MISSION_HISTORY_SCHEMA_VERSION) {
        console.error(
          `[mission-history] WARN: skipping ${missionId}: unsupported schemaVersion ${parsed.schemaVersion}`,
        );
        return undefined;
      }
      if (parsed.missionId !== missionId) {
        console.error(
          `[mission-history] WARN: skipping ${missionId}: file missionId mismatch (${parsed.missionId})`,
        );
        return undefined;
      }
      return parsed;
    } catch (err) {
      // Corrupt JSON — preserve the file, log, return undefined.
      console.error(
        `[mission-history] WARN: corrupt record for ${missionId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return undefined;
    }
  }

  /**
   * Load ALL mission history records from disk. Used at startup to rebuild
   * the in-memory history index. Corrupt records are skipped (preserved
   * on disk for manual recovery). Returns a Map keyed by missionId.
   */
  loadAll(): Map<string, MissionHistoryRecord> {
    const out = new Map<string, MissionHistoryRecord>();
    let files: string[];
    try {
      files = readdirSync(this.dir);
    } catch {
      return out; // dir does not exist or is unreadable — return empty
    }
    for (const file of files) {
      if (!file.endsWith('.mission.json')) continue;
      // Extract the missionId from the filename (strip the .mission.json suffix).
      const missionId = file.replace(/\.mission\.json$/, '');
      const record = this.read(missionId);
      if (record !== undefined) {
        out.set(missionId, record);
      }
    }
    return out;
  }

  /**
   * Delete a mission history record. Used by tests; production code does NOT
   * call this (history records persist indefinitely — a future operator
   * tooling slice can add a retention sweep).
   */
  delete(missionId: string): boolean {
    if (!isSafeIdSegment(missionId)) return false;
    const path = this.missionPath(missionId);
    if (!existsSync(path)) return false;
    try {
      unlinkSync(path);
      return true;
    } catch {
      return false;
    }
  }

  // --- Internal file I/O ---

  private missionPath(missionId: string): string {
    return join(this.dir, `${missionId}.mission.json`);
  }

  private tmpPath(missionId: string): string {
    return join(this.dir, `.tmp.${missionId}.${process.pid}.${Date.now()}.mission.json`);
  }
}
