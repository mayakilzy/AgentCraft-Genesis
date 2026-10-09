/**
 * G7-13 — Durable Projects Repository.
 *
 * Persists project records, project briefs, and verified references to
 * conversations / missions / artifacts — without duplicating their state.
 *
 * Storage layout (one file per project — atomic rewrite-by-id):
 *   data/projects/{projectId}.project.json
 *
 * Why a single compact file per project (instead of the G7-12 .conv/.msgs
 * split): a project record has no append-only event stream. Every mutation
 * touches a bounded, small set of fields. A single rewrite-by-id file keeps
 * the project atomic, simplifies restart recovery, and avoids the
 * multi-file consistency risk the G7-13 spec calls out explicitly.
 *
 * Ownership: every record carries `ownerId` (derived from CallerIdentity).
 * All reads filter by ownerId — no cross-caller access through this store.
 *
 * References (no state duplication):
 *   - conversationLinks[]  → conversationId REFERENCES (the conversation
 *     store remains the authoritative source for messages and titles).
 *   - missionLinks[]       → missionId REFERENCES + a `verifiedAt` timestamp
 *     recording when ownership was confirmed via MissionService. Mission
 *     execution state is NOT stored here — the gateway's in-process registry
 *     remains authoritative; if a mission is unavailable after restart, the
 *     overview shows "UNAVAILABLE" rather than fabricating completion.
 *   - artifactRefs[]       → (missionId, path, workerId?) REFERENCES + a
 *     `verifiedAt` timestamp. Path is taken from the mission's actual
 *     artifact list (never caller-supplied directly without verification).
 *
 * Concurrency (G7-13F Finding 3 — single-process model):
 *   - All store methods are SYNCHRONOUS (writeFileSync, readdirSync,
 *     readFileSync, renameSync). Once a method starts, it runs to
 *     completion without yielding the Node.js event loop.
 *   - Two concurrent requests (Promise.all on two async wrappers around
 *     sync methods) with the same idempotency key produce exactly one
 *     project; two concurrent linkConversation calls with the same
 *     conversationId to two different projects produce exactly one
 *     success + one ConversationAlreadyLinkedError.
 *   - This guarantee holds within a single Node.js process. It does NOT
 *     extend to multi-process deployments — there is no cross-process
 *     locking, no advisory file locks, no shared mutex. Operators
 *     deploying multiple Gateway processes must add external coordination.
 *
 * Durability (G7-13F Finding 5 — atomic vs crash/power-loss):
 *   - **Atomic file replacement**: `writeFileSync(tmpPath, payload)` followed
 *     by `renameSync(tmpPath, finalPath)` is atomic at the POSIX filesystem
 *     level. A concurrent reader sees either the previous valid file or the
 *     new valid file — never a partially-written file.
 *   - **Temporary-file behavior**: the temp file uses a unique name
 *     (`.tmp.<projectId>.<pid>.<timestamp>.project.json`) so concurrent
 *     writes within the same process do not collide. On write failure
 *     (e.g., disk full), the temp file is cleaned up; the previous valid
 *     file is preserved untouched.
 *   - **Crash / power-loss durability**: NOT claimed. The write path does
 *     NOT call `fsync()`. If the OS crashes (power loss) before flushing
 *     its page cache to disk, recent writes may be lost. The temp-file +
 *     rename pattern protects against partial writes VISIBLE to
 *     concurrent readers, but it does NOT protect against data loss when
 *     the OS page cache is unwritten to disk at power-loss time.
 *     Operators requiring power-loss durability must add `fsync()` in a
 *     follow-up — but that has a significant performance cost and is out
 *     of scope for the current single-process model. No new persistence
 *     infrastructure is introduced.
 *   - **Corrupt record preservation (G7-13F Finding 2)**: a corrupt project
 *     file (malformed JSON, unsupported schemaVersion, missing required
 *     fields) is NEVER silently replaced with an empty project.
 *     `readProject` throws `ProjectCorruptError`; the original bytes
 *     remain on disk for manual recovery.
 */
import { createHash, randomUUID } from 'node:crypto';
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

export const PROJECT_SCHEMA_VERSION = 1 as const;

const MAX_NAME_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 2000;
const MAX_BRIEF_OBJECTIVE_LENGTH = 2000;
const MAX_BRIEF_ARRAY_ITEMS = 100;
const MAX_BRIEF_ENTRY_TEXT_LENGTH = 1000;
const MAX_BRIEF_SOURCE_LENGTH = 500;
const MAX_CONVERSATION_LINKS = 1000;
const MAX_MISSION_LINKS = 1000;
const MAX_ARTIFACT_REFS = 5000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ProjectStatus = 'active' | 'archived';
export type BriefProvenance = 'USER_APPROVED' | 'SOURCE_VERIFIED' | 'DRAFT';

/**
 * A consequential decision or claimed milestone in the Project Brief. Each
 * entry carries an explicit provenance so a draft can never silently become
 * an approved decision.
 */
export interface BriefEntry {
  readonly id: string;
  readonly text: string;
  readonly provenance: BriefProvenance;
  /**
   * For USER_APPROVED: who approved (operatorId). For SOURCE_VERIFIED: the
   * durable source URI (missionId, artifact path, or flight record seq).
   * Absent for DRAFT.
   */
  readonly source?: string;
  /** ISO timestamp when the entry was approved/verified. Absent for DRAFT. */
  readonly approvedAt?: string;
}

export interface ProjectBrief {
  /** Monotonic revision counter — incremented on every Brief update. */
  revision: number;
  objective: string;
  requirements: string[];
  constraints: string[];
  approvedDecisions: BriefEntry[];
  completedMilestones: BriefEntry[];
  nextSteps: string[];
}

export interface ConversationLink {
  readonly conversationId: string;
  readonly linkedAt: string;
  readonly idempotencyKey?: string;
}

export interface MissionLink {
  readonly missionId: string;
  readonly linkedAt: string;
  /** ISO timestamp when MissionService confirmed ownership. */
  readonly verifiedAt: string;
  readonly idempotencyKey?: string;
}

export interface ArtifactRef {
  /** The mission that produced this artifact. */
  readonly missionId: string;
  /** Path within the mission's artifact list (verified). */
  readonly path: string;
  /** Worker that produced the artifact, when known. */
  readonly workerId?: string;
  readonly linkedAt: string;
  /** ISO timestamp when the artifact was verified against the mission's list. */
  readonly verifiedAt: string;
  readonly idempotencyKey?: string;
}

export interface ProjectRecord {
  readonly schemaVersion: typeof PROJECT_SCHEMA_VERSION;
  readonly projectId: string;
  readonly ownerId: string;
  name: string;
  description: string;
  status: ProjectStatus;
  readonly createdAt: string;
  updatedAt: string;
  brief: ProjectBrief;
  conversationLinks: ConversationLink[];
  missionLinks: MissionLink[];
  artifactRefs: ArtifactRef[];
  /**
   * Stored at create time. A retry of POST /v1/projects with the same key
   * (and matching payload hash) returns this project; with a different
   * payload hash, the store rejects the conflicting reuse.
   */
  createIdempotencyKey?: string;
  /** Bounded hash of the original create payload, for conflict detection. */
  createPayloadHash?: string;
}

export interface ProjectSummary {
  readonly projectId: string;
  readonly name: string;
  readonly description: string;
  readonly status: ProjectStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly conversationCount: number;
  readonly missionCount: number;
  readonly artifactCount: number;
  readonly briefRevision: number;
}

export interface CreateProjectInput {
  readonly name?: string;
  readonly description?: string;
  readonly idempotencyKey?: string;
  readonly brief?: Partial<BriefUpdateInput>;
}

export interface UpdateProjectInput {
  readonly name?: string;
  readonly description?: string;
  readonly status?: ProjectStatus;
}

export interface BriefUpdateInput {
  readonly revision: number;
  readonly objective?: string;
  readonly requirements?: string[];
  readonly constraints?: string[];
  readonly approvedDecisions?: BriefEntry[];
  readonly completedMilestones?: BriefEntry[];
  readonly nextSteps?: string[];
}

export interface ProjectStoreOptions {
  readonly dir?: string;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class ProjectNotFoundError extends Error {
  constructor(projectId: string) {
    super(`project not found: ${projectId}`);
    this.name = 'ProjectNotFoundError';
  }
}

/**
 * G7-13F (Finding 2): a project file EXISTS on disk but is corrupt
 * (malformed JSON, unsupported schemaVersion, missing required fields,
 * or malformed nested fields). The original bytes are preserved on disk
 * for manual recovery — the store NEVER silently replaces a corrupt
 * file with an empty project.
 *
 * The route handler maps this to 404 PROJECT_NOT_FOUND to avoid leaking
 * existence across callers (a corrupt file owned by caller B is
 * indistinguishable from a missing file from caller A's perspective).
 * The store logs to stderr so the legitimate operator can investigate
 * via the safe diagnostic path (filesystem inspection of the preserved
 * file) without exposing other owners' data.
 */
export class ProjectCorruptError extends Error {
  /** The original bytes — preserved for diagnostics, never returned to clients. */
  readonly originalBytes: string;
  constructor(projectId: string, message: string, originalBytes: string) {
    super(`project corrupt: ${projectId} — ${message}`);
    this.name = 'ProjectCorruptError';
    this.originalBytes = originalBytes;
  }
}

export class ProjectOwnershipError extends Error {
  constructor(projectId: string) {
    super(`project not owned by caller: ${projectId}`);
    this.name = 'ProjectOwnershipError';
  }
}

export class ProjectValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectValidationError';
  }
}

export class BriefRevisionConflictError extends Error {
  constructor(projectId: string, expected: number, actual: number) {
    super(
      `brief revision conflict for project ${projectId}: client expected ${expected}, server is at ${actual}`,
    );
    this.name = 'BriefRevisionConflictError';
  }
}

export class IdempotencyConflictError extends Error {
  constructor(key: string, message: string) {
    super(`idempotency key conflict for ${key}: ${message}`);
    this.name = 'IdempotencyConflictError';
  }
}

export class ConversationAlreadyLinkedError extends Error {
  constructor(conversationId: string, projectId: string) {
    super(
      `conversation ${conversationId} is already linked to project ${projectId}`,
    );
    this.name = 'ConversationAlreadyLinkedError';
  }
}

// ---------------------------------------------------------------------------
// FileProjectStore
// ---------------------------------------------------------------------------

/**
 * Compute a stable hash of a payload for idempotency conflict detection.
 * Uses node:crypto's sha256 — the hash is NOT for security, only for
 * detecting whether a retried idempotency key carries the same payload.
 */
function payloadHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 32);
}

/**
 * Validate a single filesystem path segment for safety.
 * Used for projectId (which becomes a filename) and conversationId references
 * before they are stored.
 */
function isSafeIdSegment(raw: string): boolean {
  if (raw.length === 0 || raw.length > 200) return false;
  if (raw === '.' || raw === '..') return false;
  if (raw.includes('/') || raw.includes('\\')) return false;
  if (raw.includes('\0')) return false;
  // Reject any control char.
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return false;
  }
  return true;
}

/**
 * Validate an artifact path: reject traversal, absolute paths, null bytes.
 * Defense-in-depth on top of the MissionService's already-verified list.
 */
function isSafeArtifactPath(raw: string): boolean {
  if (raw.length === 0 || raw.length > 1000) return false;
  if (raw.includes('..')) return false;
  if (raw.startsWith('/')) return false;
  if (raw.includes('\0')) return false;
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return false;
  }
  return true;
}

export class FileProjectStore {
  private readonly dir: string;

  constructor(options: ProjectStoreOptions = {}) {
    this.dir = options.dir ?? 'data/projects';
    mkdirSync(this.dir, { recursive: true });
  }

  // --- Project CRUD ---

  createProject(ownerId: string, input: CreateProjectInput): ProjectRecord {
    if (!ownerId || ownerId.length === 0) {
      throw new ProjectValidationError('ownerId is required');
    }
    if (!isSafeIdSegment(ownerId)) {
      throw new ProjectValidationError('ownerId is not a safe identifier');
    }

    // Idempotency check: scan existing projects for the same owner with a
    // matching createIdempotencyKey.
    if (input.idempotencyKey !== undefined && input.idempotencyKey.length > 0) {
      const existing = this.findProjectByCreateKey(ownerId, input.idempotencyKey);
      if (existing !== undefined) {
        const currentHash = payloadHash({
          name: input.name,
          description: input.description,
          brief: input.brief ?? {},
        });
        if (existing.createPayloadHash !== undefined && existing.createPayloadHash !== currentHash) {
          throw new IdempotencyConflictError(
            input.idempotencyKey,
            'same idempotency key reused with a different payload',
          );
        }
        return existing;
      }
    }

    const now = new Date().toISOString();
    const projectId = randomUUID();
    const name = (input.name ?? 'Untitled Project').slice(0, MAX_NAME_LENGTH);
    const description = (input.description ?? '').slice(0, MAX_DESCRIPTION_LENGTH);

    const record: ProjectRecord = {
      schemaVersion: PROJECT_SCHEMA_VERSION,
      projectId,
      ownerId,
      name,
      description,
      status: 'active',
      createdAt: now,
      updatedAt: now,
      brief: this.initialBrief(input.brief),
      conversationLinks: [],
      missionLinks: [],
      artifactRefs: [],
      ...(input.idempotencyKey !== undefined && input.idempotencyKey.length > 0
        ? {
            createIdempotencyKey: input.idempotencyKey,
            createPayloadHash: payloadHash({
              name: input.name,
              description: input.description,
              brief: input.brief ?? {},
            }),
          }
        : {}),
    };

    this.writeProject(record);
    return record;
  }

  getProject(projectId: string, ownerId: string): ProjectRecord {
    try {
      const record = this.readProject(projectId);
      if (record === undefined) {
        throw new ProjectNotFoundError(projectId);
      }
      if (record.ownerId !== ownerId) {
        throw new ProjectOwnershipError(projectId);
      }
      return record;
    } catch (e) {
      if (e instanceof ProjectCorruptError) {
        // G7-13F (Finding 2): log to stderr for operator investigation
        // via the safe diagnostic path. The route handler will map this
        // to 404 PROJECT_NOT_FOUND to avoid leaking existence across
        // callers — a corrupt file owned by caller B is indistinguishable
        // from a missing file from caller A's perspective. The original
        // bytes are preserved on disk for manual recovery.
        console.error(
          `[project-store] corrupt project file: ${projectId} — ${e.message}. Original bytes preserved on disk for manual recovery.`,
        );
      }
      throw e;
    }
  }

  listProjects(
    ownerId: string,
    options: { readonly limit?: number; readonly cursor?: string } = {},
  ): { projects: ProjectSummary[]; nextCursor: string | null } {
    const limit = Math.max(1, Math.min(100, options.limit ?? 20));
    const cursor = options.cursor;

    const summaries: ProjectSummary[] = [];
    const files = readdirSync(this.dir).filter((f) => f.endsWith('.project.json'));
    for (const file of files) {
      const projectId = file.replace('.project.json', '');
      // G7-13F (F2): scanning functions use readProjectOrLog to skip
      // corrupt files instead of crashing the whole scan.
      const record = this.readProjectOrLog(projectId);
      if (record === undefined || record.ownerId !== ownerId) continue;
      summaries.push({
        projectId: record.projectId,
        name: record.name,
        description: record.description,
        status: record.status,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        conversationCount: record.conversationLinks.length,
        missionCount: record.missionLinks.length,
        artifactCount: record.artifactRefs.length,
        briefRevision: record.brief.revision,
      });
    }

    summaries.sort((a, b) => {
      if (a.updatedAt !== b.updatedAt) {
        return a.updatedAt > b.updatedAt ? -1 : 1;
      }
      return a.projectId > b.projectId ? -1 : a.projectId < b.projectId ? 1 : 0;
    });

    let startIndex = 0;
    if (cursor !== undefined && cursor.length > 0) {
      const cursorIdx = summaries.findIndex((s) => s.projectId === cursor);
      if (cursorIdx >= 0) {
        startIndex = cursorIdx + 1;
      } else {
        return { projects: [], nextCursor: null };
      }
    }

    const page = summaries.slice(startIndex, startIndex + limit);
    const hasMore = startIndex + limit < summaries.length;
    const nextCursor = hasMore && page.length > 0 ? page[page.length - 1].projectId : null;
    return { projects: page, nextCursor };
  }

  updateProject(
    projectId: string,
    ownerId: string,
    input: UpdateProjectInput,
  ): ProjectRecord {
    const record = this.getProject(projectId, ownerId);
    let mutated = false;
    if (input.name !== undefined) {
      const trimmed = input.name.slice(0, MAX_NAME_LENGTH);
      if (trimmed !== record.name) {
        record.name = trimmed;
        mutated = true;
      }
    }
    if (input.description !== undefined) {
      const trimmed = input.description.slice(0, MAX_DESCRIPTION_LENGTH);
      if (trimmed !== record.description) {
        record.description = trimmed;
        mutated = true;
      }
    }
    if (input.status !== undefined && input.status !== record.status) {
      if (input.status !== 'active' && input.status !== 'archived') {
        throw new ProjectValidationError(`invalid status: ${input.status}`);
      }
      record.status = input.status;
      mutated = true;
    }
    if (mutated) {
      record.updatedAt = new Date().toISOString();
      this.writeProject(record);
    }
    return record;
  }

  archiveProject(projectId: string, ownerId: string): ProjectRecord {
    return this.updateProject(projectId, ownerId, { status: 'archived' });
  }

  // --- Project Brief ---

  getBrief(projectId: string, ownerId: string): ProjectBrief {
    return this.getProject(projectId, ownerId).brief;
  }

  /**
   * Update the Project Brief with optimistic revision control. The caller
   * must submit the revision they last read; if it is stale, the store
   * rejects the update with BriefRevisionConflictError and the caller must
   * re-fetch and reapply.
   */
  updateBrief(
    projectId: string,
    ownerId: string,
    update: BriefUpdateInput,
  ): ProjectRecord {
    const record = this.getProject(projectId, ownerId);
    if (record.brief.revision !== update.revision) {
      throw new BriefRevisionConflictError(
        projectId,
        update.revision,
        record.brief.revision,
      );
    }

    const next: ProjectBrief = {
      revision: record.brief.revision + 1,
      objective: record.brief.objective,
      requirements: [...record.brief.requirements],
      constraints: [...record.brief.constraints],
      approvedDecisions: [...record.brief.approvedDecisions],
      completedMilestones: [...record.brief.completedMilestones],
      nextSteps: [...record.brief.nextSteps],
    };

    if (update.objective !== undefined) {
      next.objective = update.objective.slice(0, MAX_BRIEF_OBJECTIVE_LENGTH);
    }
    if (update.requirements !== undefined) {
      next.requirements = this.validateStringArray(
        update.requirements,
        'requirements',
      ).slice(0, MAX_BRIEF_ARRAY_ITEMS);
    }
    if (update.constraints !== undefined) {
      next.constraints = this.validateStringArray(
        update.constraints,
        'constraints',
      ).slice(0, MAX_BRIEF_ARRAY_ITEMS);
    }
    if (update.approvedDecisions !== undefined) {
      next.approvedDecisions = this.validateBriefEntries(
        update.approvedDecisions,
        'approvedDecisions',
      ).slice(0, MAX_BRIEF_ARRAY_ITEMS);
    }
    if (update.completedMilestones !== undefined) {
      next.completedMilestones = this.validateBriefEntries(
        update.completedMilestones,
        'completedMilestones',
      ).slice(0, MAX_BRIEF_ARRAY_ITEMS);
    }
    if (update.nextSteps !== undefined) {
      next.nextSteps = this.validateStringArray(
        update.nextSteps,
        'nextSteps',
      ).slice(0, MAX_BRIEF_ARRAY_ITEMS);
    }

    record.brief = next;
    record.updatedAt = new Date().toISOString();
    this.writeProject(record);
    return record;
  }

  // --- Conversation Links ---

  /**
   * Link a conversation to a project. Idempotent: if the conversation is
   * already linked (by conversationId OR by idempotencyKey with matching
   * payload), returns the current project state without mutation.
   *
   * Cross-project rejection: if the conversation is already linked to a
   * DIFFERENT project owned by the same caller, throws
   * ConversationAlreadyLinkedError.
   *
   * Caller-ownership verification: this store CANNOT verify conversation
   * ownership (it doesn't have access to the ConversationStore). The gateway
   * layer is responsible for verifying conversation ownership BEFORE calling
   * this method. The store only enforces its own invariants.
   */
  linkConversation(
    projectId: string,
    ownerId: string,
    conversationId: string,
    options: { idempotencyKey?: string; verifyOwnership?: () => boolean } = {},
  ): ProjectRecord {
    if (!isSafeIdSegment(conversationId)) {
      throw new ProjectValidationError('conversationId is not a safe identifier');
    }
    const record = this.getProject(projectId, ownerId);

    // Cross-project check: scan all of the owner's projects for a different
    // project that already has this conversationId linked.
    const conflictingProject = this.findProjectByConversation(ownerId, conversationId);
    if (conflictingProject !== undefined && conflictingProject.projectId !== projectId) {
      throw new ConversationAlreadyLinkedError(conversationId, conflictingProject.projectId);
    }

    // Idempotency: if an existing link has the same idempotencyKey, verify
    // it points to the same conversationId (or there's no conflict if the
    // key is unique to this link).
    if (options.idempotencyKey !== undefined && options.idempotencyKey.length > 0) {
      const existing = record.conversationLinks.find(
        (l) => l.idempotencyKey === options.idempotencyKey,
      );
      if (existing !== undefined && existing.conversationId !== conversationId) {
        throw new IdempotencyConflictError(
          options.idempotencyKey,
          `same key already linked to conversation ${existing.conversationId}`,
        );
      }
    }

    // Ownership verification hook: the gateway layer calls with
    // verifyOwnership() that throws if the conversation isn't owned by this
    // caller. If it returns false, we reject — but it MUST already throw
    // before reaching here; the hook is defense-in-depth.
    if (options.verifyOwnership !== undefined && !options.verifyOwnership()) {
      throw new ProjectValidationError(
        `conversation ${conversationId} is not owned by caller`,
      );
    }

    // Already linked (no key)? Idempotent no-op.
    const existingLink = record.conversationLinks.find(
      (l) => l.conversationId === conversationId,
    );
    if (existingLink !== undefined) {
      return record;
    }

    if (record.conversationLinks.length >= MAX_CONVERSATION_LINKS) {
      throw new ProjectValidationError(
        `project reached ${MAX_CONVERSATION_LINKS} conversation link limit`,
      );
    }

    const now = new Date().toISOString();
    record.conversationLinks = [
      ...record.conversationLinks,
      {
        conversationId,
        linkedAt: now,
        ...(options.idempotencyKey !== undefined && options.idempotencyKey.length > 0
          ? { idempotencyKey: options.idempotencyKey }
          : {}),
      },
    ];
    record.updatedAt = now;
    this.writeProject(record);
    return record;
  }

  // --- Mission Links ---

  /**
   * Link a mission to a project. Idempotent on (projectId, missionId).
   *
   * Ownership verification: the gateway must call with verifiedAt = now
   * ONLY AFTER MissionService.get(missionId, caller) succeeded. This
   * guarantees a mission ID alone cannot establish a link — the gateway
   * must have actually retrieved the mission under the caller's identity.
   *
   * After restart: the durable link persists (verifiedAt is in the record).
   * If the in-process MissionService no longer has the mission, the overview
   * shows "UNAVAILABLE" honestly — never fabricates completion.
   */
  linkMission(
    projectId: string,
    ownerId: string,
    missionId: string,
    options: { idempotencyKey?: string; verifiedAt?: string } = {},
  ): ProjectRecord {
    if (!isSafeIdSegment(missionId)) {
      throw new ProjectValidationError('missionId is not a safe identifier');
    }
    const record = this.getProject(projectId, ownerId);

    // Idempotency conflict check.
    if (options.idempotencyKey !== undefined && options.idempotencyKey.length > 0) {
      const existing = record.missionLinks.find(
        (l) => l.idempotencyKey === options.idempotencyKey,
      );
      if (existing !== undefined && existing.missionId !== missionId) {
        throw new IdempotencyConflictError(
          options.idempotencyKey,
          `same key already linked to mission ${existing.missionId}`,
        );
      }
    }

    const now = options.verifiedAt ?? new Date().toISOString();

    // Already linked? Update verifiedAt (re-verification is fine — the
    // gateway just re-confirmed ownership). Do not create a duplicate.
    const existingLink = record.missionLinks.find((l) => l.missionId === missionId);
    if (existingLink !== undefined) {
      // Re-verification refreshes verifiedAt but does not bump updatedAt
      // (this is a no-op for the project itself).
      if (existingLink.verifiedAt !== now) {
        const updated: MissionLink = { ...existingLink, verifiedAt: now };
        record.missionLinks = record.missionLinks.map((l) =>
          l.missionId === missionId ? updated : l,
        );
        this.writeProject(record);
      }
      return record;
    }

    if (record.missionLinks.length >= MAX_MISSION_LINKS) {
      throw new ProjectValidationError(
        `project reached ${MAX_MISSION_LINKS} mission link limit`,
      );
    }

    record.missionLinks = [
      ...record.missionLinks,
      {
        missionId,
        linkedAt: now,
        verifiedAt: now,
        ...(options.idempotencyKey !== undefined && options.idempotencyKey.length > 0
          ? { idempotencyKey: options.idempotencyKey }
          : {}),
      },
    ];
    record.updatedAt = now;
    this.writeProject(record);
    return record;
  }

  // --- Artifact References ---

  /**
   * Link an artifact reference. The gateway layer MUST have already verified
   * that (missionId, path, workerId?) appears in the mission's actual
   * artifact list (via MissionService.getArtifacts). The store trusts that
   * verification timestamp and stores the reference.
   */
  linkArtifact(
    projectId: string,
    ownerId: string,
    ref: { missionId: string; path: string; workerId?: string },
    options: { idempotencyKey?: string; verifiedAt?: string } = {},
  ): ProjectRecord {
    if (!isSafeIdSegment(ref.missionId)) {
      throw new ProjectValidationError('missionId is not a safe identifier');
    }
    if (!isSafeArtifactPath(ref.path)) {
      throw new ProjectValidationError(
        `artifact path rejected by safety filter (traversal or absolute)`,
      );
    }
    if (ref.workerId !== undefined && !isSafeIdSegment(ref.workerId)) {
      throw new ProjectValidationError('workerId is not a safe identifier');
    }
    const record = this.getProject(projectId, ownerId);

    // Idempotency conflict check.
    if (options.idempotencyKey !== undefined && options.idempotencyKey.length > 0) {
      const existing = record.artifactRefs.find(
        (r) => r.idempotencyKey === options.idempotencyKey,
      );
      if (
        existing !== undefined &&
        (existing.missionId !== ref.missionId || existing.path !== ref.path)
      ) {
        throw new IdempotencyConflictError(
          options.idempotencyKey,
          `same key already linked to artifact ${existing.missionId}:${existing.path}`,
        );
      }
    }

    const now = options.verifiedAt ?? new Date().toISOString();

    // Already linked? Idempotent no-op (do not duplicate).
    const existsAlready = record.artifactRefs.some(
      (r) => r.missionId === ref.missionId && r.path === ref.path,
    );
    if (existsAlready) {
      return record;
    }

    if (record.artifactRefs.length >= MAX_ARTIFACT_REFS) {
      throw new ProjectValidationError(
        `project reached ${MAX_ARTIFACT_REFS} artifact reference limit`,
      );
    }

    record.artifactRefs = [
      ...record.artifactRefs,
      {
        missionId: ref.missionId,
        path: ref.path,
        ...(ref.workerId !== undefined ? { workerId: ref.workerId } : {}),
        linkedAt: now,
        verifiedAt: now,
        ...(options.idempotencyKey !== undefined && options.idempotencyKey.length > 0
          ? { idempotencyKey: options.idempotencyKey }
          : {}),
      },
    ];
    record.updatedAt = now;
    this.writeProject(record);
    return record;
  }

  // --- Internal helpers: lookup by indexed field ---

  /**
   * Scan the owner's project files for one whose createIdempotencyKey
   * matches. Returns undefined if not found.
   *
   * O(projects) — bounded by the number of projects per owner (typically
   * single digits to dozens). The alternative (a separate idempotency
   * ledger file) adds a multi-file consistency risk that the G7-13 spec
   * explicitly tells us to avoid.
   */
  private findProjectByCreateKey(
    ownerId: string,
    idempotencyKey: string,
  ): ProjectRecord | undefined {
    const files = readdirSync(this.dir).filter((f) => f.endsWith('.project.json'));
    for (const file of files) {
      const projectId = file.replace('.project.json', '');
      // G7-13F (F2): skip corrupt files instead of crashing the scan.
      const record = this.readProjectOrLog(projectId);
      if (record === undefined) continue;
      if (record.ownerId !== ownerId) continue;
      if (record.createIdempotencyKey === idempotencyKey) return record;
    }
    return undefined;
  }

  /**
   * Scan the owner's project files for one that already links the given
   * conversationId. Used to enforce the "one conversation belongs to at
   * most one project" invariant.
   */
  findProjectByConversation(
    ownerId: string,
    conversationId: string,
  ): ProjectRecord | undefined {
    const files = readdirSync(this.dir).filter((f) => f.endsWith('.project.json'));
    for (const file of files) {
      const projectId = file.replace('.project.json', '');
      // G7-13F (F2): skip corrupt files instead of crashing the scan.
      const record = this.readProjectOrLog(projectId);
      if (record === undefined) continue;
      if (record.ownerId !== ownerId) continue;
      if (record.conversationLinks.some((l) => l.conversationId === conversationId)) {
        return record;
      }
    }
    return undefined;
  }

  // --- Internal helpers: validation ---

  private validateStringArray(arr: readonly string[], label: string): string[] {
    if (!Array.isArray(arr)) {
      throw new ProjectValidationError(`${label} must be an array of strings`);
    }
    const out: string[] = [];
    for (const item of arr) {
      if (typeof item !== 'string' || item.length === 0) {
        throw new ProjectValidationError(`${label} items must be non-empty strings`);
      }
      if (item.length > MAX_BRIEF_ENTRY_TEXT_LENGTH) {
        throw new ProjectValidationError(
          `${label} item exceeds ${MAX_BRIEF_ENTRY_TEXT_LENGTH} chars`,
        );
      }
      out.push(item);
    }
    return out;
  }

  private validateBriefEntries(
    arr: readonly BriefEntry[],
    label: string,
  ): BriefEntry[] {
    if (!Array.isArray(arr)) {
      throw new ProjectValidationError(`${label} must be an array`);
    }
    const out: BriefEntry[] = [];
    const seenIds = new Set<string>();
    for (const item of arr) {
      if (item === null || typeof item !== 'object') {
        throw new ProjectValidationError(`${label} items must be objects`);
      }
      const e = item as BriefEntry;
      if (typeof e.id !== 'string' || e.id.length === 0) {
        throw new ProjectValidationError(`${label} entry requires non-empty id`);
      }
      if (seenIds.has(e.id)) {
        throw new ProjectValidationError(`${label} entry id ${e.id} is duplicated`);
      }
      seenIds.add(e.id);
      if (typeof e.text !== 'string' || e.text.length === 0) {
        throw new ProjectValidationError(`${label} entry ${e.id} requires non-empty text`);
      }
      if (e.text.length > MAX_BRIEF_ENTRY_TEXT_LENGTH) {
        throw new ProjectValidationError(
          `${label} entry ${e.id} text exceeds ${MAX_BRIEF_ENTRY_TEXT_LENGTH} chars`,
        );
      }
      if (
        e.provenance !== 'USER_APPROVED' &&
        e.provenance !== 'SOURCE_VERIFIED' &&
        e.provenance !== 'DRAFT'
      ) {
        throw new ProjectValidationError(
          `${label} entry ${e.id} has invalid provenance: ${e.provenance}`,
        );
      }
      if (e.source !== undefined && (typeof e.source !== 'string' || e.source.length === 0)) {
        throw new ProjectValidationError(`${label} entry ${e.id} source must be a non-empty string`);
      }
      if (e.source !== undefined && e.source.length > MAX_BRIEF_SOURCE_LENGTH) {
        throw new ProjectValidationError(
          `${label} entry ${e.id} source exceeds ${MAX_BRIEF_SOURCE_LENGTH} chars`,
        );
      }
      if (e.approvedAt !== undefined && typeof e.approvedAt !== 'string') {
        throw new ProjectValidationError(`${label} entry ${e.id} approvedAt must be a string`);
      }
      // USER_APPROVED entries MUST have a source (the approver identity).
      if (e.provenance === 'USER_APPROVED' && e.source === undefined) {
        throw new ProjectValidationError(
          `${label} entry ${e.id} provenance USER_APPROVED requires a source (approver)`,
        );
      }
      // SOURCE_VERIFIED entries MUST have a source (the durable reference).
      if (e.provenance === 'SOURCE_VERIFIED' && e.source === undefined) {
        throw new ProjectValidationError(
          `${label} entry ${e.id} provenance SOURCE_VERIFIED requires a source (durable reference)`,
        );
      }
      out.push(e);
    }
    return out;
  }

  private initialBrief(seed?: Partial<BriefUpdateInput>): ProjectBrief {
    const brief: ProjectBrief = {
      revision: 0,
      objective: '',
      requirements: [],
      constraints: [],
      approvedDecisions: [],
      completedMilestones: [],
      nextSteps: [],
    };
    if (seed === undefined) return brief;
    if (seed.objective !== undefined) {
      brief.objective = seed.objective.slice(0, MAX_BRIEF_OBJECTIVE_LENGTH);
    }
    if (seed.requirements !== undefined) {
      brief.requirements = this.validateStringArray(seed.requirements, 'requirements').slice(0, MAX_BRIEF_ARRAY_ITEMS);
    }
    if (seed.constraints !== undefined) {
      brief.constraints = this.validateStringArray(seed.constraints, 'constraints').slice(0, MAX_BRIEF_ARRAY_ITEMS);
    }
    if (seed.nextSteps !== undefined) {
      brief.nextSteps = this.validateStringArray(seed.nextSteps, 'nextSteps').slice(0, MAX_BRIEF_ARRAY_ITEMS);
    }
    // approvedDecisions/completedMilestones cannot be seeded at create time
    // — the project has no approved decisions or completed milestones yet.
    // The brief starts empty in those fields. This is intentional: drafts
    // may be added later, and approved decisions require explicit approval
    // through updateBrief.
    return brief;
  }

  // --- Internal helpers: file I/O with crash-conscious atomic writes ---

  private projectPath(projectId: string): string {
    return join(this.dir, `${projectId}.project.json`);
  }

  private tmpPath(projectId: string): string {
    return join(this.dir, `.tmp.${projectId}.${process.pid}.${Date.now()}.project.json`);
  }

  /**
   * Atomic write: validate → serialize → write to temp file → rename.
   * If any step fails before rename, the previous valid file is preserved.
   * The temp file is cleaned up on failure.
   */
  private writeProject(record: ProjectRecord): void {
    // Validate before writing.
    if (record.schemaVersion !== PROJECT_SCHEMA_VERSION) {
      throw new ProjectValidationError(
        `unsupported schemaVersion: ${record.schemaVersion}`,
      );
    }
    if (!isSafeIdSegment(record.projectId)) {
      throw new ProjectValidationError('projectId is not a safe identifier');
    }
    if (!isSafeIdSegment(record.ownerId)) {
      throw new ProjectValidationError('ownerId is not a safe identifier');
    }
    if (typeof record.name !== 'string' || record.name.length === 0) {
      throw new ProjectValidationError('project name must be a non-empty string');
    }
    if (typeof record.description !== 'string') {
      throw new ProjectValidationError('project description must be a string');
    }
    if (record.status !== 'active' && record.status !== 'archived') {
      throw new ProjectValidationError(`invalid project status: ${record.status}`);
    }

    const finalPath = this.projectPath(record.projectId);
    const tmpPath = this.tmpPath(record.projectId);

    try {
      const payload = JSON.stringify(record, null, 2);
      writeFileSync(tmpPath, payload, 'utf8');
      // Atomic rename — on POSIX, rename() is atomic; on Windows, it replaces
      // the destination (since Node 14+). Either way, the file is either the
      // old valid version or the new valid version — never partial.
      renameSync(tmpPath, finalPath);
    } catch (err) {
      // Clean up the temp file — leave the previous valid file untouched.
      try {
        if (existsSync(tmpPath)) unlinkSync(tmpPath);
      } catch {
        // Best-effort cleanup; the temp file will not be loaded by readProject
        // because it has a different naming pattern.
      }
      throw err;
    }
  }

  /**
   * Read a project file.
   *
   * G7-13F (Finding 2): distinguishes three cases:
   *   1. File does not exist → returns `undefined` (caller surfaces
   *      ProjectNotFoundError).
   *   2. File exists but is corrupt (malformed JSON, unsupported
   *      schemaVersion, missing required fields, malformed nested fields)
   *      → throws `ProjectCorruptError`. The original bytes are preserved
   *      on disk for manual recovery. The caller (route handler) maps
   *      this to 404 PROJECT_NOT_FOUND to avoid leaking existence across
   *      callers; the store logs to stderr for operator investigation.
   *   3. File exists and is valid → returns the parsed record.
   *
   * The corrupt file is NEVER silently replaced with an empty project.
   * The original bytes are accessible via `ProjectCorruptError.originalBytes`
   * for diagnostics (never returned to clients).
   */
  private readProject(projectId: string): ProjectRecord | undefined {
    if (!isSafeIdSegment(projectId)) return undefined;
    const path = this.projectPath(projectId);
    if (!existsSync(path)) return undefined;
    const raw = readFileSync(path, 'utf8');
    let parsed: ProjectRecord;
    try {
      parsed = JSON.parse(raw) as ProjectRecord;
    } catch (e) {
      throw new ProjectCorruptError(
        projectId,
        `JSON parse failed: ${e instanceof Error ? e.message : String(e)}`,
        raw,
      );
    }
    if (parsed.schemaVersion !== PROJECT_SCHEMA_VERSION) {
      // Unsupported schema version — refuse to load. The file is preserved
      // for manual migration/recovery.
      throw new ProjectCorruptError(
        projectId,
        `unsupported schemaVersion: ${parsed.schemaVersion}`,
        raw,
      );
    }
    // Defensive: ensure all required fields exist + nested structures are
    // valid. If any field is missing or malformed, surface a
    // ProjectCorruptError rather than risk a downstream TypeError that
    // could write a corrupt record.
    if (
      typeof parsed.projectId !== 'string' ||
      typeof parsed.ownerId !== 'string' ||
      typeof parsed.name !== 'string' ||
      typeof parsed.description !== 'string' ||
      (parsed.status !== 'active' && parsed.status !== 'archived') ||
      typeof parsed.createdAt !== 'string' ||
      typeof parsed.updatedAt !== 'string' ||
      typeof parsed.brief !== 'object' ||
      parsed.brief === null ||
      !Array.isArray(parsed.conversationLinks) ||
      !Array.isArray(parsed.missionLinks) ||
      !Array.isArray(parsed.artifactRefs)
    ) {
      throw new ProjectCorruptError(
        projectId,
        'one or more required fields are missing or have wrong types',
        raw,
      );
    }
    return parsed;
  }

  /**
   * Read a project, but on corrupt-record errors, log to stderr and return
   * undefined (so iteration can continue past corrupt files). Used by
   * scanning functions (listProjects, findProjectByCreateKey,
   * findProjectByConversation). The original bytes are preserved on disk
   * — the store never silently replaces a corrupt file.
   */
  private readProjectOrLog(projectId: string): ProjectRecord | undefined {
    try {
      return this.readProject(projectId);
    } catch (e) {
      if (e instanceof ProjectCorruptError) {
        console.error(
          `[project-store] corrupt project file: ${projectId} — ${e.message}. Original bytes preserved on disk for manual recovery.`,
        );
        return undefined;
      }
      throw e;
    }
  }
}
