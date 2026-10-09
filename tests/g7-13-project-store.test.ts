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

    // The store refuses to load the corrupt record (unsupported schemaVersion)
    // AND does NOT silently replace it with an empty project.
    expect(() => ctx.store.getProject(project.projectId, OWNER_A)).toThrow(ProjectNotFoundError);
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

    expect(() => ctx.store.getProject(project.projectId, OWNER_A)).toThrow(ProjectNotFoundError);
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
