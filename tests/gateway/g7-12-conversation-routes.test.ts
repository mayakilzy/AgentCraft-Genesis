/**
 * G7-12 — Conversation Gateway Route tests.
 *
 * Tests the HTTP layer for conversation CRUD + messages + mission links.
 * Uses the real HTTP server (same pattern as tests/gateway/helpers.ts) but
 * with a dedicated FileConversationStore in a temp directory.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { MissionService } from '../../src/gateway/mission-service.js';
import { startHttpServer, stopHttpServer } from '../../src/gateway/http-server.js';
import { FileConversationStore } from '../../src/conversation/conversation-store.js';
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
const convDir = mkdtempSync(join(tmpdir(), 'g7-12-gw-test-'));

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
    agentName: 'Genesis Test',
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
      srv.close(() => resolve(addr.port));
    });
  });
}

beforeAll(async () => {
  const port = await getFreePort();
  const config = buildConfig(port);
  service = new MissionService({ defaultMissionTimeoutMs: 10_000 });
  conversationStore = new FileConversationStore({ dir: convDir });
  const http = startHttpServer(service, config, conversationStore);
  httpServer = http.server;
  httpUrl = http.url;
  await new Promise((r) => setTimeout(r, 50));
});

afterAll(async () => {
  await stopHttpServer(httpServer);
  service.close();
  rmSync(convDir, { recursive: true, force: true });
});

describe('G7-12 Gateway — Conversation Routes', () => {
  it('POST /v1/conversations creates a conversation', async () => {
    const res = await httpCall(
      'POST',
      '/v1/conversations',
      { title: 'Gateway Test', firstMessage: 'Hello gateway' },
      'key-a',
    );
    expect(res.status).toBe(201);
    const body = res.body as { conversationId: string; title: string; callerId: string };
    expect(body.conversationId).toBeDefined();
    expect(body.title).toBe('Gateway Test');
    expect(body.callerId).toBe('caller-a');
  });

  it('GET /v1/conversations lists caller conversations', async () => {
    // Create a conversation first.
    await httpCall('POST', '/v1/conversations', { title: 'List Test' }, 'key-a');

    const res = await httpCall('GET', '/v1/conversations', null, 'key-a');
    expect(res.status).toBe(200);
    const body = res.body as { conversations: unknown[]; nextCursor: string | null };
    expect(body.conversations.length).toBeGreaterThan(0);
  });

  it('GET /v1/conversations/{id} returns conversation metadata', async () => {
    const create = await httpCall('POST', '/v1/conversations', { title: 'Get Test' }, 'key-a');
    const convId = (create.body as { conversationId: string }).conversationId;

    const res = await httpCall('GET', `/v1/conversations/${convId}`, null, 'key-a');
    expect(res.status).toBe(200);
    expect((res.body as { conversationId: string }).conversationId).toBe(convId);
  });

  it('POST /v1/conversations/{id}/messages appends a message', async () => {
    const create = await httpCall('POST', '/v1/conversations', { title: 'Msg Test' }, 'key-a');
    const convId = (create.body as { conversationId: string }).conversationId;

    const res = await httpCall(
      'POST',
      `/v1/conversations/${convId}/messages`,
      { role: 'user', content: 'Test message' },
      'key-a',
    );
    expect(res.status).toBe(201);
    expect((res.body as { content: string }).content).toBe('Test message');
  });

  it('GET /v1/conversations/{id}/messages returns paginated messages', async () => {
    const create = await httpCall('POST', '/v1/conversations', { title: 'Paginate Test' }, 'key-a');
    const convId = (create.body as { conversationId: string }).conversationId;

    // Append 3 messages.
    for (let i = 0; i < 3; i++) {
      await httpCall(
        'POST',
        `/v1/conversations/${convId}/messages`,
        { role: 'user', content: `Msg ${i}` },
        'key-a',
      );
    }

    const res = await httpCall('GET', `/v1/conversations/${convId}/messages?limit=2`, null, 'key-a');
    expect(res.status).toBe(200);
    const body = res.body as { messages: { seq: number }[]; nextCursor: string | null };
    expect(body.messages.length).toBe(2);
    expect(body.nextCursor).not.toBeNull();
  });

  it('POST /v1/conversations/{id}/missions links a mission', async () => {
    const create = await httpCall('POST', '/v1/conversations', { title: 'Link Test' }, 'key-a');
    const convId = (create.body as { conversationId: string }).conversationId;

    const res = await httpCall(
      'POST',
      `/v1/conversations/${convId}/missions`,
      { missionId: 'test-mission-123' },
      'key-a',
    );
    expect(res.status).toBe(200);
    expect((res.body as { missionIds: string[] }).missionIds).toContain('test-mission-123');
  });

  it('CT-03: caller B gets 404 for caller A\'s conversation', async () => {
    const create = await httpCall('POST', '/v1/conversations', { title: 'A Private' }, 'key-a');
    const convId = (create.body as { conversationId: string }).conversationId;

    // Caller B tries to read.
    const res = await httpCall('GET', `/v1/conversations/${convId}`, null, 'key-b');
    expect(res.status).toBe(404); // 404 (not 403) to avoid leaking existence.
  });

  it('CT-04: idempotency key prevents duplicate messages', async () => {
    const create = await httpCall('POST', '/v1/conversations', { title: 'Idem Gateway' }, 'key-a');
    const convId = (create.body as { conversationId: string }).conversationId;

    // First append.
    const res1 = await httpCall(
      'POST',
      `/v1/conversations/${convId}/messages`,
      { role: 'user', content: 'Original', idempotencyKey: 'dup-key-1' },
      'key-a',
    );
    expect(res1.status).toBe(201);

    // Retry with same key.
    const res2 = await httpCall(
      'POST',
      `/v1/conversations/${convId}/messages`,
      { role: 'user', content: 'Duplicate', idempotencyKey: 'dup-key-1' },
      'key-a',
    );
    expect(res2.status).toBe(201);
    expect((res2.body as { messageId: string }).messageId).toBe(
      (res1.body as { messageId: string }).messageId,
    );

    // Verify only 1 message.
    const msgs = await httpCall('GET', `/v1/conversations/${convId}/messages`, null, 'key-a');
    expect((msgs.body as { messages: unknown[] }).messages.length).toBe(1);
  });

  it('unauthenticated request returns 401', async () => {
    const res = await httpCall('GET', '/v1/conversations', null, null);
    expect(res.status).toBe(401);
  });

  it('invalid limit returns 400', async () => {
    const res = await httpCall('GET', '/v1/conversations?limit=0', null, 'key-a');
    expect(res.status).toBe(400);
  });

  it('PATCH /v1/conversations/{id} updates title', async () => {
    const create = await httpCall('POST', '/v1/conversations', { title: 'Old Title' }, 'key-a');
    const convId = (create.body as { conversationId: string }).conversationId;

    const res = await httpCall(
      'PATCH',
      `/v1/conversations/${convId}`,
      { title: 'New Title' },
      'key-a',
    );
    expect(res.status).toBe(200);
    expect((res.body as { title: string }).title).toBe('New Title');
  });
});
