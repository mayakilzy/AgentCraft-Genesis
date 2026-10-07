import { describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';

import type { WorkerGenome } from '../src/contracts/core.js';
import type {
  JobStatus,
  JobSurface,
  WorkerSurfaces,
  WorkspaceSurface,
} from '../src/runtime/computer.js';
import { OpenMuseAdapter } from '../src/runtime/openmuse/adapter.js';
import {
  OpenMuseClient,
  OpenMuseRequestError,
} from '../src/runtime/openmuse/client.js';
import { CompositeRuntime } from '../src/runtime/composite-runtime.js';
import { MemoryRuntime, MemoryComputer } from './helpers/memory-runtime.js';

/**
 * PHASE 4.7 — OpenMuse durable-delegation architectural tests.
 */

class StubOpenMuseServer {
  private server: Server;
  private _baseUrl = '';
  private token = 'stub-token';
  private tasks = new Map<string, { id: string; status: string; result?: string; error?: string; attempts: number; prompt: string; kind: string }>();
  private nextId = 1;

  get baseUrl(): string { return this._baseUrl; }

  constructor() {
    this.server = createServer((req, res) => this.handle(req, res));
  }

  start(): Promise<void> {
    return new Promise((resolve) => {
      this.server.listen(0, '127.0.0.1', () => {
        const addr = this.server.address();
        if (addr && typeof addr === 'object') {
          this._baseUrl = `http://127.0.0.1:${addr.port}`;
        }
        resolve();
      });
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => this.server.close(() => resolve()));
  }

  setTaskStatus(taskId: string, status: string, result?: string): void {
    const task = this.tasks.get(taskId);
    if (task) {
      task.status = status;
      if (result !== undefined) task.result = result;
    }
  }

  private handle(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse): void {
    const url = new URL(req.url ?? '/', this._baseUrl || 'http://localhost');
    const path = url.pathname;
    const method = req.method ?? 'GET';
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      const parsed = body.length > 0 ? JSON.parse(body) : {};
      if (method === 'POST' && path === '/api/session') {
        this.sendJson(res, 200, { token: this.token });
        return;
      }
      const auth = req.headers.authorization;
      if (auth !== `Bearer ${this.token}`) {
        this.sendJson(res, 401, { error: 'unauthorized' });
        return;
      }
      if (method === 'POST' && path === '/api/agent/tasks') {
        const id = `task-${this.nextId++}`;
        const task = { id, status: 'queued', result: undefined, error: undefined, attempts: 0, prompt: parsed.prompt, kind: parsed.kind ?? 'finance' };
        this.tasks.set(id, task);
        this.sendJson(res, 201, task);
        return;
      }
      const getMatch = path.match(/^\/api\/agent\/tasks\/([^/]+)$/);
      if (method === 'GET' && getMatch) {
        const task = this.tasks.get(getMatch[1]!);
        if (!task) { this.sendJson(res, 404, { error: 'not found' }); return; }
        this.sendJson(res, 200, { task, events: [], artifacts: [] });
        return;
      }
      const controlMatch = path.match(/^\/api\/agent\/tasks\/([^/]+)\/control$/);
      if (method === 'POST' && controlMatch && parsed.action) {
        const task = this.tasks.get(controlMatch[1]!);
        if (!task) { this.sendJson(res, 404, { error: 'not found' }); return; }
        if (parsed.action === 'cancel') task.status = 'cancelled';
        if (parsed.action === 'pause') task.status = 'paused';
        if (parsed.action === 'resume') task.status = 'queued';
        this.sendJson(res, 200, task);
        return;
      }
      this.sendJson(res, 404, { error: 'not found' });
    });
  }

  private sendJson(res: import('node:http').ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  }
}

describe('PHASE 4.7 — OpenMuseClient (against stub server)', () => {
  let stub: StubOpenMuseServer;
  async function withStub<T>(fn: (client: OpenMuseClient) => Promise<T>): Promise<T> {
    stub = new StubOpenMuseServer();
    await stub.start();
    try { return await fn(new OpenMuseClient({ baseUrl: stub.baseUrl })); }
    finally { await stub.stop(); }
  }

  it('creates a session token and durable task', async () => {
    await withStub(async (client) => {
      const task = await client.createTask('Analyze spending', 'finance', { csv: 'test' });
      expect(task.id).toBeDefined();
      expect(task.status).toBe('queued');
      expect(task.kind).toBe('finance');
    });
  });

  it('gets task detail with status and result', async () => {
    await withStub(async (client) => {
      const task = await client.createTask('test', 'finance', {});
      stub.setTaskStatus(task.id, 'succeeded', '2 transactions');
      const detail = await client.getTask(task.id);
      expect(detail.task.status).toBe('succeeded');
      expect(detail.task.result).toBe('2 transactions');
    });
  });

  it('cancels a task', async () => {
    await withStub(async (client) => {
      const task = await client.createTask('test', 'finance', {});
      const cancelled = await client.controlTask(task.id, 'cancel');
      expect(cancelled.status).toBe('cancelled');
    });
  });

  it('throws OpenMuseRequestError on 404', async () => {
    await withStub(async (client) => {
      await expect(client.getTask('nonexistent')).rejects.toThrow(OpenMuseRequestError);
    });
  });
});

describe('PHASE 4.7 — OpenMuseAdapter', () => {
  let stub: StubOpenMuseServer;
  async function withAdapter<T>(fn: (adapter: OpenMuseAdapter, s: StubOpenMuseServer) => Promise<T>): Promise<T> {
    stub = new StubOpenMuseServer();
    await stub.start();
    try { return await fn(new OpenMuseAdapter({ baseUrl: stub.baseUrl }), stub); }
    finally { await stub.stop(); }
  }

  it('creates a durable task on ensureJob', async () => {
    await withAdapter(async (adapter) => {
      const surface = await adapter.ensureJob('worker-1');
      expect(surface.handle.provider).toBe('openmuse');
      expect(surface.handle.taskId).toBeDefined();
    });
  });

  it('getStatus returns the current task status', async () => {
    await withAdapter(async (adapter, s) => {
      const surface = await adapter.ensureJob('worker-1');
      s.setTaskStatus(surface.handle.taskId, 'running');
      expect(await surface.getStatus()).toBe('running');
    });
  });

  it('getResult returns the result when succeeded, undefined otherwise', async () => {
    await withAdapter(async (adapter, s) => {
      const surface = await adapter.ensureJob('worker-1');
      expect(await surface.getResult()).toBeUndefined();
      s.setTaskStatus(surface.handle.taskId, 'succeeded', 'Analysis complete');
      expect(await surface.getResult()).toBe('Analysis complete');
    });
  });

  it('cancel requests task cancellation', async () => {
    await withAdapter(async (adapter) => {
      const surface = await adapter.ensureJob('worker-1');
      await surface.cancel();
      expect(await surface.getStatus()).toBe('cancelled');
    });
  });

  it('each worker gets its own task', async () => {
    await withAdapter(async (adapter) => {
      const s1 = await adapter.ensureJob('w1');
      const s2 = await adapter.ensureJob('w2');
      expect(s1.handle.taskId).not.toBe(s2.handle.taskId);
    });
  });
});

describe('PHASE 4.7 — CompositeRuntime (three-surface composition)', () => {
  let stub: StubOpenMuseServer;
  async function withComposite<T>(fn: (composite: CompositeRuntime, s: StubOpenMuseServer) => Promise<T>): Promise<T> {
    stub = new StubOpenMuseServer();
    await stub.start();
    try {
      const memory = new MemoryRuntime();
      const openMuse = new OpenMuseAdapter({ baseUrl: stub.baseUrl });
      const composite = new CompositeRuntime({ computer: memory, job: openMuse });
      return await fn(composite, stub);
    } finally { await stub.stop(); }
  }

  it('provides BOTH computer and job surfaces', async () => {
    await withComposite(async (composite) => {
      const genome: WorkerGenome = {
        identity: { id: 'hybrid-1', displayName: 'Hybrid' },
        role: 'Hybrid Worker', objective: 'test', model: 'cheap',
        skills: ['code-execution'],
        tools: ['openbot:shell-execution', 'openmuse:durable-delegation'],
        computer: { required: true, browser: false, shell: true, workspace: true },
        memory: 'none', budget: { maxUsd: 1, maxTier: 'cheap' }, autonomy: 'autonomous',
        operationalNeeds: [{ kind: 'shell-execution' }, { kind: 'durable-delegation' }],
      };
      const handle = await composite.ensureWorker(genome);
      const surfaces = composite.surfaces(handle);
      expect(surfaces.computer).toBeDefined();
      expect(surfaces.job).toBeDefined();
    });
  });

  it('provides ONLY job surface for non-computer worker', async () => {
    await withComposite(async (composite) => {
      const genome: WorkerGenome = {
        identity: { id: 'durable-only-1', displayName: 'Durable' },
        role: 'Durable Worker', objective: 'test', model: 'cheap',
        skills: [], tools: ['openmuse:durable-delegation'],
        computer: { required: false, browser: false, shell: false, workspace: false },
        memory: 'none', budget: { maxUsd: 1, maxTier: 'cheap' }, autonomy: 'autonomous',
        operationalNeeds: [{ kind: 'durable-delegation' }],
      };
      const handle = await composite.ensureWorker(genome);
      const surfaces = composite.surfaces(handle);
      expect(surfaces.computer).toBeUndefined();
      expect(surfaces.job).toBeDefined();
    });
  });

  it('WorkerGenome remains provider-neutral', () => {
    const genome: WorkerGenome = {
      identity: { id: 'neutral-1', displayName: 'Neutral' },
      role: 'Worker', objective: 'test', model: 'cheap',
      skills: [], tools: ['openmuse:durable-delegation'],
      computer: { required: false, browser: false, shell: false, workspace: false },
      memory: 'none', budget: { maxUsd: 1, maxTier: 'cheap' }, autonomy: 'autonomous',
      operationalNeeds: [{ kind: 'durable-delegation' }],
    };
    for (const need of genome.operationalNeeds ?? []) {
      expect(need.kind).not.toMatch(/openmuse|muse/i);
    }
  });

  it('no MuseWorker class — worker is a plain WorkerGenome', () => {
    const genome: WorkerGenome = {
      identity: { id: 'plain-1', displayName: 'Plain' },
      role: 'Plain Worker', objective: 'test', model: 'cheap',
      skills: [], tools: ['openmuse:durable-delegation'],
      computer: { required: false, browser: false, shell: false, workspace: false },
      memory: 'none', budget: { maxUsd: 1, maxTier: 'cheap' }, autonomy: 'autonomous',
      operationalNeeds: [{ kind: 'durable-delegation' }],
    };
    expect(genome.constructor).toBe(Object);
  });

  it('stopWorker releases job surface without error', async () => {
    await withComposite(async (composite) => {
      const genome: WorkerGenome = {
        identity: { id: 'stop-1', displayName: 'Stop' },
        role: 'Stop', objective: 'test', model: 'cheap',
        skills: [], tools: ['openmuse:durable-delegation'],
        computer: { required: false, browser: false, shell: false, workspace: false },
        memory: 'none', budget: { maxUsd: 1, maxTier: 'cheap' }, autonomy: 'autonomous',
        operationalNeeds: [{ kind: 'durable-delegation' }],
      };
      const handle = await composite.ensureWorker(genome);
      await composite.stopWorker(handle);
    });
  });
});

describe('PHASE 4.7 — Failure semantics', () => {
  it('OpenMuse adapter fails loudly when server is unreachable', async () => {
    const adapter = new OpenMuseAdapter({ baseUrl: 'http://127.0.0.1:1', timeoutMs: 500 });
    await expect(adapter.ensureJob('worker-1')).rejects.toThrow();
  });

  it('CompositeRuntime does NOT provide job surface when adapter fails', async () => {
    const memory = new MemoryRuntime();
    const badAdapter = new OpenMuseAdapter({ baseUrl: 'http://127.0.0.1:1', timeoutMs: 500 });
    const composite = new CompositeRuntime({ computer: memory, job: badAdapter });
    const genome: WorkerGenome = {
      identity: { id: 'failing-1', displayName: 'F' },
      role: 'F', objective: 'test', model: 'cheap',
      skills: [], tools: ['openmuse:durable-delegation'],
      computer: { required: false, browser: false, shell: false, workspace: false },
      memory: 'none', budget: { maxUsd: 1, maxTier: 'cheap' }, autonomy: 'autonomous',
      operationalNeeds: [{ kind: 'durable-delegation' }],
    };
    await expect(composite.ensureWorker(genome)).rejects.toThrow();
  });
});

describe('PHASE 4.7 — Completion semantics (job existence ≠ deliverable)', () => {
  let stub: StubOpenMuseServer;
  async function withAdapter<T>(fn: (adapter: OpenMuseAdapter, s: StubOpenMuseServer) => Promise<T>): Promise<T> {
    stub = new StubOpenMuseServer();
    await stub.start();
    try { return await fn(new OpenMuseAdapter({ baseUrl: stub.baseUrl }), stub); }
    finally { await stub.stop(); }
  }

  it('job existence alone does NOT satisfy completion (queued)', async () => {
    await withAdapter(async (adapter) => {
      const surface = await adapter.ensureJob('worker-1');
      expect(await surface.getStatus()).toBe('queued');
      expect(await surface.getResult()).toBeUndefined();
    });
  });

  it('running state does NOT satisfy completion', async () => {
    await withAdapter(async (adapter, s) => {
      const surface = await adapter.ensureJob('worker-1');
      s.setTaskStatus(surface.handle.taskId, 'running');
      expect(await surface.getStatus()).toBe('running');
      expect(await surface.getResult()).toBeUndefined();
    });
  });

  it('failed state does NOT satisfy completion', async () => {
    await withAdapter(async (adapter, s) => {
      const surface = await adapter.ensureJob('worker-1');
      s.setTaskStatus(surface.handle.taskId, 'failed');
      expect(await surface.getStatus()).toBe('failed');
      expect(await surface.getResult()).toBeUndefined();
    });
  });

  it('cancelled state does NOT satisfy completion', async () => {
    await withAdapter(async (adapter, s) => {
      const surface = await adapter.ensureJob('worker-1');
      s.setTaskStatus(surface.handle.taskId, 'cancelled');
      expect(await surface.getStatus()).toBe('cancelled');
      expect(await surface.getResult()).toBeUndefined();
    });
  });

  it('succeeded state WITH result CAN satisfy completion', async () => {
    await withAdapter(async (adapter, s) => {
      const surface = await adapter.ensureJob('worker-1');
      s.setTaskStatus(surface.handle.taskId, 'succeeded', 'Analysis: 2 transactions');
      expect(await surface.getStatus()).toBe('succeeded');
      expect(await surface.getResult()).toBe('Analysis: 2 transactions');
    });
  });

  it('succeeded state WITHOUT result does NOT satisfy completion', async () => {
    await withAdapter(async (adapter, s) => {
      const surface = await adapter.ensureJob('worker-1');
      s.setTaskStatus(surface.handle.taskId, 'succeeded');
      expect(await surface.getResult()).toBeUndefined();
    });
  });
});

describe('PHASE 4.7 — Three-pillar structural readiness', () => {
  it('one worker can request all three surfaces without a hybrid enum', () => {
    const stubWorkspace: WorkspaceSurface = {
      handle: { provider: 'stub', spaceId: 's', pageId: 'p', revision: 1 },
      async readPage() { return { content: '', revision: 1 }; },
      async appendContent() { return { revision: 2 }; },
      async updatePage() { return { revision: 2 }; },
    };
    const stubJob: JobSurface = {
      handle: { provider: 'stub', taskId: 't' },
      async getStatus() { return 'succeeded' as JobStatus; },
      async getResult() { return 'done'; },
      async cancel() { /* noop */ },
    };
    const genome: WorkerGenome = {
      identity: { id: 'three-pillar-1', displayName: 'Three Pillar' },
      role: 'Research Lead', objective: 'test', model: 'default',
      skills: ['code-execution', 'document-authoring'],
      tools: ['openbot:shell-execution', 'opendots:collaborative-workspace', 'openmuse:durable-delegation'],
      computer: { required: true, browser: true, shell: true, workspace: true },
      memory: 'shared-thread', budget: { maxUsd: 10, maxTier: 'default' }, autonomy: 'autonomous',
      operationalNeeds: [
        { kind: 'shell-execution' }, { kind: 'browser' }, { kind: 'workspace-files' },
        { kind: 'collaborative-workspace' }, { kind: 'durable-delegation' },
      ],
    };
    expect(genome.constructor).toBe(Object);
    const kinds = genome.operationalNeeds!.map((n) => n.kind);
    expect(kinds).not.toContain('hybrid');
    expect(kinds).toContain('durable-delegation');
    const surfaces: WorkerSurfaces = {
      computer: new MemoryComputer(),
      workspace: stubWorkspace,
      job: stubJob,
    };
    expect(surfaces.computer).toBeDefined();
    expect(surfaces.workspace).toBeDefined();
    expect(surfaces.job).toBeDefined();
  });
});
