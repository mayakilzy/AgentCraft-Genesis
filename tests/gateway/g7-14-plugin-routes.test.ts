/**
 * G7-14B — Gateway plugin route tests.
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
import type { McpServerConfig } from '../../src/plugins/mcp-config.js';

const CALLER_A: CallerIdentity = { callerId: 'caller-a', allowedOperations: ['mission:submit'], maxActiveMissions: 5, maxMissionTimeoutMs: 30_000 };
let httpServer: Server; let httpUrl: string; let service: MissionService;

function buildConfig(port: number): GatewayConfig {
  return { apiKeys: new Map([['key-a', CALLER_A]]), httpHost: '127.0.0.1', httpPort: port, a2aHost: '127.0.0.1', a2aPort: port + 1, a2aBaseUrl: `http://127.0.0.1:${port + 1}`, defaultMissionTimeoutMs: 30_000, maxRequestBodyBytes: 1_000_000, maxEventsPerResponse: 100, agentName: 'Genesis G7-14 Test', agentDescription: 'Test' };
}

function httpCall(method: string, path: string, body: unknown | null, apiKey: string | null): Promise<{ status: number; body: unknown }> {
  const url = new URL(path, httpUrl);
  const payload = body === null ? null : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = httpRequest(url, { method, headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}), ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}) } }, (res) => {
      const chunks: Buffer[] = []; res.on('data', (c: Buffer) => chunks.push(c)); res.on('end', () => { const raw = Buffer.concat(chunks).toString('utf8'); let parsed: unknown = raw; try { parsed = JSON.parse(raw); } catch { /* keep */ } resolve({ status: res.statusCode ?? 0, body: parsed }); });
    });
    req.on('error', reject); if (payload) req.write(payload); req.end();
  });
}

function getFreePort(): Promise<number> { return new Promise((resolve) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const a = s.address() as AddressInfo; s.close(() => resolve(a.port)); }); }); }

const TEST_SERVERS: McpServerConfig[] = [
  { name: 'analyze-server', transport: { kind: 'stdio' as const, command: 'node', args: ['server.ts'] }, grants: ['mcp:analyze'], satisfies: ['data-analysis'], description: 'Test' },
  { name: 'search-server', transport: { kind: 'http' as const, url: 'http://127.0.0.1:8080' }, grants: ['mcp:search'], satisfies: ['web-research'] },
];

beforeAll(async () => {
  const port = await getFreePort();
  service = new MissionService({ defaultMissionTimeoutMs: 30_000 });
  const cs = new FileConversationStore({ dir: `/tmp/g7-14-conv-${Date.now()}` });
  const ps = new FileProjectStore({ dir: `/tmp/g7-14-proj-${Date.now()}` });
  const http = startHttpServer(service, buildConfig(port), cs, ps, TEST_SERVERS);
  httpServer = http.server; httpUrl = http.url;
  await new Promise((r) => setTimeout(r, 50));
});
afterAll(async () => { await stopHttpServer(httpServer); });

describe('G7-14B — Gateway plugin routes', () => {
  it('GET /v1/plugins lists configured servers', async () => {
    const r = await httpCall('GET', '/v1/plugins', null, 'key-a');
    expect(r.status).toBe(200);
    const body = r.body as { plugins: { name: string; status: string }[] };
    expect(body.plugins).toHaveLength(2);
    expect(body.plugins[0].status).toBe('CONFIGURED');
  });

  it('GET /v1/plugins/{name} returns detail', async () => {
    const r = await httpCall('GET', '/v1/plugins/analyze-server', null, 'key-a');
    expect(r.status).toBe(200);
    expect((r.body as { name: string }).name).toBe('analyze-server');
  });

  it('GET /v1/plugins/{nonexistent} → 404', async () => {
    const r = await httpCall('GET', '/v1/plugins/nonexistent', null, 'key-a');
    expect(r.status).toBe(404);
    expect((r.body as { error: { code: string } }).error.code).toBe('PLUGIN_NOT_FOUND');
  });

  it('GET /v1/plugins without auth → 401', async () => {
    const r = await httpCall('GET', '/v1/plugins', null, null);
    expect(r.status).toBe(401);
  });

  it('response does NOT contain sensitive fields', async () => {
    const r = await httpCall('GET', '/v1/plugins/analyze-server', null, 'key-a');
    const s = JSON.stringify(r.body);
    expect(s).not.toContain('node');
    expect(s).not.toContain('server.ts');
    const r2 = await httpCall('GET', '/v1/plugins/search-server', null, 'key-a');
    expect(JSON.stringify(r2.body)).not.toContain('127.0.0.1:8080');
  });

  it('POST to /v1/plugins → 404 (read-only)', async () => {
    const r = await httpCall('POST', '/v1/plugins', { name: 'evil' }, 'key-a');
    expect(r.status).toBe(404);
  });
});
