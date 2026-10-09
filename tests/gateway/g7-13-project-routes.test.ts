/**
 * G7-13 — Project Gateway Route tests.
 *
 * Tests the HTTP layer for project CRUD + Brief + overview + relationship
 * linking, with full authentication + caller ownership enforcement.
 *
 * Coverage:
 *   PR-02 — list only the authenticated caller's projects
 *   PR-03 — reject cross-caller project access (404 not 403)
 *   PR-08 — reject linking a conversation owned by another caller
 *   PR-09 — reject assigning one conversation to two projects (409)
 *   PR-10 — link an authorized mission without executing it again
 *   PR-11 — preserve mission reference after restart and show UNAVAILABLE
 *   PR-12 — link only verified artifact references (reject unknown paths)
 *   PR-13 — show missing artifacts truthfully
 *   + idempotency, brief revision conflicts, ownership, validation.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { MissionService } from '../../src/gateway/mission-service.js';
import { startHttpServer, stopHttpServer } from '../../src/gateway/http-server.js';
import { FileConversationStore } from '../../src/conversation/conversation-store.js';
import { FileProjectStore } from '../../src/project/project-store.js';
import type { CallerIdentity, GatewayConfig } from '../../src/gateway/types.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const CALLER_A: CallerIdentity = {
  callerId: 'caller-a',
  allowedOperations: ['mission:submit'],
  maxActiveMissions: 5,
  maxMissionTimeoutMs: 30_000,
};

const CALLER_B: CallerIdentity = {
  callerId: 'caller-b',
  allowedOperations: ['mission:submit'],
  maxActiveMissions: 5,
  maxMissionTimeoutMs: 30_000,
};

let httpServer: Server;
let httpUrl: string;
let service: MissionService;
let conversationStore: FileConversationStore;
let projectStore: FileProjectStore;
let projectDir: string;
let conversationDir: string;

function buildConfig(port: number): GatewayConfig {
  return {
    apiKeys: new Map([
      ['key-a', CALLER_A],
      ['key-b', CALLER_B],
    ]),
    httpHost: '127.0.0.1',
    httpPort: port,
    a2aHost: '127.0.0.1',
    a2aPort: port + 1,
    a2aBaseUrl: `http://127.0.0.1:${port + 1}`,
    defaultMissionTimeoutMs: 30_000,
    maxRequestBodyBytes: 1_000_000,
    maxEventsPerResponse: 100,
    agentName: 'Genesis G7-13 Test',
    agentDescription: 'Test gateway',
  };
}

function httpCall(
  method: string,
  path: string,
  body: unknown | null,
  apiKey: string | null,
): Promise<{ status: number; body: unknown }> {
  const url = new URL(path, httpUrl);
  const payload = body === null ? null : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      url,
      {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let parsed: unknown = raw;
          try { parsed = JSON.parse(raw); } catch { /* keep raw */ }
          resolve({ status: res.statusCode ?? 0, body: parsed });
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function getFreePort(): Promise<number> {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address() as AddressInfo;
      const port = addr.port;
      srv.close(() => resolve(port));
    });
  });
}

// Goal that the default dev runtime can complete (MemoryComputer + dev fallback).
const SIMPLE_GOAL =
  'Write a markdown file named output.md at the workspace root with the content "# Genesis gateway output" as the sole body.';

beforeAll(async () => {
  const port = await getFreePort();
  const config = buildConfig(port);
  service = new MissionService({ defaultMissionTimeoutMs: 30_000 });
  projectDir = mkdtempSync(join(tmpdir(), 'g7-13-projects-'));
  conversationDir = mkdtempSync(join(tmpdir(), 'g7-13-conversations-'));
  projectStore = new FileProjectStore({ dir: projectDir });
  conversationStore = new FileConversationStore({ dir: conversationDir });
  const http = startHttpServer(service, config, conversationStore, projectStore);
  httpServer = http.server;
  httpUrl = http.url;
  await new Promise((r) => setTimeout(r, 50));
});

afterAll(async () => {
  await stopHttpServer(httpServer);
  rmSync(projectDir, { recursive: true, force: true });
  rmSync(conversationDir, { recursive: true, force: true });
});

interface ProjectResponse {
  projectId: string;
  ownerId: string;
  name: string;
  description: string;
  status: string;
  brief: { revision: number };
  conversationLinks: unknown[];
  missionLinks: unknown[];
  artifactRefs: unknown[];
  links: unknown;
}

describe('G7-13 Gateway — PR-02 list only the authenticated caller\'s projects', () => {
  it('filters projects by caller ownership', async () => {
    // Caller A creates a project; Caller B creates a project; each sees only their own.
    const a = await httpCall('POST', '/v1/projects', { name: 'A-only-gw' }, 'key-a');
    expect(a.status).toBe(201);
    const b = await httpCall('POST', '/v1/projects', { name: 'B-only-gw' }, 'key-b');
    expect(b.status).toBe(201);

    const listA = await httpCall('GET', '/v1/projects', null, 'key-a');
    expect(listA.status).toBe(200);
    const bodyA = listA.body as { projects: ProjectResponse[] };
    expect(bodyA.projects.some((p) => p.name === 'A-only-gw')).toBe(true);
    expect(bodyA.projects.some((p) => p.name === 'B-only-gw')).toBe(false);

    const listB = await httpCall('GET', '/v1/projects', null, 'key-b');
    expect(listB.status).toBe(200);
    const bodyB = listB.body as { projects: ProjectResponse[] };
    expect(bodyB.projects.some((p) => p.name === 'B-only-gw')).toBe(true);
    expect(bodyB.projects.some((p) => p.name === 'A-only-gw')).toBe(false);
  });

  it('returns 401 without authentication', async () => {
    const r = await httpCall('GET', '/v1/projects', null, null);
    expect(r.status).toBe(401);
  });
});

describe('G7-13 Gateway — PR-03 reject cross-caller project access (404 not 403)', () => {
  it('returns 404 when caller B tries to access caller A\'s project', async () => {
    const created = await httpCall('POST', '/v1/projects', { name: 'PR-03 cross' }, 'key-a');
    expect(created.status).toBe(201);
    const projectId = (created.body as ProjectResponse).projectId;

    // Caller B tries to read it — 404 (not 403) to avoid leaking existence.
    const get = await httpCall('GET', `/v1/projects/${projectId}`, null, 'key-b');
    expect(get.status).toBe(404);

    // Caller B tries to PATCH it.
    const patch = await httpCall('PATCH', `/v1/projects/${projectId}`, { name: 'stolen' }, 'key-b');
    expect(patch.status).toBe(404);

    // Caller B tries to read the brief.
    const brief = await httpCall('GET', `/v1/projects/${projectId}/brief`, null, 'key-b');
    expect(brief.status).toBe(404);

    // Caller B tries to read the overview.
    const overview = await httpCall('GET', `/v1/projects/${projectId}/overview`, null, 'key-b');
    expect(overview.status).toBe(404);
  });
});

describe('G7-13 Gateway — Brief lifecycle (revision conflict, provenance validation)', () => {
  it('updates Brief via PUT with revision control', async () => {
    const created = await httpCall('POST', '/v1/projects', { name: 'Brief lifecycle' }, 'key-a');
    const projectId = (created.body as ProjectResponse).projectId;
    expect(created.body).toMatchObject({ brief: { revision: 0 } });

    // First update from revision 0 → 1.
    const update1 = await httpCall('PUT', `/v1/projects/${projectId}/brief`, {
      revision: 0,
      objective: 'v1 objective',
      requirements: ['req-a'],
    }, 'key-a');
    expect(update1.status).toBe(200);
    expect((update1.body as { brief: { revision: number; objective: string } }).brief.revision).toBe(1);

    // Stale revision (0) → 409.
    const stale = await httpCall('PUT', `/v1/projects/${projectId}/brief`, {
      revision: 0,
      objective: 'stale',
    }, 'key-a');
    expect(stale.status).toBe(409);

    // Fresh revision (1) → 2.
    const update2 = await httpCall('PUT', `/v1/projects/${projectId}/brief`, {
      revision: 1,
      objective: 'v2 objective',
    }, 'key-a');
    expect(update2.status).toBe(200);
    expect((update2.body as { brief: { revision: number; objective: string } }).brief.revision).toBe(2);
    expect((update2.body as { brief: { revision: number; objective: string } }).brief.objective).toBe('v2 objective');
  });

  // G7-13F (Finding 1): the gateway now BINDS USER_APPROVED source to the
  // authenticated callerId — so a USER_APPROVED entry WITHOUT source is
  // accepted (the server fills in `caller:<callerId>`). The old test
  // expected 400 because the store layer validation required a source;
  // the gateway now satisfies that requirement on the caller's behalf.
  // See "F1 — Brief provenance trust" describe block for the new negative
  // tests (impersonation, fake mission refs, etc.).
  it('USER_APPROVED entry without source: gateway binds source to callerId', async () => {
    const created = await httpCall('POST', '/v1/projects', { name: 'Brief provenance' }, 'key-a');
    const projectId = (created.body as ProjectResponse).projectId;
    const r = await httpCall('PUT', `/v1/projects/${projectId}/brief`, {
      revision: 0,
      approvedDecisions: [
        { id: 'd1', text: 'no approver supplied by client', provenance: 'USER_APPROVED' },
      ],
    }, 'key-a');
    expect(r.status).toBe(200);
    // Verify the server bound the source.
    const briefRes = await httpCall('GET', `/v1/projects/${projectId}/brief`, null, 'key-a');
    const body = briefRes.body as { brief: { approvedDecisions: { source: string }[] } };
    expect(body.brief.approvedDecisions[0].source).toBe('caller:caller-a');
  });

  it('rejects missing revision field', async () => {
    const created = await httpCall('POST', '/v1/projects', { name: 'Brief no rev' }, 'key-a');
    const projectId = (created.body as ProjectResponse).projectId;
    const r = await httpCall('PUT', `/v1/projects/${projectId}/brief`, {
      objective: 'no revision',
    }, 'key-a');
    expect(r.status).toBe(400);
  });
});

describe('G7-13 Gateway — ownerId is never accepted from client', () => {
  it('rejects create with explicit ownerId', async () => {
    const r = await httpCall('POST', '/v1/projects', {
      name: 'evil',
      ownerId: 'some-other-caller',
    }, 'key-a');
    expect(r.status).toBe(400);
    expect((r.body as { error: { code: string } }).error.code).toBe('OWNER_ID_NOT_ALLOWED');
  });

  it('rejects PATCH with explicit ownerId', async () => {
    const created = await httpCall('POST', '/v1/projects', { name: 'patch-owner' }, 'key-a');
    const projectId = (created.body as ProjectResponse).projectId;
    const r = await httpCall('PATCH', `/v1/projects/${projectId}`, {
      ownerId: 'someone-else',
    }, 'key-a');
    expect(r.status).toBe(400);
  });
});

describe('G7-13 Gateway — PR-14 + PR-16 idempotency at HTTP layer', () => {
  it('returns the same project on repeated create with same idempotency key + payload', async () => {
    const payload = { name: 'PR-14 HTTP', description: 'idempotent create', idempotencyKey: 'k-gw-1' };
    const first = await httpCall('POST', '/v1/projects', payload, 'key-a');
    expect(first.status).toBe(201);
    const second = await httpCall('POST', '/v1/projects', payload, 'key-a');
    expect(second.status).toBe(201);
    expect((second.body as ProjectResponse).projectId).toBe((first.body as ProjectResponse).projectId);
  });

  it('rejects conflicting idempotency-key reuse with different payload', async () => {
    await httpCall('POST', '/v1/projects', {
      name: 'conflict-1',
      idempotencyKey: 'k-gw-conflict',
    }, 'key-a');
    const r = await httpCall('POST', '/v1/projects', {
      name: 'conflict-2',
      idempotencyKey: 'k-gw-conflict',
    }, 'key-a');
    expect(r.status).toBe(409);
  });
});

describe('G7-13 Gateway — PR-07 + PR-08 conversation linking', () => {
  it('creates a conversation and links it to a project (recovered after restart)', async () => {
    // Caller A creates a project + conversation, then links them.
    const project = await httpCall('POST', '/v1/projects', { name: 'PR-07 proj' }, 'key-a');
    const projectId = (project.body as ProjectResponse).projectId;
    const conv = await httpCall('POST', '/v1/conversations', { title: 'PR-07 conv' }, 'key-a');
    expect(conv.status).toBe(201);
    const conversationId = (conv.body as { conversationId: string }).conversationId;

    const link = await httpCall('POST', `/v1/projects/${projectId}/conversations`, {
      conversationId,
    }, 'key-a');
    expect(link.status).toBe(200);
    expect((link.body as ProjectResponse).conversationLinks).toHaveLength(1);

    // Restart: new projectStore + conversationStore at the same dirs.
    const restartedProjects = new FileProjectStore({ dir: projectDir });
    const restartedConvs = new FileConversationStore({ dir: conversationDir });
    const fetched = restartedProjects.getProject(projectId, CALLER_A.callerId);
    expect(fetched.conversationLinks).toHaveLength(1);
    expect(fetched.conversationLinks[0].conversationId).toBe(conversationId);

    // The conversation itself is still there.
    const fetchedConv = restartedConvs.getConversation(conversationId, CALLER_A.callerId);
    expect(fetchedConv.title).toBe('PR-07 conv');
  });

  it('PR-08 rejects linking a conversation owned by another caller', async () => {
    // Caller A creates a project + conversation.
    await httpCall('POST', '/v1/projects', { name: 'PR-08 A' }, 'key-a');
    const conv = await httpCall('POST', '/v1/conversations', { title: 'PR-08 conv' }, 'key-a');
    const conversationId = (conv.body as { conversationId: string }).conversationId;

    // Caller B tries to link A's conversation to B's project (B's project).
    const bProject = await httpCall('POST', '/v1/projects', { name: 'PR-08 B' }, 'key-b');
    const bProjectId = (bProject.body as ProjectResponse).projectId;
    const link = await httpCall('POST', `/v1/projects/${bProjectId}/conversations`, {
      conversationId,
    }, 'key-b');
    expect(link.status).toBe(404);
  });

  it('PR-09 rejects assigning one conversation to two projects', async () => {
    const project1 = await httpCall('POST', '/v1/projects', { name: 'PR-09 P1' }, 'key-a');
    const project2 = await httpCall('POST', '/v1/projects', { name: 'PR-09 P2' }, 'key-a');
    const conv = await httpCall('POST', '/v1/conversations', { title: 'PR-09 shared' }, 'key-a');
    const conversationId = (conv.body as { conversationId: string }).conversationId;

    const link1 = await httpCall('POST', `/v1/projects/${(project1.body as ProjectResponse).projectId}/conversations`, {
      conversationId,
    }, 'key-a');
    expect(link1.status).toBe(200);

    const link2 = await httpCall('POST', `/v1/projects/${(project2.body as ProjectResponse).projectId}/conversations`, {
      conversationId,
    }, 'key-a');
    expect(link2.status).toBe(409);
    expect((link2.body as { error: { code: string } }).error.code).toBe('CONVERSATION_ALREADY_LINKED');
  });
});

describe('G7-13 Gateway — PR-10 + PR-11 mission linking', () => {
  it('PR-10 links an authorized mission without executing it again', async () => {
    // Step 1: Submit a mission via POST /v1/missions and wait for it to complete.
    const submit = await httpCall('POST', '/v1/missions', {
      outcome: SIMPLE_GOAL,
    }, 'key-a');
    expect(submit.status).toBe(202);
    const missionId = (submit.body as { missionId: string }).missionId;

    // Wait for completion.
    await service.awaitCompletion(missionId, CALLER_A);
    const snap = service.get(missionId, CALLER_A);
    expect(snap.terminal).toBe(true);

    // Step 2: Create a project and link the mission.
    const project = await httpCall('POST', '/v1/projects', { name: 'PR-10 proj' }, 'key-a');
    const projectId = (project.body as ProjectResponse).projectId;
    const link = await httpCall('POST', `/v1/projects/${projectId}/missions`, {
      missionId,
    }, 'key-a');
    expect(link.status).toBe(200);
    expect((link.body as ProjectResponse).missionLinks).toHaveLength(1);

    // Verify the mission did NOT execute again — the snapshot is the same
    // terminal state, no new mission was launched.
    const snap2 = service.get(missionId, CALLER_A);
    expect(snap2.status).toBe(snap.status);
    expect(snap2.acceptedAt).toBe(snap.acceptedAt);
  });

  it('PR-11 preserves mission reference after restart and shows UNAVAILABLE', async () => {
    // Set up a fresh isolated service for this test so we can simulate
    // restart cleanly (the in-process mission registry is wiped on restart).
    const port = await getFreePort();
    const config = buildConfig(port);
    const localService = new MissionService({ defaultMissionTimeoutMs: 30_000 });
    const localProjectDir = mkdtempSync(join(tmpdir(), 'g7-13-restart-proj-'));
    const localConvDir = mkdtempSync(join(tmpdir(), 'g7-13-restart-conv-'));
    const localProjects = new FileProjectStore({ dir: localProjectDir });
    const localConvs = new FileConversationStore({ dir: localConvDir });
    const localHttp = startHttpServer(localService, config, localConvs, localProjects);
    const localUrl = localHttp.url;
    await new Promise((r) => setTimeout(r, 50));

    try {
      const callLocal = (method: string, path: string, body: unknown | null) =>
        new Promise<{ status: number; body: unknown }>((resolve, reject) => {
          const url = new URL(path, localUrl);
          const payload = body === null ? null : JSON.stringify(body);
          const req = httpRequest(url, {
            method,
            headers: {
              'Content-Type': 'application/json',
              Authorization: 'Bearer key-a',
              ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
            },
          }, (res) => {
            const chunks: Buffer[] = [];
            res.on('data', (c: Buffer) => chunks.push(c));
            res.on('end', () => {
              const raw = Buffer.concat(chunks).toString('utf8');
              let parsed: unknown = raw;
              try { parsed = JSON.parse(raw); } catch { /* keep raw */ }
              resolve({ status: res.statusCode ?? 0, body: parsed });
            });
          });
          req.on('error', reject);
          if (payload) req.write(payload);
          req.end();
        });

      // Submit + wait + link.
      const submit = await callLocal('POST', '/v1/missions', { outcome: SIMPLE_GOAL });
      const missionId = (submit.body as { missionId: string }).missionId;
      await localService.awaitCompletion(missionId, CALLER_A);
      const project = await callLocal('POST', '/v1/projects', { name: 'PR-11 restart' });
      const projectId = (project.body as ProjectResponse).projectId;
      const link = await callLocal('POST', `/v1/projects/${projectId}/missions`, { missionId });
      expect(link.status).toBe(200);

      // Live overview — mission is available.
      const liveOverview = await callLocal('GET', `/v1/projects/${projectId}/overview`, null);
      expect(liveOverview.status).toBe(200);
      const liveBody = liveOverview.body as { missions: { availability: string; status: string }[] };
      expect(liveBody.missions).toHaveLength(1);
      expect(liveBody.missions[0].availability).toBe('live');
      expect(liveBody.missions[0].status).toBeDefined();

      // STOP the gateway (simulate restart).
      await stopHttpServer(localHttp.server);

      // Simulate restart: new MissionService (empty registry), same project
      // store + conversation store (durable). Wire up a new HTTP server.
      const restartedService = new MissionService({ defaultMissionTimeoutMs: 30_000 });
      const restartedProjects = new FileProjectStore({ dir: localProjectDir });
      const restartedConvs = new FileConversationStore({ dir: localConvDir });
      const restartedHttp = startHttpServer(restartedService, config, restartedConvs, restartedProjects);
      const restartedUrl = restartedHttp.url;
      await new Promise((r) => setTimeout(r, 50));

      try {
        const callRestarted = (method: string, path: string, body: unknown | null) =>
          new Promise<{ status: number; body: unknown }>((resolve, reject) => {
            const url = new URL(path, restartedUrl);
            const payload = body === null ? null : JSON.stringify(body);
            const req = httpRequest(url, {
              method,
              headers: {
                'Content-Type': 'application/json',
                Authorization: 'Bearer key-a',
                ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
              },
            }, (res) => {
              const chunks: Buffer[] = [];
              res.on('data', (c: Buffer) => chunks.push(c));
              res.on('end', () => {
                const raw = Buffer.concat(chunks).toString('utf8');
                let parsed: unknown = raw;
                try { parsed = JSON.parse(raw); } catch { /* keep raw */ }
                resolve({ status: res.statusCode ?? 0, body: parsed });
              });
            });
            req.on('error', reject);
            if (payload) req.write(payload);
            req.end();
          });

        // Overview after restart — mission is UNAVAILABLE, honestly.
        const restartedOverview = await callRestarted('GET', `/v1/projects/${projectId}/overview`, null);
        expect(restartedOverview.status).toBe(200);
        const restartedBody = restartedOverview.body as {
          missions: { availability: string; status?: string }[];
          artifacts: { availability: string }[];
        };
        expect(restartedBody.missions).toHaveLength(1);
        expect(restartedBody.missions[0].availability).toBe('unavailable');
        expect(restartedBody.missions[0].status).toBeUndefined();

        // Project record + Brief remain durable.
        const fetchedProject = await callRestarted('GET', `/v1/projects/${projectId}`, null);
        expect(fetchedProject.status).toBe(200);
        expect((fetchedProject.body as { name: string }).name).toBe('PR-11 restart');

        // Try to link a NEW mission that doesn't exist in the restarted
        // registry — must be rejected (can't verify ownership).
        const linkUnknown = await callRestarted('POST', `/v1/projects/${projectId}/missions`, {
          missionId: 'fake-mission-id',
        });
        expect(linkUnknown.status).toBe(404);
      } finally {
        await stopHttpServer(restartedHttp.server);
      }
    } finally {
      rmSync(localProjectDir, { recursive: true, force: true });
      rmSync(localConvDir, { recursive: true, force: true });
    }
  });

  it('rejects linking a mission owned by another caller', async () => {
    // Caller A submits + completes a mission.
    const submit = await httpCall('POST', '/v1/missions', { outcome: SIMPLE_GOAL }, 'key-a');
    const missionId = (submit.body as { missionId: string }).missionId;
    await service.awaitCompletion(missionId, CALLER_A);

    // Caller B tries to link it to their project — must fail (mission not
    // owned by caller B, so MissionService.get throws MissionNotFoundError).
    const bProject = await httpCall('POST', '/v1/projects', { name: 'B-evil' }, 'key-b');
    const bProjectId = (bProject.body as ProjectResponse).projectId;
    const link = await httpCall('POST', `/v1/projects/${bProjectId}/missions`, {
      missionId,
    }, 'key-b');
    expect(link.status).toBe(404);
  });
});

describe('G7-13 Gateway — PR-12 + PR-13 artifact linking', () => {
  it('PR-12 links only verified artifact references (rejects unknown paths)', async () => {
    // Submit + complete a mission that produces output.md.
    const submit = await httpCall('POST', '/v1/missions', { outcome: SIMPLE_GOAL }, 'key-a');
    const missionId = (submit.body as { missionId: string }).missionId;
    await service.awaitCompletion(missionId, CALLER_A);

    // Verify the artifact exists.
    const artifactsResp = await httpCall('GET', `/v1/missions/${missionId}/artifacts`, null, 'key-a');
    const artifacts = (artifactsResp.body as { artifacts: { path: string }[] }).artifacts;
    expect(artifacts.some((a) => a.path === 'output.md')).toBe(true);

    // Create a project and link the artifact via the verified path.
    const project = await httpCall('POST', '/v1/projects', { name: 'PR-12 proj' }, 'key-a');
    const projectId = (project.body as ProjectResponse).projectId;
    const link = await httpCall('POST', `/v1/projects/${projectId}/artifacts`, {
      missionId,
      path: 'output.md',
    }, 'key-a');
    expect(link.status).toBe(200);
    expect((link.body as ProjectResponse).artifactRefs).toHaveLength(1);

    // Reject a path that doesn't exist in the mission's artifacts.
    const linkBad = await httpCall('POST', `/v1/projects/${projectId}/artifacts`, {
      missionId,
      path: 'does-not-exist.md',
    }, 'key-a');
    expect(linkBad.status).toBe(404);
    expect((linkBad.body as { error: { code: string } }).error.code).toBe('ARTIFACT_NOT_FOUND');
  });

  it('PR-13 shows missing artifacts truthfully in overview', async () => {
    // Submit + complete a mission that produces output.md.
    const submit = await httpCall('POST', '/v1/missions', { outcome: SIMPLE_GOAL }, 'key-a');
    const missionId = (submit.body as { missionId: string }).missionId;
    await service.awaitCompletion(missionId, CALLER_A);

    // Create a project, link the artifact.
    const project = await httpCall('POST', '/v1/projects', { name: 'PR-13 proj' }, 'key-a');
    const projectId = (project.body as ProjectResponse).projectId;
    await httpCall('POST', `/v1/projects/${projectId}/artifacts`, {
      missionId,
      path: 'output.md',
    }, 'key-a');

    // Overview shows the artifact as available.
    const liveOverview = await httpCall('GET', `/v1/projects/${projectId}/overview`, null, 'key-a');
    expect(liveOverview.status).toBe(200);
    const liveArtifacts = (liveOverview.body as { artifacts: { availability: string }[] }).artifacts;
    expect(liveArtifacts).toHaveLength(1);
    expect(liveArtifacts[0].availability).toBe('available');

    // Simulate the artifact being removed from the in-process registry:
    // restart the gateway with an empty MissionService. The project record
    // remains (durable), but the mission is no longer in the in-process
    // registry — overview shows UNAVAILABLE.
    const port2 = await getFreePort();
    const config2 = buildConfig(port2);
    const localProjectDir = mkdtempSync(join(tmpdir(), 'g7-13-pr13-proj-'));
    const localConvDir = mkdtempSync(join(tmpdir(), 'g7-13-pr13-conv-'));
    const localProjects = new FileProjectStore({ dir: localProjectDir });
    const localConvs = new FileConversationStore({ dir: localConvDir });

    // Copy the project file to the new dir so the new store can read it.
    const { copyFileSync, readdirSync } = await import('node:fs');
    const srcProjectFile = join(projectDir, `${projectId}.project.json`);
    const dstProjectFile = join(localProjectDir, `${projectId}.project.json`);
    copyFileSync(srcProjectFile, dstProjectFile);

    const restartedService = new MissionService({ defaultMissionTimeoutMs: 30_000 });
    const restartedHttp = startHttpServer(restartedService, config2, localConvs, localProjects);
    const restartedUrl = restartedHttp.url;
    await new Promise((r) => setTimeout(r, 50));

    try {
      const callRestarted = (method: string, path: string, body: unknown | null) =>
        new Promise<{ status: number; body: unknown }>((resolve, reject) => {
          const url = new URL(path, restartedUrl);
          const payload = body === null ? null : JSON.stringify(body);
          const req = httpRequest(url, {
            method,
            headers: {
              'Content-Type': 'application/json',
              Authorization: 'Bearer key-a',
              ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
            },
          }, (res) => {
            const chunks: Buffer[] = [];
            res.on('data', (c: Buffer) => chunks.push(c));
            res.on('end', () => {
              const raw = Buffer.concat(chunks).toString('utf8');
              let parsed: unknown = raw;
              try { parsed = JSON.parse(raw); } catch { /* keep raw */ }
              resolve({ status: res.statusCode ?? 0, body: parsed });
            });
          });
          req.on('error', reject);
          if (payload) req.write(payload);
          req.end();
        });

      const restartedOverview = await callRestarted('GET', `/v1/projects/${projectId}/overview`, null);
      expect(restartedOverview.status).toBe(200);
      const restartedArtifacts = (restartedOverview.body as { artifacts: { availability: string }[] }).artifacts;
      expect(restartedArtifacts).toHaveLength(1);
      expect(restartedArtifacts[0].availability).toBe('unavailable');
    } finally {
      await stopHttpServer(restartedHttp.server);
      rmSync(localProjectDir, { recursive: true, force: true });
      rmSync(localConvDir, { recursive: true, force: true });
    }
    // silence unused-variable warning
    void readdirSync;
  });

  it('rejects artifact linking to a mission owned by another caller', async () => {
    // Caller A submits + completes.
    const submit = await httpCall('POST', '/v1/missions', { outcome: SIMPLE_GOAL }, 'key-a');
    const missionId = (submit.body as { missionId: string }).missionId;
    await service.awaitCompletion(missionId, CALLER_A);

    // Caller B tries to link the artifact (mission not owned by B).
    const bProject = await httpCall('POST', '/v1/projects', { name: 'B-artifact-evil' }, 'key-b');
    const bProjectId = (bProject.body as ProjectResponse).projectId;
    const link = await httpCall('POST', `/v1/projects/${bProjectId}/artifacts`, {
      missionId,
      path: 'output.md',
    }, 'key-b');
    expect(link.status).toBe(404);
  });

  it('rejects artifact path traversal attempts', async () => {
    // Submit + complete a mission.
    const submit = await httpCall('POST', '/v1/missions', { outcome: SIMPLE_GOAL }, 'key-a');
    const missionId = (submit.body as { missionId: string }).missionId;
    await service.awaitCompletion(missionId, CALLER_A);

    const project = await httpCall('POST', '/v1/projects', { name: 'traversal-proj' }, 'key-a');
    const projectId = (project.body as ProjectResponse).projectId;
    const link = await httpCall('POST', `/v1/projects/${projectId}/artifacts`, {
      missionId,
      path: '../../../etc/passwd',
    }, 'key-a');
    expect(link.status).toBe(400);
  });
});

describe('G7-13 Gateway — PR-15 idempotent relationship link at HTTP layer', () => {
  it('repeated conversation link returns the same project state (no duplicate)', async () => {
    const project = await httpCall('POST', '/v1/projects', { name: 'PR-15 HTTP' }, 'key-a');
    const projectId = (project.body as ProjectResponse).projectId;
    const conv = await httpCall('POST', '/v1/conversations', { title: 'PR-15 conv' }, 'key-a');
    const conversationId = (conv.body as { conversationId: string }).conversationId;
    const idempotencyKey = 'lc-http-1';

    const link1 = await httpCall('POST', `/v1/projects/${projectId}/conversations`, {
      conversationId,
      idempotencyKey,
    }, 'key-a');
    expect(link1.status).toBe(200);

    const link2 = await httpCall('POST', `/v1/projects/${projectId}/conversations`, {
      conversationId,
      idempotencyKey,
    }, 'key-a');
    expect(link2.status).toBe(200);
    expect((link2.body as ProjectResponse).conversationLinks).toHaveLength(1);
  });

  it('rejects idempotency-key reuse with a different conversationId', async () => {
    const project = await httpCall('POST', '/v1/projects', { name: 'PR-16 HTTP' }, 'key-a');
    const projectId = (project.body as ProjectResponse).projectId;
    const conv1 = await httpCall('POST', '/v1/conversations', { title: 'c1' }, 'key-a');
    const conv2 = await httpCall('POST', '/v1/conversations', { title: 'c2' }, 'key-a');
    const c1 = (conv1.body as { conversationId: string }).conversationId;
    const c2 = (conv2.body as { conversationId: string }).conversationId;

    await httpCall('POST', `/v1/projects/${projectId}/conversations`, {
      conversationId: c1,
      idempotencyKey: 'kc-conflict',
    }, 'key-a');
    const r = await httpCall('POST', `/v1/projects/${projectId}/conversations`, {
      conversationId: c2,
      idempotencyKey: 'kc-conflict',
    }, 'key-a');
    expect(r.status).toBe(409);
  });
});

describe('G7-13 Gateway — PATCH project + archive', () => {
  it('updates name, description, and status', async () => {
    const created = await httpCall('POST', '/v1/projects', { name: 'patchable' }, 'key-a');
    const projectId = (created.body as ProjectResponse).projectId;
    const r = await httpCall('PATCH', `/v1/projects/${projectId}`, {
      name: 'patched',
      description: 'd2',
      status: 'archived',
    }, 'key-a');
    expect(r.status).toBe(200);
    expect((r.body as ProjectResponse).name).toBe('patched');
    expect((r.body as ProjectResponse).description).toBe('d2');
    expect((r.body as ProjectResponse).status).toBe('archived');
  });

  it('rejects invalid status', async () => {
    const created = await httpCall('POST', '/v1/projects', { name: 'status-gw' }, 'key-a');
    const projectId = (created.body as ProjectResponse).projectId;
    const r = await httpCall('PATCH', `/v1/projects/${projectId}`, {
      status: 'deleted',
    }, 'key-a');
    expect(r.status).toBe(400);
  });
});

describe('G7-13 Gateway — overview derivation (truthful states)', () => {
  it('returns a deterministic overview with all sections', async () => {
    const project = await httpCall('POST', '/v1/projects', {
      name: 'Overview proj',
      description: 'Overview test',
    }, 'key-a');
    const projectId = (project.body as ProjectResponse).projectId;
    const r = await httpCall('GET', `/v1/projects/${projectId}/overview`, null, 'key-a');
    expect(r.status).toBe(200);
    const body = r.body as {
      project: { projectId: string; name: string; status: string };
      brief: { revision: number };
      conversations: unknown[];
      missions: unknown[];
      artifacts: unknown[];
      latestActivityAt: string;
    };
    expect(body.project.projectId).toBe(projectId);
    expect(body.project.name).toBe('Overview proj');
    expect(body.conversations).toEqual([]);
    expect(body.missions).toEqual([]);
    expect(body.artifacts).toEqual([]);
    expect(typeof body.latestActivityAt).toBe('string');
  });
});

describe('G7-13 Gateway — PR-18 backward compatibility (legacy conversations)', () => {
  it('a conversation created via /v1/conversations remains accessible without a project', async () => {
    // G7-12 path: create a conversation the legacy way (no project context).
    const conv = await httpCall('POST', '/v1/conversations', { title: 'legacy' }, 'key-a');
    expect(conv.status).toBe(201);
    const conversationId = (conv.body as { conversationId: string }).conversationId;

    // The conversation is still accessible via /v1/conversations/{id}.
    const fetched = await httpCall('GET', `/v1/conversations/${conversationId}`, null, 'key-a');
    expect(fetched.status).toBe(200);

    // The conversation appears in the caller's list as before.
    const list = await httpCall('GET', '/v1/conversations', null, 'key-a');
    expect(list.status).toBe(200);
    const convs = (list.body as { conversations: { conversationId: string }[] }).conversations;
    expect(convs.some((c) => c.conversationId === conversationId)).toBe(true);

    // Sending messages via /v1/conversations/{id}/messages still works.
    const msg = await httpCall('POST', `/v1/conversations/${conversationId}/messages`, {
      role: 'user',
      content: 'PR-18 backward-compat message',
    }, 'key-a');
    expect(msg.status).toBe(201);
  });
});

// ===========================================================================
// G7-13F (Finding 1) — Brief provenance trust (gateway layer).
// API callers cannot falsely establish SOURCE_VERIFIED or impersonate
// another approving identity. USER_APPROVED entries are bound to the
// authenticated caller's callerId; SOURCE_VERIFIED entries must reference
// a mission that exists for the caller.
// ===========================================================================

describe('G7-13F (F1) — Brief provenance trust (gateway layer)', () => {
  // Note: re-using the shared `service`, `httpUrl`, `httpCall`, `key-a`
  // from the file scope — these are already set up in beforeAll.

  it('USER_APPROVED entry: server binds source to callerId (ignores client-supplied source)', async () => {
    const project = await httpCall('POST', '/v1/projects', { name: 'F1-impersonation' }, 'key-a');
    const projectId = (project.body as ProjectResponse).projectId;

    // Client tries to impersonate "operator:bob" — the server must override
    // the source with "caller:caller-a" (the actual authenticated callerId).
    const r = await httpCall('PUT', `/v1/projects/${projectId}/brief`, {
      revision: 0,
      approvedDecisions: [
        {
          id: 'dec-evil',
          text: 'approved by bob (impersonation attempt)',
          provenance: 'USER_APPROVED',
          source: 'operator:bob',     // malicious — should be ignored
          approvedAt: '1970-01-01T00:00:00.000Z',  // malicious — should be ignored
        },
      ],
    }, 'key-a');
    expect(r.status).toBe(200);

    // Verify the server bound the source to the authenticated callerId.
    const briefRes = await httpCall('GET', `/v1/projects/${projectId}/brief`, null, 'key-a');
    const body = briefRes.body as { brief: { approvedDecisions: { source: string; approvedAt: string }[] } };
    expect(body.brief.approvedDecisions).toHaveLength(1);
    expect(body.brief.approvedDecisions[0].source).toBe('caller:caller-a');
    expect(body.brief.approvedDecisions[0].approvedAt).not.toBe('1970-01-01T00:00:00.000Z');
  });

  it('USER_APPROVED entry without source: server still binds to callerId', async () => {
    const project = await httpCall('POST', '/v1/projects', { name: 'F1-no-source' }, 'key-a');
    const projectId = (project.body as ProjectResponse).projectId;
    const r = await httpCall('PUT', `/v1/projects/${projectId}/brief`, {
      revision: 0,
      approvedDecisions: [
        { id: 'dec-ok', text: 'approved by no-one-in-particular', provenance: 'USER_APPROVED' },
      ],
    }, 'key-a');
    expect(r.status).toBe(200);
    const briefRes = await httpCall('GET', `/v1/projects/${projectId}/brief`, null, 'key-a');
    const body = briefRes.body as { brief: { approvedDecisions: { source: string }[] } };
    expect(body.brief.approvedDecisions[0].source).toBe('caller:caller-a');
  });

  it('SOURCE_VERIFIED entry: rejects a non-mission source format', async () => {
    const project = await httpCall('POST', '/v1/projects', { name: 'F1-bad-source-format' }, 'key-a');
    const projectId = (project.body as ProjectResponse).projectId;
    const r = await httpCall('PUT', `/v1/projects/${projectId}/brief`, {
      revision: 0,
      completedMilestones: [
        { id: 'm1', text: 'verified by some random URL', provenance: 'SOURCE_VERIFIED', source: 'https://example.com/something' },
      ],
    }, 'key-a');
    expect(r.status).toBe(400);
    expect((r.body as { error: { code: string; message: string } }).error.code).toBe('INVALID_PROJECT');
    expect((r.body as { error: { message: string } }).error.message).toContain('mission:<missionId>');
  });

  it('SOURCE_VERIFIED entry: rejects a non-existent mission reference', async () => {
    const project = await httpCall('POST', '/v1/projects', { name: 'F1-fake-mission' }, 'key-a');
    const projectId = (project.body as ProjectResponse).projectId;
    const r = await httpCall('PUT', `/v1/projects/${projectId}/brief`, {
      revision: 0,
      completedMilestones: [
        { id: 'm1', text: 'verified by a fake mission', provenance: 'SOURCE_VERIFIED', source: 'mission:fake-mission-id-not-real' },
      ],
    }, 'key-a');
    expect(r.status).toBe(400);
    expect((r.body as { error: { code: string } }).error.code).toBe('INVALID_PROJECT');
    expect((r.body as { error: { message: string } }).error.message).toContain('not found or not owned by caller');
  });

  it('SOURCE_VERIFIED entry: rejects a mission owned by another caller', async () => {
    // Caller A submits + completes a mission.
    const submit = await httpCall('POST', '/v1/missions', { outcome: SIMPLE_GOAL }, 'key-a');
    const missionId = (submit.body as { missionId: string }).missionId;
    await service.awaitCompletion(missionId, CALLER_A);

    // Caller B tries to use A's mission as a SOURCE_VERIFIED reference.
    const bProject = await httpCall('POST', '/v1/projects', { name: 'F1-cross-caller-mission' }, 'key-b');
    const bProjectId = (bProject.body as ProjectResponse).projectId;
    const r = await httpCall('PUT', `/v1/projects/${bProjectId}/brief`, {
      revision: 0,
      completedMilestones: [
        { id: 'm1', text: 'verified by A\'s mission', provenance: 'SOURCE_VERIFIED', source: `mission:${missionId}` },
      ],
    }, 'key-b');
    expect(r.status).toBe(400);
    expect((r.body as { error: { message: string } }).error.message).toContain('not found or not owned by caller');
  });

  it('SOURCE_VERIFIED entry: accepts a real mission owned by the caller', async () => {
    // Caller A submits + completes a mission.
    const submit = await httpCall('POST', '/v1/missions', { outcome: SIMPLE_GOAL }, 'key-a');
    const missionId = (submit.body as { missionId: string }).missionId;
    await service.awaitCompletion(missionId, CALLER_A);

    const project = await httpCall('POST', '/v1/projects', { name: 'F1-real-mission' }, 'key-a');
    const projectId = (project.body as ProjectResponse).projectId;
    const r = await httpCall('PUT', `/v1/projects/${projectId}/brief`, {
      revision: 0,
      completedMilestones: [
        { id: 'm1', text: 'verified by a real mission', provenance: 'SOURCE_VERIFIED', source: `mission:${missionId}` },
      ],
    }, 'key-a');
    expect(r.status).toBe(200);
    const briefRes = await httpCall('GET', `/v1/projects/${projectId}/brief`, null, 'key-a');
    const body = briefRes.body as { brief: { completedMilestones: { source: string; provenance: string }[] } };
    expect(body.brief.completedMilestones).toHaveLength(1);
    expect(body.brief.completedMilestones[0].source).toBe(`mission:${missionId}`);
    expect(body.brief.completedMilestones[0].provenance).toBe('SOURCE_VERIFIED');
  });

  it('DRAFT entry: strips client-supplied source/approvedAt (no silent promotion)', async () => {
    const project = await httpCall('POST', '/v1/projects', { name: 'F1-draft-strip' }, 'key-a');
    const projectId = (project.body as ProjectResponse).projectId;
    const r = await httpCall('PUT', `/v1/projects/${projectId}/brief`, {
      revision: 0,
      approvedDecisions: [
        {
          id: 'd1',
          text: 'a draft decision (not yet approved)',
          provenance: 'DRAFT',
          source: 'should-be-stripped',
          approvedAt: '1970-01-01T00:00:00.000Z',
        },
      ],
    }, 'key-a');
    expect(r.status).toBe(200);
    const briefRes = await httpCall('GET', `/v1/projects/${projectId}/brief`, null, 'key-a');
    const body = briefRes.body as { brief: { approvedDecisions: { source?: string; approvedAt?: string; provenance: string }[] } };
    expect(body.brief.approvedDecisions).toHaveLength(1);
    expect(body.brief.approvedDecisions[0].provenance).toBe('DRAFT');
    expect(body.brief.approvedDecisions[0].source).toBeUndefined();
    expect(body.brief.approvedDecisions[0].approvedAt).toBeUndefined();
  });
});

// ===========================================================================
// G7-13F (Finding 2) — Corrupt project recovery (gateway layer).
// Cross-caller access to a corrupt project returns 404 (not 500) to avoid
// leaking existence. The corrupt file is preserved on disk.
// ===========================================================================

describe('G7-13F (F2) — Corrupt project recovery (gateway layer)', () => {
  it('returns 404 (not 500) when a project file is corrupt', async () => {
    // Caller A creates a project, then we corrupt the file.
    const project = await httpCall('POST', '/v1/projects', { name: 'F2-corrupt' }, 'key-a');
    const projectId = (project.body as ProjectResponse).projectId;
    const { writeFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const projectPath = join(projectDir, `${projectId}.project.json`);
    writeFileSync(projectPath, 'garbage', 'utf8');

    // Caller A gets 404 (not 500) — the route handler maps ProjectCorruptError → 404.
    const r = await httpCall('GET', `/v1/projects/${projectId}`, null, 'key-a');
    expect(r.status).toBe(404);
    expect((r.body as { error: { code: string } }).error.code).toBe('PROJECT_NOT_FOUND');

    // Caller B also gets 404 (no leak that the file exists for A).
    const rB = await httpCall('GET', `/v1/projects/${projectId}`, null, 'key-b');
    expect(rB.status).toBe(404);
    expect((rB.body as { error: { code: string } }).error.code).toBe('PROJECT_NOT_FOUND');
  });

  it('brief GET returns 404 when project is corrupt', async () => {
    const project = await httpCall('POST', '/v1/projects', { name: 'F2-corrupt-brief' }, 'key-a');
    const projectId = (project.body as ProjectResponse).projectId;
    const { writeFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    writeFileSync(join(projectDir, `${projectId}.project.json`), 'garbage', 'utf8');

    const r = await httpCall('GET', `/v1/projects/${projectId}/brief`, null, 'key-a');
    expect(r.status).toBe(404);
  });

  it('overview GET returns 404 when project is corrupt', async () => {
    const project = await httpCall('POST', '/v1/projects', { name: 'F2-corrupt-overview' }, 'key-a');
    const projectId = (project.body as ProjectResponse).projectId;
    const { writeFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    writeFileSync(join(projectDir, `${projectId}.project.json`), 'garbage', 'utf8');

    const r = await httpCall('GET', `/v1/projects/${projectId}/overview`, null, 'key-a');
    expect(r.status).toBe(404);
  });

  it('list projects still works when one project is corrupt (scan skips it)', async () => {
    const valid = await httpCall('POST', '/v1/projects', { name: 'F2-list-valid' }, 'key-a');
    const corrupt = await httpCall('POST', '/v1/projects', { name: 'F2-list-corrupt' }, 'key-a');
    const { writeFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    writeFileSync(join(projectDir, `${(corrupt.body as ProjectResponse).projectId}.project.json`), 'garbage', 'utf8');

    const r = await httpCall('GET', '/v1/projects', null, 'key-a');
    expect(r.status).toBe(200);
    const body = r.body as { projects: { name: string }[] };
    expect(body.projects.some((p) => p.name === 'F2-list-valid')).toBe(true);
    expect(body.projects.some((p) => p.name === 'F2-list-corrupt')).toBe(false);
    // Silence unused-var lint — `valid` is the project we expect to remain.
    void valid;
  });
});
