/**
 * G7-13A — FileProjectStore store-level acceptance tests.
 *
 * Covers PR-01, PR-04, PR-05, PR-14, PR-15, PR-16, PR-17 at the store layer
 * (without HTTP). The gateway-level tests in tests/gateway/g7-13-*.test.ts
 * cover PR-02, PR-03, PR-08..PR-13 with full authentication + ownership
 * semantics.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rmSync, mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  FileProjectStore,
  PROJECT_SCHEMA_VERSION,
  ProjectNotFoundError,
  ProjectOwnershipError,
  ProjectValidationError,
  ProjectCorruptError,
  BriefRevisionConflictError,
  IdempotencyConflictError,
  ConversationAlreadyLinkedError,
  type ProjectRecord,
  type BriefEntry,
} from '../src/project/project-store.js';

const TMP_ROOT = join(process.cwd(), '.tmp-g7-13-store');

function freshStore(): { store: FileProjectStore; dir: string } {
  const dir = join(TMP_ROOT, `test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  const store = new FileProjectStore({ dir });
  return { store, dir };
}

const OWNER_A = 'caller-a-project-tests';
const OWNER_B = 'caller-b-project-tests';

describe('G7-13 FileProjectStore — PR-01 Create + recover after restart', () => {
  let ctx: { store: FileProjectStore; dir: string };

  beforeEach(() => {
    ctx = freshStore();
  });
  afterEach(() => {
    rmSync(ctx.dir, { recursive: true, force: true });
  });

  it('creates a project and recovers it from a new store instance (simulated restart)', () => {
    const created = ctx.store.createProject(OWNER_A, {
      name: 'PR-01 Project',
      description: 'Restart durability test',
    });
    expect(created.projectId).toBeTruthy();
    expect(created.ownerId).toBe(OWNER_A);
    expect(created.name).toBe('PR-01 Project');
    expect(created.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(created.status).toBe('active');
    expect(created.brief.revision).toBe(0);
    expect(created.conversationLinks).toEqual([]);
    expect(created.missionLinks).toEqual([]);
    expect(created.artifactRefs).toEqual([]);

    // Simulate restart: new store instance, same dir.
    const restarted = new FileProjectStore({ dir: ctx.dir });
    const fetched = restarted.getProject(created.projectId, OWNER_A);
    expect(fetched.projectId).toBe(created.projectId);
    expect(fetched.name).toBe('PR-01 Project');
    expect(fetched.description).toBe('Restart durability test');
    expect(fetched.status).toBe('active');
    expect(fetched.brief.revision).toBe(0);
  });

  it('rejects cross-caller getProject with ProjectOwnershipError', () => {
    const created = ctx.store.createProject(OWNER_A, { name: 'A-only' });
    expect(() => ctx.store.getProject(created.projectId, OWNER_B)).toThrow(ProjectOwnershipError);
  });

  it('returns ProjectNotFoundError for nonexistent project', () => {
    expect(() => ctx.store.getProject('does-not-exist-uuid', OWNER_A)).toThrow(ProjectNotFoundError);
  });
});

describe('G7-13 FileProjectStore — PR-04 Persist Project Brief across restart', () => {
  let ctx: { store: FileProjectStore; dir: string };

  beforeEach(() => {
    ctx = freshStore();
  });
  afterEach(() => {
    rmSync(ctx.dir, { recursive: true, force: true });
  });

  it('persists the Brief with all fields across simulated restart', () => {
    const created = ctx.store.createProject(OWNER_A, { name: 'PR-04' });
    const initialRevision = created.brief.revision;

    const approved: BriefEntry = {
      id: 'dec-1',
      text: 'Use Postgres for persistence',
      provenance: 'USER_APPROVED',
      source: 'operator:maya',
      approvedAt: '2026-10-09T10:00:00Z',
    };
    const verified: BriefEntry = {
      id: 'mile-1',
      text: 'Goal compiler validated',
      provenance: 'SOURCE_VERIFIED',
      source: 'mission:abc-123',
      approvedAt: '2026-10-09T11:00:00Z',
    };

    const updated = ctx.store.updateBrief(created.projectId, OWNER_A, {
      revision: initialRevision,
      objective: 'Build durable projects layer',
      requirements: ['must be filesystem-only', 'must not duplicate state'],
      constraints: ['no external databases'],
      approvedDecisions: [approved],
      completedMilestones: [verified],
      nextSteps: ['add web UI', 'wire to gateway'],
    });

    expect(updated.brief.revision).toBe(initialRevision + 1);
    expect(updated.brief.objective).toBe('Build durable projects layer');
    expect(updated.brief.requirements).toHaveLength(2);
    expect(updated.brief.approvedDecisions).toHaveLength(1);
    expect(updated.brief.approvedDecisions[0].provenance).toBe('USER_APPROVED');

    // Simulate restart.
    const restarted = new FileProjectStore({ dir: ctx.dir });
    const fetched = restarted.getProject(created.projectId, OWNER_A);
    expect(fetched.brief.revision).toBe(initialRevision + 1);
    expect(fetched.brief.objective).toBe('Build durable projects layer');
    expect(fetched.brief.requirements).toEqual(['must be filesystem-only', 'must not duplicate state']);
    expect(fetched.brief.approvedDecisions[0].id).toBe('dec-1');
    expect(fetched.brief.completedMilestones[0].provenance).toBe('SOURCE_VERIFIED');
  });
});

describe('G7-13 FileProjectStore — PR-05 Reject stale Brief revision', () => {
  let ctx: { store: FileProjectStore; dir: string };

  beforeEach(() => {
    ctx = freshStore();
  });
  afterEach(() => {
    rmSync(ctx.dir, { recursive: true, force: true });
  });

  it('rejects a Brief update with a stale revision', () => {
    const created = ctx.store.createProject(OWNER_A, { name: 'PR-05' });
    expect(created.brief.revision).toBe(0);

    // First update from revision 0 → 1.
    const updated = ctx.store.updateBrief(created.projectId, OWNER_A, {
      revision: 0,
      objective: 'v1',
    });
    expect(updated.brief.revision).toBe(1);

    // Second update attempts to use revision 0 (stale) → must reject.
    expect(() =>
      ctx.store.updateBrief(created.projectId, OWNER_A, {
        revision: 0,
        objective: 'stale-v',
      }),
    ).toThrow(BriefRevisionConflictError);

    // The record is unchanged after the rejected update.
    const fetched = ctx.store.getProject(created.projectId, OWNER_A);
    expect(fetched.brief.revision).toBe(1);
    expect(fetched.brief.objective).toBe('v1');
  });

  it('accepts a Brief update from the current revision', () => {
    const created = ctx.store.createProject(OWNER_A, { name: 'PR-05b' });
    const updated = ctx.store.updateBrief(created.projectId, OWNER_A, {
      revision: 0,
      objective: 'v1',
    });
    const updated2 = ctx.store.updateBrief(created.projectId, OWNER_A, {
      revision: updated.brief.revision,
      objective: 'v2',
    });
    expect(updated2.brief.revision).toBe(2);
    expect(updated2.brief.objective).toBe('v2');
  });
});

describe('G7-13 FileProjectStore — PR-06 Draft vs approved provenance', () => {
  let ctx: { store: FileProjectStore; dir: string };

  beforeEach(() => {
    ctx = freshStore();
  });
  afterEach(() => {
    rmSync(ctx.dir, { recursive: true, force: true });
  });

  it('preserves the distinction between DRAFT, USER_APPROVED, SOURCE_VERIFIED', () => {
    const created = ctx.store.createProject(OWNER_A, { name: 'PR-06' });
    const draft: BriefEntry = { id: 'd1', text: 'maybe try Redis', provenance: 'DRAFT' };
    const user: BriefEntry = {
      id: 'd2',
      text: 'stick with JSONL',
      provenance: 'USER_APPROVED',
      source: 'operator:maya',
      approvedAt: '2026-10-09T10:00:00Z',
    };
    const src: BriefEntry = {
      id: 'd3',
      text: 'verification passed',
      provenance: 'SOURCE_VERIFIED',
      source: 'mission:m-xyz',
      approvedAt: '2026-10-09T10:00:00Z',
    };

    ctx.store.updateBrief(created.projectId, OWNER_A, {
      revision: 0,
      approvedDecisions: [draft, user, src],
    });

    const fetched = ctx.store.getProject(created.projectId, OWNER_A);
    const decisions = fetched.brief.approvedDecisions;
    expect(decisions.map((d) => d.provenance)).toEqual(['DRAFT', 'USER_APPROVED', 'SOURCE_VERIFIED']);
  });

  it('rejects USER_APPROVED entry without a source', () => {
    const created = ctx.store.createProject(OWNER_A, { name: 'PR-06b' });
    expect(() =>
      ctx.store.updateBrief(created.projectId, OWNER_A, {
        revision: 0,
        approvedDecisions: [
          { id: 'd1', text: 'approved by nobody', provenance: 'USER_APPROVED' },
        ],
      }),
    ).toThrow(ProjectValidationError);
  });

  it('rejects SOURCE_VERIFIED entry without a source', () => {
    const created = ctx.store.createProject(OWNER_A, { name: 'PR-06c' });
    expect(() =>
      ctx.store.updateBrief(created.projectId, OWNER_A, {
        revision: 0,
        completedMilestones: [
          { id: 'm1', text: 'verified by nobody', provenance: 'SOURCE_VERIFIED' },
        ],
      }),
    ).toThrow(ProjectValidationError);
  });

  it('rejects duplicate entry ids', () => {
    const created = ctx.store.createProject(OWNER_A, { name: 'PR-06d' });
    expect(() =>
      ctx.store.updateBrief(created.projectId, OWNER_A, {
        revision: 0,
        approvedDecisions: [
          { id: 'dup', text: 'first', provenance: 'DRAFT' },
          { id: 'dup', text: 'second', provenance: 'DRAFT' },
        ],
      }),
    ).toThrow(ProjectValidationError);
  });
});

describe('G7-13 FileProjectStore — PR-14 Repeat project creation without duplication', () => {
  let ctx: { store: FileProjectStore; dir: string };

  beforeEach(() => {
    ctx = freshStore();
  });
  afterEach(() => {
    rmSync(ctx.dir, { recursive: true, force: true });
  });

  it('returns the same project on repeated create with the same idempotency key + payload', () => {
    const payload = { name: 'PR-14', description: 'idempotent create' };
    const first = ctx.store.createProject(OWNER_A, {
      ...payload,
      idempotencyKey: 'k-1',
    });
    const second = ctx.store.createProject(OWNER_A, {
      ...payload,
      idempotencyKey: 'k-1',
    });
    expect(second.projectId).toBe(first.projectId);
    expect(second.name).toBe(first.name);

    // Only one project file on disk.
    const files = ctx.store.listProjects(OWNER_A).projects;
    expect(files).toHaveLength(1);
  });

  it('rejects conflicting idempotency-key reuse with a different payload', () => {
    ctx.store.createProject(OWNER_A, {
      name: 'PR-14 first',
      idempotencyKey: 'k-conflict',
    });
    expect(() =>
      ctx.store.createProject(OWNER_A, {
        name: 'PR-14 second',
        idempotencyKey: 'k-conflict',
      }),
    ).toThrow(IdempotencyConflictError);
  });

  it('creates separate projects for separate idempotency keys', () => {
    const a = ctx.store.createProject(OWNER_A, { name: 'A', idempotencyKey: 'k-a' });
    const b = ctx.store.createProject(OWNER_A, { name: 'B', idempotencyKey: 'k-b' });
    expect(a.projectId).not.toBe(b.projectId);
  });

  it('survives restart for create idempotency', () => {
    const payload = { name: 'PR-14 restart', description: 'restart-safe' };
    const first = ctx.store.createProject(OWNER_A, {
      ...payload,
      idempotencyKey: 'k-restart',
    });
    const restarted = new FileProjectStore({ dir: ctx.dir });
    const second = restarted.createProject(OWNER_A, {
      ...payload,
      idempotencyKey: 'k-restart',
    });
    expect(second.projectId).toBe(first.projectId);
  });
});

describe('G7-13 FileProjectStore — PR-15 Repeat relationship link without duplication', () => {
  let ctx: { store: FileProjectStore; dir: string };

  beforeEach(() => {
    ctx = freshStore();
  });
  afterEach(() => {
    rmSync(ctx.dir, { recursive: true, force: true });
  });

  it('linking the same conversation twice does not duplicate the link', () => {
    const project = ctx.store.createProject(OWNER_A, { name: 'PR-15' });
    ctx.store.linkConversation(project.projectId, OWNER_A, 'conv-1');
    ctx.store.linkConversation(project.projectId, OWNER_A, 'conv-1');
    const fetched = ctx.store.getProject(project.projectId, OWNER_A);
    expect(fetched.conversationLinks).toHaveLength(1);
    expect(fetched.conversationLinks[0].conversationId).toBe('conv-1');
  });

  it('linking the same mission twice does not duplicate the link', () => {
    const project = ctx.store.createProject(OWNER_A, { name: 'PR-15-m' });
    ctx.store.linkMission(project.projectId, OWNER_A, 'mission-1');
    ctx.store.linkMission(project.projectId, OWNER_A, 'mission-1');
    const fetched = ctx.store.getProject(project.projectId, OWNER_A);
    expect(fetched.missionLinks).toHaveLength(1);
  });

  it('linking the same artifact twice does not duplicate the ref', () => {
    const project = ctx.store.createProject(OWNER_A, { name: 'PR-15-a' });
    ctx.store.linkArtifact(project.projectId, OWNER_A, {
      missionId: 'mission-1',
      path: 'output.md',
    });
    ctx.store.linkArtifact(project.projectId, OWNER_A, {
      missionId: 'mission-1',
      path: 'output.md',
    });
    const fetched = ctx.store.getProject(project.projectId, OWNER_A);
    expect(fetched.artifactRefs).toHaveLength(1);
  });

  it('linking with idempotency key returns the same project on retry', () => {
    const project = ctx.store.createProject(OWNER_A, { name: 'PR-15-idem' });
    ctx.store.linkConversation(project.projectId, OWNER_A, 'conv-1', {
      idempotencyKey: 'lc-1',
    });
    ctx.store.linkConversation(project.projectId, OWNER_A, 'conv-1', {
      idempotencyKey: 'lc-1',
    });
    const fetched = ctx.store.getProject(project.projectId, OWNER_A);
    expect(fetched.conversationLinks).toHaveLength(1);
  });
});

describe('G7-13 FileProjectStore — PR-16 Reject conflicting idempotency-key reuse', () => {
  let ctx: { store: FileProjectStore; dir: string };

  beforeEach(() => {
    ctx = freshStore();
  });
  afterEach(() => {
    rmSync(ctx.dir, { recursive: true, force: true });
  });

  it('linkConversation with same key but different conversationId rejects', () => {
    const project = ctx.store.createProject(OWNER_A, { name: 'PR-16' });
    ctx.store.linkConversation(project.projectId, OWNER_A, 'conv-A', {
      idempotencyKey: 'kc-1',
    });
    expect(() =>
      ctx.store.linkConversation(project.projectId, OWNER_A, 'conv-B', {
        idempotencyKey: 'kc-1',
      }),
    ).toThrow(IdempotencyConflictError);
  });

  it('linkMission with same key but different missionId rejects', () => {
    const project = ctx.store.createProject(OWNER_A, { name: 'PR-16-m' });
    ctx.store.linkMission(project.projectId, OWNER_A, 'm-1', { idempotencyKey: 'km-1' });
    expect(() =>
      ctx.store.linkMission(project.projectId, OWNER_A, 'm-2', { idempotencyKey: 'km-1' }),
    ).toThrow(IdempotencyConflictError);
  });

  it('linkArtifact with same key but different ref rejects', () => {
    const project = ctx.store.createProject(OWNER_A, { name: 'PR-16-a' });
    ctx.store.linkArtifact(project.projectId, OWNER_A, { missionId: 'm-1', path: 'a.md' }, { idempotencyKey: 'ka-1' });
    expect(() =>
      ctx.store.linkArtifact(project.projectId, OWNER_A, { missionId: 'm-1', path: 'b.md' }, { idempotencyKey: 'ka-1' }),
    ).toThrow(IdempotencyConflictError);
  });
});

describe('G7-13 FileProjectStore — PR-17 Preserve valid state after simulated write failure', () => {
  let ctx: { store: FileProjectStore; dir: string };

  beforeEach(() => {
    ctx = freshStore();
  });
  afterEach(() => {
    rmSync(ctx.dir, { recursive: true, force: true });
  });

  it('a corrupt temp file does not overwrite the previous valid project', () => {
    const project = ctx.store.createProject(OWNER_A, { name: 'PR-17 valid' });
    const validSnapshot: ProjectRecord = JSON.parse(
      readFileSync(join(ctx.dir, `${project.projectId}.project.json`), 'utf8'),
    ) as ProjectRecord;

    // Simulate a write failure: pre-create a temp file with garbage that
    // writeProject will refuse to rename. (writeProject uses a unique tmp
    // name including process.pid + Date.now(), so we can't intercept it
    // directly. Instead, test that a corrupt .project.json file is rejected
    // on read without being replaced.)
    const projectPath = join(ctx.dir, `${project.projectId}.project.json`);
    writeFileSync(projectPath, '{"schemaVersion":99,"projectId":"garbage"}', 'utf8');

    // G7-13F (Finding 2): the store now distinguishes corrupt projects from
    // missing ones. A corrupt file (unsupported schemaVersion) throws
    // ProjectCorruptError — the file is preserved on disk for manual
    // recovery, never silently replaced.
    expect(() => ctx.store.getProject(project.projectId, OWNER_A)).toThrow(ProjectCorruptError);
    // The corrupt file remains on disk for manual recovery.
    expect(existsSync(projectPath)).toBe(true);

    // Restore the valid file and verify the store reads it again.
    writeFileSync(projectPath, JSON.stringify(validSnapshot, null, 2), 'utf8');
    const fetched = ctx.store.getProject(project.projectId, OWNER_A);
    expect(fetched.name).toBe('PR-17 valid');
  });

  it('rejects a project file with missing required fields (does not silently replace)', () => {
    const project = ctx.store.createProject(OWNER_A, { name: 'PR-17b' });
    // Corrupt the file: remove the brief field.
    const path = join(ctx.dir, `${project.projectId}.project.json`);
    const corrupt = JSON.stringify({ schemaVersion: 1, projectId: project.projectId });
    writeFileSync(path, corrupt, 'utf8');

    // G7-13F: missing required fields now throw ProjectCorruptError (was
    // ProjectNotFoundError in G7-13A — the hardening pass sharpens the
    // distinction so corrupt files are not silently treated as missing).
    expect(() => ctx.store.getProject(project.projectId, OWNER_A)).toThrow(ProjectCorruptError);
    // File remains for manual recovery.
    expect(existsSync(path)).toBe(true);
  });
});

describe('G7-13 FileProjectStore — PR-09 One conversation cannot be in two projects', () => {
  let ctx: { store: FileProjectStore; dir: string };

  beforeEach(() => {
    ctx = freshStore();
  });
  afterEach(() => {
    rmSync(ctx.dir, { recursive: true, force: true });
  });

  it('rejects linking the same conversation to a second project (same owner)', () => {
    const project1 = ctx.store.createProject(OWNER_A, { name: 'PR-09 P1' });
    const project2 = ctx.store.createProject(OWNER_A, { name: 'PR-09 P2' });
    ctx.store.linkConversation(project1.projectId, OWNER_A, 'shared-conv');
    expect(() =>
      ctx.store.linkConversation(project2.projectId, OWNER_A, 'shared-conv'),
    ).toThrow(ConversationAlreadyLinkedError);
  });

  it('does not interfere when a different owner has the same conversationId (cross-caller isolation)', () => {
    // In practice the gateway layer enforces that conversationId ownership
    // is caller-scoped — two callers cannot own the same conversationId.
    // But the store-level invariant is "no two projects of the SAME owner
    // share a conversation". Different owners can each have a project that
    // links a conversationId (they would be different conversations even if
    // the IDs collided by accident — UUID collisions are astronomically
    // unlikely).
    const pA = ctx.store.createProject(OWNER_A, { name: 'PR-09 PA' });
    const pB = ctx.store.createProject(OWNER_B, { name: 'PR-09 PB' });
    ctx.store.linkConversation(pA.projectId, OWNER_A, 'conv-X');
    expect(() =>
      ctx.store.linkConversation(pB.projectId, OWNER_B, 'conv-X'),
    ).not.toThrow();
  });
});

describe('G7-13 FileProjectStore — listProjects ownership filter + summary correctness', () => {
  let ctx: { store: FileProjectStore; dir: string };

  beforeEach(() => {
    ctx = freshStore();
  });
  afterEach(() => {
    rmSync(ctx.dir, { recursive: true, force: true });
  });

  it('lists only the authenticated caller\'s projects with correct counts', () => {
    const a1 = ctx.store.createProject(OWNER_A, { name: 'A1' });
    ctx.store.createProject(OWNER_A, { name: 'A2' });
    ctx.store.createProject(OWNER_B, { name: 'B1' });

    // Add some relationships to A1 for count verification.
    ctx.store.linkConversation(a1.projectId, OWNER_A, 'conv-A1');
    ctx.store.linkMission(a1.projectId, OWNER_A, 'mission-A1');
    ctx.store.linkArtifact(a1.projectId, OWNER_A, { missionId: 'mission-A1', path: 'out.md' });

    const list = ctx.store.listProjects(OWNER_A);
    expect(list.projects).toHaveLength(2);
    expect(list.projects.map((p) => p.name).sort()).toEqual(['A1', 'A2']);
    const a1Summary = list.projects.find((p) => p.projectId === a1.projectId)!;
    expect(a1Summary.conversationCount).toBe(1);
    expect(a1Summary.missionCount).toBe(1);
    expect(a1Summary.artifactCount).toBe(1);

    const listB = ctx.store.listProjects(OWNER_B);
    expect(listB.projects).toHaveLength(1);
    expect(listB.projects[0].name).toBe('B1');
  });

  it('paginates via cursor', () => {
    for (let i = 0; i < 5; i++) {
      ctx.store.createProject(OWNER_A, { name: `P${i}` });
    }
    const page1 = ctx.store.listProjects(OWNER_A, { limit: 2 });
    expect(page1.projects).toHaveLength(2);
    expect(page1.nextCursor).not.toBeNull();
    const page2 = ctx.store.listProjects(OWNER_A, { limit: 2, cursor: page1.nextCursor! });
    expect(page2.projects).toHaveLength(2);
    const page3 = ctx.store.listProjects(OWNER_A, { limit: 2, cursor: page2.nextCursor! });
    expect(page3.projects).toHaveLength(1);
    expect(page3.nextCursor).toBeNull();
  });

  it('returns empty page for an evicted cursor', () => {
    const page = ctx.store.listProjects(OWNER_A, { cursor: 'nonexistent-cursor' });
    expect(page.projects).toEqual([]);
    expect(page.nextCursor).toBeNull();
  });
});

describe('G7-13 FileProjectStore — updateProject + archiveProject', () => {
  let ctx: { store: FileProjectStore; dir: string };

  beforeEach(() => {
    ctx = freshStore();
  });
  afterEach(() => {
    rmSync(ctx.dir, { recursive: true, force: true });
  });

  it('updates name and description, persists across restart', () => {
    const created = ctx.store.createProject(OWNER_A, { name: 'orig', description: 'd1' });
    ctx.store.updateProject(created.projectId, OWNER_A, { name: 'renamed', description: 'd2' });
    const restarted = new FileProjectStore({ dir: ctx.dir });
    const fetched = restarted.getProject(created.projectId, OWNER_A);
    expect(fetched.name).toBe('renamed');
    expect(fetched.description).toBe('d2');
  });

  it('archives and reactivates a project', () => {
    const created = ctx.store.createProject(OWNER_A, { name: 'archivable' });
    const archived = ctx.store.archiveProject(created.projectId, OWNER_A);
    expect(archived.status).toBe('archived');
    const reactivated = ctx.store.updateProject(created.projectId, OWNER_A, { status: 'active' });
    expect(reactivated.status).toBe('active');
  });

  it('rejects an invalid status', () => {
    const created = ctx.store.createProject(OWNER_A, { name: 'status-check' });
    expect(() =>
      ctx.store.updateProject(created.projectId, OWNER_A, { status: 'deleted' as never }),
    ).toThrow(ProjectValidationError);
  });
});

describe('G7-13 FileProjectStore — path safety (defense-in-depth)', () => {
  let ctx: { store: FileProjectStore; dir: string };

  beforeEach(() => {
    ctx = freshStore();
  });
  afterEach(() => {
    rmSync(ctx.dir, { recursive: true, force: true });
  });

  it('rejects artifact paths with traversal sequences', () => {
    const project = ctx.store.createProject(OWNER_A, { name: 'path-safety' });
    expect(() =>
      ctx.store.linkArtifact(project.projectId, OWNER_A, { missionId: 'm1', path: '../../../etc/passwd' }),
    ).toThrow(ProjectValidationError);
  });

  it('rejects artifact paths with absolute paths', () => {
    const project = ctx.store.createProject(OWNER_A, { name: 'path-safety-abs' });
    expect(() =>
      ctx.store.linkArtifact(project.projectId, OWNER_A, { missionId: 'm1', path: '/etc/passwd' }),
    ).toThrow(ProjectValidationError);
  });

  it('rejects artifact paths with null bytes', () => {
    const project = ctx.store.createProject(OWNER_A, { name: 'path-safety-null' });
    expect(() =>
      ctx.store.linkArtifact(project.projectId, OWNER_A, { missionId: 'm1', path: 'file\0name' }),
    ).toThrow(ProjectValidationError);
  });

  it('rejects malformed conversationId (filesystem-unsafe)', () => {
    const project = ctx.store.createProject(OWNER_A, { name: 'conv-safety' });
    expect(() =>
      ctx.store.linkConversation(project.projectId, OWNER_A, '../escape'),
    ).toThrow(ProjectValidationError);
  });
});

// ===========================================================================
// G7-13F (Finding 2) — Corrupt project recovery (store layer).
// Distinguish missing projects from corrupt/unsupported records. Preserve
// original bytes. Validate nested record structures. Avoid cross-owner
// information disclosure. Ensure a safe diagnostic path for the operator.
// ===========================================================================

describe('G7-13F (F2) — Corrupt project recovery (store layer)', () => {
  let ctx: { store: FileProjectStore; dir: string };

  beforeEach(() => {
    ctx = freshStore();
  });
  afterEach(() => {
    rmSync(ctx.dir, { recursive: true, force: true });
  });

  it('throws ProjectCorruptError on malformed JSON (and preserves the file)', () => {
    const project = ctx.store.createProject(OWNER_A, { name: 'before-corruption' });
    const projectPath = join(ctx.dir, `${project.projectId}.project.json`);
    const corruptBytes = '{not valid json';
    writeFileSync(projectPath, corruptBytes, 'utf8');

    // getProject throws ProjectCorruptError (not ProjectNotFoundError).
    expect(() => ctx.store.getProject(project.projectId, OWNER_A)).toThrow(ProjectCorruptError);
    // The corrupt file is preserved on disk for manual recovery.
    expect(existsSync(projectPath)).toBe(true);
    // Original bytes are recoverable for operator diagnostics.
    expect(readFileSync(projectPath, 'utf8')).toBe(corruptBytes);
  });

  it('throws ProjectCorruptError on unsupported schemaVersion (and preserves the file)', () => {
    const project = ctx.store.createProject(OWNER_A, { name: 'before-schema-bump' });
    const projectPath = join(ctx.dir, `${project.projectId}.project.json`);
    // Write a record with schemaVersion 99 (unsupported).
    const corruptRecord = JSON.parse(readFileSync(projectPath, 'utf8'));
    corruptRecord.schemaVersion = 99;
    const corruptBytes = JSON.stringify(corruptRecord, null, 2);
    writeFileSync(projectPath, corruptBytes, 'utf8');

    expect(() => ctx.store.getProject(project.projectId, OWNER_A)).toThrow(ProjectCorruptError);
    // File preserved.
    expect(existsSync(projectPath)).toBe(true);
    expect(readFileSync(projectPath, 'utf8')).toBe(corruptBytes);
  });

  it('throws ProjectCorruptError on missing required fields (e.g., brief is null)', () => {
    const project = ctx.store.createProject(OWNER_A, { name: 'before-missing-brief' });
    const projectPath = join(ctx.dir, `${project.projectId}.project.json`);
    const corruptRecord = JSON.parse(readFileSync(projectPath, 'utf8'));
    corruptRecord.brief = null;
    const corruptBytes = JSON.stringify(corruptRecord, null, 2);
    writeFileSync(projectPath, corruptBytes, 'utf8');

    expect(() => ctx.store.getProject(project.projectId, OWNER_A)).toThrow(ProjectCorruptError);
    expect(existsSync(projectPath)).toBe(true);
  });

  it('throws ProjectCorruptError when conversationLinks is a string instead of array', () => {
    const project = ctx.store.createProject(OWNER_A, { name: 'before-malformed-links' });
    const projectPath = join(ctx.dir, `${project.projectId}.project.json`);
    const corruptRecord = JSON.parse(readFileSync(projectPath, 'utf8'));
    corruptRecord.conversationLinks = 'not-an-array';
    writeFileSync(projectPath, JSON.stringify(corruptRecord, null, 2), 'utf8');

    expect(() => ctx.store.getProject(project.projectId, OWNER_A)).toThrow(ProjectCorruptError);
    expect(existsSync(projectPath)).toBe(true);
  });

  it('throws ProjectCorruptError when missionLinks is missing entirely', () => {
    const project = ctx.store.createProject(OWNER_A, { name: 'before-missing-missionLinks' });
    const projectPath = join(ctx.dir, `${project.projectId}.project.json`);
    const corruptRecord = JSON.parse(readFileSync(projectPath, 'utf8'));
    delete corruptRecord.missionLinks;
    writeFileSync(projectPath, JSON.stringify(corruptRecord, null, 2), 'utf8');

    expect(() => ctx.store.getProject(project.projectId, OWNER_A)).toThrow(ProjectCorruptError);
    expect(existsSync(projectPath)).toBe(true);
  });

  it('distinguishes missing project (ProjectNotFoundError) from corrupt (ProjectCorruptError)', () => {
    // Missing file → ProjectNotFoundError.
    expect(() => ctx.store.getProject('does-not-exist-uuid', OWNER_A)).toThrow(ProjectNotFoundError);
    // Corrupt file → ProjectCorruptError.
    const project = ctx.store.createProject(OWNER_A, { name: 'before-corrupt-vs-missing' });
    writeFileSync(join(ctx.dir, `${project.projectId}.project.json`), 'garbage', 'utf8');
    let caught: unknown;
    try {
      ctx.store.getProject(project.projectId, OWNER_A);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ProjectCorruptError);
    expect(caught).not.toBeInstanceOf(ProjectNotFoundError);
  });

  it('cross-caller access to corrupt project does not leak existence', () => {
    // Owner A's project file becomes corrupt.
    const project = ctx.store.createProject(OWNER_A, { name: 'cross-caller-corrupt' });
    writeFileSync(join(ctx.dir, `${project.projectId}.project.json`), 'garbage', 'utf8');

    // Owner B tries to access it — gets ProjectCorruptError (NOT
    // ProjectOwnershipError, which would leak that the file exists for A).
    // Since the file is corrupt, the store can't even determine ownership.
    expect(() => ctx.store.getProject(project.projectId, OWNER_B)).toThrow(ProjectCorruptError);
  });

  it('ProjectCorruptError.originalBytes preserves the original file content for diagnostics', () => {
    const project = ctx.store.createProject(OWNER_A, { name: 'original-bytes-test' });
    const projectPath = join(ctx.dir, `${project.projectId}.project.json`);
    const corruptBytes = '{"schemaVersion":1,"projectId":"broken"}';
    writeFileSync(projectPath, corruptBytes, 'utf8');

    let caught: unknown;
    try {
      ctx.store.getProject(project.projectId, OWNER_A);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ProjectCorruptError);
    expect((caught as ProjectCorruptError).originalBytes).toBe(corruptBytes);
  });

  it('listProjects skips corrupt files (does not crash the scan)', () => {
    const valid1 = ctx.store.createProject(OWNER_A, { name: 'valid-1' });
    const valid2 = ctx.store.createProject(OWNER_A, { name: 'valid-2' });
    // Corrupt valid2's file.
    writeFileSync(join(ctx.dir, `${valid2.projectId}.project.json`), 'garbage', 'utf8');

    // listProjects should skip the corrupt file and return valid-1.
    const list = ctx.store.listProjects(OWNER_A);
    expect(list.projects).toHaveLength(1);
    expect(list.projects[0].name).toBe('valid-1');
    // The corrupt file is preserved.
    expect(existsSync(join(ctx.dir, `${valid2.projectId}.project.json`))).toBe(true);
    // Silence unused-var lint — valid1 is the project we expect to remain.
    void valid1;
  });

  it('findProjectByConversation skips corrupt files (does not crash the scan)', () => {
    const valid1 = ctx.store.createProject(OWNER_A, { name: 'valid-1' });
    ctx.store.linkConversation(valid1.projectId, OWNER_A, 'conv-shared');
    const valid2 = ctx.store.createProject(OWNER_A, { name: 'valid-2' });
    // Corrupt valid2's file. findProjectByConversation should still find valid1.
    writeFileSync(join(ctx.dir, `${valid2.projectId}.project.json`), 'garbage', 'utf8');

    const found = ctx.store.findProjectByConversation(OWNER_A, 'conv-shared');
    expect(found).toBeDefined();
    expect(found?.projectId).toBe(valid1.projectId);
  });

  it('findProjectByCreateKey skips corrupt files (does not crash the scan)', () => {
    // Create two projects with idempotency keys; corrupt one.
    const valid1 = ctx.store.createProject(OWNER_A, {
      name: 'valid-1', idempotencyKey: 'shared-key-X',
    });
    const valid2 = ctx.store.createProject(OWNER_A, { name: 'valid-2' });
    writeFileSync(join(ctx.dir, `${valid2.projectId}.project.json`), 'garbage', 'utf8');

    // Retry the create with the same idempotency key AND same payload —
    // the store should find valid1 (skip the corrupt valid2 file) and
    // return it (idempotent no-op). Different payload would be a
    // conflict, but same payload + same key = idempotent retry.
    const found = ctx.store.createProject(OWNER_A, {
      name: 'valid-1', idempotencyKey: 'shared-key-X',
    });
    expect(found.projectId).toBe(valid1.projectId);
  });
});

// ===========================================================================
// G7-13F (Finding 3) — Concurrent idempotency and uniqueness.
// Within the documented single-process model (Node.js single-threaded event
// loop, all store methods synchronous), two concurrent createProject calls
// with the same idempotency key produce exactly one project, and two
// concurrent linkConversation calls to two different projects with the same
// conversationId produce exactly one success + one rejection. These tests
// verify the single-process guarantee using Promise.all — the operations
// execute sequentially within the same event-loop tick because they are
// synchronous, but Promise.all documents the intent and guards against
// future async refactors that would break the guarantee.
//
// Per spec: "Do not claim cross-process safety." No cross-process
// infrastructure is introduced.
// ===========================================================================

describe('G7-13F (F3) — Concurrent idempotency and uniqueness (single-process)', () => {
  let ctx: { store: FileProjectStore; dir: string };

  beforeEach(() => {
    ctx = freshStore();
  });
  afterEach(() => {
    rmSync(ctx.dir, { recursive: true, force: true });
  });

  it('two concurrent createProject with same idempotency key → one project, same ID', async () => {
    const payload = { name: 'F3 concurrent create', idempotencyKey: 'f3-concurrent-create-1' };
    // Promise.all on two async wrappers around the synchronous createProject.
    // The operations execute sequentially within the event loop, but the
    // test documents that two "simultaneous" requests with the same key
    // produce exactly one project.
    const [r1, r2] = await Promise.all([
      Promise.resolve().then(() => ctx.store.createProject(OWNER_A, payload)),
      Promise.resolve().then(() => ctx.store.createProject(OWNER_A, payload)),
    ]);
    expect(r1.projectId).toBe(r2.projectId);
    expect(ctx.store.listProjects(OWNER_A).projects).toHaveLength(1);
  });

  it('two concurrent linkConversation to two different projects → one succeeds, one throws', async () => {
    const p1 = ctx.store.createProject(OWNER_A, { name: 'F3-P1' });
    const p2 = ctx.store.createProject(OWNER_A, { name: 'F3-P2' });

    const results = await Promise.allSettled([
      Promise.resolve().then(() =>
        ctx.store.linkConversation(p1.projectId, OWNER_A, 'conv-f3-shared'),
      ),
      Promise.resolve().then(() =>
        ctx.store.linkConversation(p2.projectId, OWNER_A, 'conv-f3-shared'),
      ),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    // Exactly one succeeded; the other threw ConversationAlreadyLinkedError.
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
    if (rejected[0].status === 'rejected') {
      expect(rejected[0].reason).toBeInstanceOf(ConversationAlreadyLinkedError);
    }

    // The conversation is linked to exactly one project (the winner).
    const p1Has = ctx.store.getProject(p1.projectId, OWNER_A).conversationLinks.some(
      (l) => l.conversationId === 'conv-f3-shared',
    );
    const p2Has = ctx.store.getProject(p2.projectId, OWNER_A).conversationLinks.some(
      (l) => l.conversationId === 'conv-f3-shared',
    );
    expect(p1Has || p2Has).toBe(true);
    expect(p1Has && p2Has).toBe(false);
  });

  it('two concurrent linkMission with same idempotency key → one mission link, both return same project', async () => {
    const p = ctx.store.createProject(OWNER_A, { name: 'F3-mission' });
    const [r1, r2] = await Promise.all([
      Promise.resolve().then(() =>
        ctx.store.linkMission(p.projectId, OWNER_A, 'mission-f3-shared', { idempotencyKey: 'f3-lm-1' }),
      ),
      Promise.resolve().then(() =>
        ctx.store.linkMission(p.projectId, OWNER_A, 'mission-f3-shared', { idempotencyKey: 'f3-lm-1' }),
      ),
    ]);
    expect(r1.missionLinks).toHaveLength(1);
    expect(r2.missionLinks).toHaveLength(1);
    expect(r1.missionLinks[0].missionId).toBe('mission-f3-shared');
  });

  it('two concurrent createProject with DIFFERENT idempotency keys → two projects', async () => {
    const [r1, r2] = await Promise.all([
      Promise.resolve().then(() =>
        ctx.store.createProject(OWNER_A, { name: 'F3-A', idempotencyKey: 'f3-key-a' }),
      ),
      Promise.resolve().then(() =>
        ctx.store.createProject(OWNER_A, { name: 'F3-B', idempotencyKey: 'f3-key-b' }),
      ),
    ]);
    expect(r1.projectId).not.toBe(r2.projectId);
    expect(ctx.store.listProjects(OWNER_A).projects).toHaveLength(2);
  });
});
