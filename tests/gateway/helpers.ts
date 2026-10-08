/**
 * G6-05A — Gateway integration tests.
 *
 * Covers the Test Matrix (Section 24):
 *   API-01..API-12 — HTTP Service API
 *   ISO-01..ISO-04 — Cross-caller isolation
 *   A2A-01..A2A-06 — Inbound A2A + outbound regression
 *   E2E-01..E2E-02 — Independent application real mission
 *   FAIL-01..FAIL-02 — Failure truthfulness + restart limitation
 *
 * All tests use the real MissionService with MemoryRuntime (deterministic,
 * no external services). The HTTP and A2A servers are real node:http
 * servers bound to ephemeral ports.
 */
import { beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { request as httpRequest, get as httpGet } from 'node:http';
import type { AddressInfo } from 'node:net';

import { MissionService } from '../../src/gateway/mission-service.js';
import { startHttpServer, stopHttpServer } from '../../src/gateway/http-server.js';
import { startA2AServer, stopA2AServer } from '../../src/gateway/a2a-server.js';
import type { CallerIdentity, GatewayConfig } from '../../src/gateway/types.js';

// --- Test caller identities ---

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

const RESTRICTED_CALLER: CallerIdentity = {
  callerId: 'caller-restricted',
  allowedOperations: [],
  maxActiveMissions: 1,
  maxMissionTimeoutMs: 5_000,
};

// --- Helpers ---

let httpServer: Server;
let a2aServer: Server;
let httpUrl: string;
let a2aUrl: string;
let service: MissionService;

function buildConfig(port1: number, port2: number): GatewayConfig {
  return {
    apiKeys: new Map([
      ['key-a', CALLER_A],
      ['key-b', CALLER_B],
      ['key-restricted', RESTRICTED_CALLER],
    ]),
    httpHost: '127.0.0.1',
    httpPort: port1,
    a2aHost: '127.0.0.1',
    a2aPort: port2,
    a2aBaseUrl: `http://127.0.0.1:${port2}`,
    defaultMissionTimeoutMs: 30_000,
    maxRequestBodyBytes: 1_000_000,
    maxEventsPerResponse: 100,
    agentName: 'Genesis Test Gateway',
    agentDescription: 'Test gateway for G6-05A integration tests.',
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

function a2aCall(method: string, params: unknown, apiKey: string): Promise<unknown> {
  const body = JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 });
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      a2aUrl + '/',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
          } catch (e) {
            reject(e);
          }
        });
      },
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function httpGetJson(url: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    httpGet(url, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch (e) { reject(e); }
      });
    }).on('error', reject);
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

// A simple goal that the default scripted reasoning provider can complete.
const SIMPLE_GOAL =
  'Write a markdown file named output.md at the workspace root with the content "# Genesis gateway output" as the sole body.';

// --- Test setup ---

beforeAll(async () => {
  const port1 = await getFreePort();
  const port2 = await getFreePort();
  const config = buildConfig(port1, port2);
  service = new MissionService({ defaultMissionTimeoutMs: 10_000 });
  const http = startHttpServer(service, config);
  const a2a = startA2AServer(service, config);
  httpServer = http.server;
  a2aServer = a2a.server;
  httpUrl = http.url;
  a2aUrl = a2a.url;
  await new Promise((r) => setTimeout(r, 50));
});

afterAll(async () => {
  await stopHttpServer(httpServer);
  await stopA2AServer(a2aServer);
});

export {
  httpCall,
  a2aCall,
  httpGetJson,
  SIMPLE_GOAL,
  CALLER_A,
  CALLER_B,
  service,
  httpUrl,
  a2aUrl,
};
