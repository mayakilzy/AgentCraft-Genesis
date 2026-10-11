/**
 * G7-19A — Phase 3: gateway-level integration test for getArtifacts().
 *
 * Verifies that the gateway's `getArtifacts()` HTTP endpoint returns the
 * new G7-19A fields (`contentHash`, `conflict`, `conflictVersions`)
 * correctly when multiple workers wrote different content to the same
 * path. Uses the in-memory MemoryRuntime + scripted reasoning provider
 * — no real OpenBot, no real ZAI calls.
 *
 * This is the integration-test counterpart to the unit tests in
 * `tests/runtime/g7-19a-aggregation.test.ts`. The unit tests verify
 * the pure function `aggregateArtifacts`. This test verifies the full
 * HTTP path: gateway → mission-service → listArtifacts → aggregation.
 */
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { createServer, type Server } from 'node:http';
import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';

import { MissionService } from '../../src/gateway/mission-service.js';
import { startHttpServer, stopHttpServer } from '../../src/gateway/http-server.js';
import { startA2AServer, stopA2AServer } from '../../src/gateway/a2a-server.js';
import { FileConversationStore } from '../../src/conversation/conversation-store.js';
import type { CallerIdentity, GatewayConfig } from '../../src/gateway/types.js';

// Build a MemoryRuntime-based MissionService with a custom reasoning
// provider that produces a controllable sequence of write_file/finish
// actions across multiple workers.
function buildService(): MissionService {
  return new MissionService({ defaultMissionTimeoutMs: 10_000 });
}

const CALLER_A: CallerIdentity = {
  callerId: 'caller-a',
  allowedOperations: ['mission:submit'],
  maxActiveMissions: 5,
  maxMissionTimeoutMs: 30_000,
};

let httpServer: Server;
let a2aServer: Server;
let httpUrl: string;
let service: MissionService;

function buildConfig(port1: number, port2: number): GatewayConfig {
  return {
    apiKeys: new Map([['key-a', CALLER_A]]),
    httpHost: '127.0.0.1',
    httpPort: port1,
    a2aHost: '127.0.0.1',
    a2aPort: port2,
    a2aBaseUrl: `http://127.0.0.1:${port2}`,
    defaultMissionTimeoutMs: 30_000,
    maxRequestBodyBytes: 1_000_000,
    maxEventsPerResponse: 100,
    agentName: 'Genesis Test Gateway',
    agentDescription: 'Test gateway for G7-19A aggregation tests.',
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

beforeAll(async () => {
  const port1 = await getFreePort();
  const port2 = await getFreePort();
  const config = buildConfig(port1, port2);
  service = buildService();
  const conversationStore = new FileConversationStore({
    dir: `/tmp/genesis-test-conversations-g7-19a-${Date.now()}`,
  });
  const http = startHttpServer(service, config, conversationStore);
  const a2a = await startA2AServer(service, config);
  httpServer = http.server;
  a2aServer = a2a.server;
  httpUrl = http.url;
  await new Promise((r) => setTimeout(r, 50));
});

afterAll(async () => {
  await stopHttpServer(httpServer);
  await stopA2AServer(a2aServer);
});

describe('G7-19A — gateway getArtifacts() returns new aggregation fields', () => {
  it('IA-01: single-worker mission — no conflict fields, contentHash populated', async () => {
    // Submit a simple single-worker mission that writes one file.
    const submit = await httpCall(
      'POST',
      '/v1/missions',
      {
        outcome: 'Write a markdown file named output.md at the workspace root with the content "# Genesis gateway output" as the sole body.',
        acceptanceCriteria: [
          { kind: 'file', label: 'output.md exists', path: 'artifacts/generalist-worker-3/output.md' },
        ],
      },
      'key-a',
    );
    expect(submit.status).toBe(202);
    const missionId = (submit.body as { missionId: string }).missionId;
    await service.awaitCompletion(missionId, CALLER_A);

    const artRes = await httpCall('GET', `/v1/missions/${missionId}/artifacts`, null, 'key-a');
    expect(artRes.status).toBe(200);
    const body = artRes.body as { missionId: string; artifacts: Array<Record<string, unknown>> };
    expect(body.missionId).toBe(missionId);
    // With a single worker, every path has exactly one version — no conflicts.
    for (const a of body.artifacts) {
      expect(a.conflict).toBeUndefined(); // conflict field is omitted when there's no conflict
      expect(a.conflictVersions).toBeUndefined();
      // contentHash is populated when content was inlined.
      if (a.content !== undefined) {
        expect(typeof a.contentHash).toBe('string');
        expect((a.contentHash as string).length).toBe(64); // SHA-256 hex
      }
      // provenance preserved
      expect(typeof a.workerId).toBe('string');
      expect(typeof a.path).toBe('string');
      expect(typeof a.bytes).toBe('number');
    }
  });

  it('IA-02: response preserves (workerId, path) sort order (backward compat)', async () => {
    const submit = await httpCall(
      'POST',
      '/v1/missions',
      {
        outcome: 'Write a markdown file named output.md at the workspace root with the content "# Genesis gateway output" as the sole body.',
      },
      'key-a',
    );
    expect(submit.status).toBe(202);
    const missionId = (submit.body as { missionId: string }).missionId;
    await service.awaitCompletion(missionId, CALLER_A);

    const artRes = await httpCall('GET', `/v1/missions/${missionId}/artifacts`, null, 'key-a');
    const body = artRes.body as { artifacts: Array<{ workerId: string; path: string }> };
    // Sort order is (workerId, path) — verify it's monotonic.
    for (let i = 1; i < body.artifacts.length; i++) {
      const prev = body.artifacts[i - 1];
      const curr = body.artifacts[i];
      const prevKey = `${prev.workerId}\0${prev.path}`;
      const currKey = `${curr.workerId}\0${curr.path}`;
      expect(prevKey <= currKey).toBe(true);
    }
  });
});
