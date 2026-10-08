/**
 * G6-06-R1 — Concurrent A2A cancellation authorization tests.
 *
 * Verifies that the AsyncLocalStorage-based caller context is safe
 * under concurrency: concurrent requests cannot contaminate caller
 * identity, and cross-caller cancellation is always rejected.
 *
 * Per Blocker A: "Create deterministic overlapping-request tests with
 * two authenticated callers and different owned tasks."
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { request as httpRequest } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';

import { MissionService } from '../../src/gateway/mission-service.js';
import { startA2AServer, stopA2AServer } from '../../src/gateway/a2a-server.js';
import type { CallerIdentity, GatewayConfig } from '../../src/gateway/types.js';

const CALLER_A: CallerIdentity = {
  callerId: 'caller-a',
  allowedOperations: ['mission:submit'],
  maxActiveMissions: 10,
  maxMissionTimeoutMs: 30_000,
};

const CALLER_B: CallerIdentity = {
  callerId: 'caller-b',
  allowedOperations: ['mission:submit'],
  maxActiveMissions: 10,
  maxMissionTimeoutMs: 30_000,
};

let a2aServer: Server;
let a2aUrl: string;
let service: MissionService;

function buildConfig(port: number): GatewayConfig {
  const apiKeys = new Map<string, CallerIdentity>();
  apiKeys.set('key-a', CALLER_A);
  apiKeys.set('key-b', CALLER_B);
  return {
    apiKeys,
    httpHost: '127.0.0.1',
    httpPort: 0,
    a2aHost: '127.0.0.1',
    a2aPort: port,
    a2aBaseUrl: `http://127.0.0.1:${port}`,
    defaultMissionTimeoutMs: 30_000,
    maxRequestBodyBytes: 1_000_000,
    maxEventsPerResponse: 100,
    agentName: 'Concurrency Test Gateway',
    agentDescription: 'Test gateway for concurrent A2A cancellation tests.',
  };
}

function a2aCall(method: string, params: unknown, apiKey: string): Promise<unknown> {
  const body = JSON.stringify({ jsonrpc: '2.0', method, params, id: randomUUID() });
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
          try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
          catch (e) { reject(e); }
        });
      },
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function buildMessage(text: string): unknown {
  return {
    message: {
      messageId: randomUUID(),
      contextId: randomUUID(),
      taskId: '',
      role: 1,
      parts: [{ text }],
      metadata: undefined,
      extensions: [],
      referenceTaskIds: [],
    },
  };
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

/**
 * Poll GetTask until the task reaches a terminal state.
 * Returns the final state string.
 */
async function pollUntilTerminal(taskId: string, apiKey: string): Promise<string> {
  for (let i = 0; i < 60; i++) {
    const res = (await a2aCall('GetTask', { id: taskId }, apiKey)) as {
      result?: { status?: { state?: string | number } };
      error?: { code: number };
    };
    if (res.error) { await new Promise((r) => setTimeout(r, 100)); continue; }
    const state = String(res.result?.status?.state ?? '');
    if (state.includes('COMPLETED') || state.includes('FAILED') || state.includes('CANCELED') ||
        state === '3' || state === '4' || state === '5') {
      return state;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return 'TIMEOUT';
}

const QUICK_GOAL =
  'Write a markdown file named output.md at the workspace root with the content "# Genesis gateway output" as the sole body.';

beforeAll(async () => {
  const port = await getFreePort();
  const config = buildConfig(port);
  service = new MissionService({ defaultMissionTimeoutMs: 10_000 });
  const a2a = await startA2AServer(service, config);
  a2aServer = a2a.server;
  a2aUrl = a2a.url;
  await new Promise((r) => setTimeout(r, 50));
});

afterAll(async () => {
  await stopA2AServer(a2aServer);
});

describe('G6-06-R1 — Concurrent A2A caller isolation', () => {
  it('CONCURRENT-01: two callers submit concurrently and each gets their own task', async () => {
    const [resA, resB] = await Promise.all([
      a2aCall('SendMessage', buildMessage(QUICK_GOAL), 'key-a'),
      a2aCall('SendMessage', buildMessage(QUICK_GOAL), 'key-b'),
    ]);

    const taskA = (resA as { result?: { task?: { id: string } } }).result?.task;
    const taskB = (resB as { result?: { task?: { id: string } } }).result?.task;

    expect(taskA).toBeDefined();
    expect(taskB).toBeDefined();
    expect(taskA!.id).not.toBe(taskB!.id);
  });

  it('CONCURRENT-02: caller A cannot cancel caller B\'s task', async () => {
    // Caller B submits a task.
    const resB = (await a2aCall('SendMessage', buildMessage(QUICK_GOAL), 'key-b')) as {
      result?: { task?: { id: string } };
    };
    const taskBId = resB.result!.task!.id;

    // Caller A tries to cancel B's task.
    await a2aCall('CancelTask', { id: taskBId }, 'key-a');

    // Wait for B's task to complete naturally.
    const finalState = await pollUntilTerminal(taskBId, 'key-b');

    // The task must NOT be CANCELED — A's cancel was rejected.
    expect(finalState).not.toContain('CANCELED');
    expect(finalState).not.toBe('5');
  });

  it('CONCURRENT-03: caller B cannot cancel caller A\'s task', async () => {
    const resA = (await a2aCall('SendMessage', buildMessage(QUICK_GOAL), 'key-a')) as {
      result?: { task?: { id: string } };
    };
    const taskAId = resA.result!.task!.id;

    // Caller B tries to cancel A's task.
    await a2aCall('CancelTask', { id: taskAId }, 'key-b');

    // Wait for A's task to complete naturally.
    const finalState = await pollUntilTerminal(taskAId, 'key-a');

    expect(finalState).not.toContain('CANCELED');
    expect(finalState).not.toBe('5');
  });

  it('CONCURRENT-04: simultaneous cross-caller cancels do not contaminate', async () => {
    // Both callers submit tasks.
    const [resA, resB] = await Promise.all([
      a2aCall('SendMessage', buildMessage(QUICK_GOAL), 'key-a'),
      a2aCall('SendMessage', buildMessage(QUICK_GOAL), 'key-b'),
    ]);
    const taskAId = (resA as { result?: { task?: { id: string } } }).result!.task!.id;
    const taskBId = (resB as { result?: { task?: { id: string } } }).result!.task!.id;

    // Both callers try to cancel EACH OTHER's tasks simultaneously.
    const [cancelA_ofB, cancelB_ofA] = await Promise.all([
      a2aCall('CancelTask', { id: taskBId }, 'key-a'),
      a2aCall('CancelTask', { id: taskAId }, 'key-b'),
    ]);

    // Both cancels should have been rejected (no error thrown, but task
    // not cancelled).
    expect(cancelA_ofB).toBeDefined();
    expect(cancelB_ofA).toBeDefined();

    // Wait for both tasks to complete naturally.
    const [finalStateA, finalStateB] = await Promise.all([
      pollUntilTerminal(taskAId, 'key-a'),
      pollUntilTerminal(taskBId, 'key-b'),
    ]);

    expect(finalStateA).not.toContain('CANCELED');
    expect(finalStateA).not.toBe('5');
    expect(finalStateB).not.toContain('CANCELED');
    expect(finalStateB).not.toBe('5');
  });

  it('CONCURRENT-05: repeated requests from same caller remain correctly isolated', async () => {
    // Caller A submits 3 tasks.
    const taskIds: string[] = [];
    for (let i = 0; i < 3; i++) {
      const res = (await a2aCall('SendMessage', buildMessage(QUICK_GOAL), 'key-a')) as {
        result?: { task?: { id: string } };
      };
      taskIds.push(res.result!.task!.id);
    }

    // All three should be accessible to caller A and complete normally.
    const finalStates = await Promise.all(
      taskIds.map((id) => pollUntilTerminal(id, 'key-a')),
    );

    for (const state of finalStates) {
      expect(state).not.toBe('TIMEOUT');
    }
  });
});
