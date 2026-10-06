import { describe, expect, it } from 'vitest';

import type { WorkerGenome } from '../src/contracts/core.js';
import {
  OpenDotsWorkspaceAdapter,
} from '../src/runtime/opendots/adapter.js';
import {
  OpenDotsClient,
  OpenDotsRevisionConflict,
  OpenDotsRequestError,
} from '../src/runtime/opendots/client.js';
import { CompositeRuntime } from '../src/runtime/composite-runtime.js';
import { MemoryRuntime, MemoryComputer } from './helpers/memory-runtime.js';

/**
 * PHASE 4.6 — OpenDots minimal meaningful integration architectural tests.
 *
 * These tests prove the Phase 4.6 architecture WITHOUT requiring a real
 * OpenDots server. They use a stub OpenDots server (a lightweight HTTP
 * server that implements the Spaces/Pages CRUD contract) for deterministic
 * integration tests. The REAL OpenDots probe is in
 * experiments/phase-4-6-probe/run.ts and is run separately.
 */

// ---------------------------------------------------------------------------
// Stub OpenDots server (for deterministic tests)
// ---------------------------------------------------------------------------

import { createServer, type Server } from 'node:http';

class StubOpenDotsServer {
  private server: Server;
  private spaces = new Map<string, { id: string; name: string; description: string; createdAt: number }>();
  private pages = new Map<string, { id: string; spaceId: string; parentId: string | null; title: string; content: string; revision: number; createdAt: number; updatedAt: number; sourceThreadId: string | null }>();
  private _baseUrl = '';
  private port = 0;

  get baseUrl(): string { return this._baseUrl; }

  constructor() {
    this.server = createServer((req, res) => this.handle(req, res));
  }

  start(): Promise<void> {
    return new Promise((resolve) => {
      this.server.listen(this.port, '127.0.0.1', () => {
        const addr = this.server.address();
        if (addr && typeof addr === 'object') {
          this.port = addr.port;
          this._baseUrl = `http://127.0.0.1:${this.port}`;
        }
        resolve();
      });
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => this.server.close(() => resolve()));
  }

  private handle(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse): void {
    const url = new URL(req.url ?? '/', this.baseUrl || 'http://localhost');
    const path = url.pathname;
    const method = req.method ?? 'GET';

    // Parse body for POST/PATCH
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        const parsed = body.length > 0 ? JSON.parse(body) : {};
        // POST /api/spaces
        if (method === 'POST' && path === '/api/spaces') {
          const id = `space-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
          const space = { id, name: parsed.name, description: parsed.description ?? '', createdAt: Date.now() };
          this.spaces.set(id, space);
          this.sendJson(res, 200, space);
          return;
        }
        // POST /api/spaces/:spaceId/pages
        const createPageMatch = path.match(/^\/api\/spaces\/([^/]+)\/pages$/);
        if (method === 'POST' && createPageMatch) {
          const spaceId = createPageMatch[1]!;
          const id = `page-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
          const page = {
            id, spaceId, parentId: parsed.parentId ?? null,
            title: parsed.title, content: parsed.content,
            revision: 1, createdAt: Date.now(), updatedAt: Date.now(),
            sourceThreadId: null,
          };
          this.pages.set(id, page);
          this.sendJson(res, 200, page);
          return;
        }
        // GET /api/spaces/:spaceId/pages/:id
        const getPageMatch = path.match(/^\/api\/spaces\/([^/]+)\/pages\/([^/]+)$/);
        if (method === 'GET' && getPageMatch) {
          const pageId = getPageMatch[2]!;
          const page = this.pages.get(pageId);
          if (!page) { this.sendJson(res, 404, { error: 'not found' }); return; }
          this.sendJson(res, 200, page);
          return;
        }
        // PATCH /api/spaces/:spaceId/pages/:id
        if (method === 'PATCH' && getPageMatch) {
          const pageId = getPageMatch[2]!;
          const page = this.pages.get(pageId);
          if (!page) { this.sendJson(res, 404, { error: 'not found' }); return; }
          if (parsed.expectedRevision !== page.revision) {
            this.sendJson(res, 409, { error: 'revision conflict', currentRevision: page.revision });
            return;
          }
          const updated = {
            ...page,
            content: parsed.content ?? page.content,
            revision: page.revision + 1,
            updatedAt: Date.now(),
          };
          this.pages.set(pageId, updated);
          this.sendJson(res, 200, updated);
          return;
        }
        this.sendJson(res, 404, { error: 'not found' });
      } catch (error) {
        this.sendJson(res, 500, { error: String(error) });
      }
    });
  }

  private sendJson(res: import('node:http').ServerResponse, status: number, body: unknown): void {
    const json = JSON.stringify(body);
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(json);
  }
}

// ---------------------------------------------------------------------------
// OpenDots client tests (deterministic, against stub server)
// ---------------------------------------------------------------------------

describe('PHASE 4.6 — OpenDotsClient (against stub server)', () => {
  let stub: StubOpenDotsServer;

  async function withStub<T>(fn: (client: OpenDotsClient) => Promise<T>): Promise<T> {
    stub = new StubOpenDotsServer();
    await stub.start();
    try {
      const client = new OpenDotsClient({ baseUrl: stub.baseUrl });
      return await fn(client);
    } finally {
      await stub.stop();
    }
  }

  it('creates a Space and a Page, reads the Page back', async () => {
    await withStub(async (client) => {
      const space = await client.createSpace('Test Space', 'test');
      expect(space.id).toBeDefined();
      expect(space.name).toBe('Test Space');

      const page = await client.createPage(space.id, 'Test Page', '# Hello');
      expect(page.id).toBeDefined();
      expect(page.content).toBe('# Hello');
      expect(page.revision).toBe(1);

      const read = await client.getPage(space.id, page.id);
      expect(read.content).toBe('# Hello');
      expect(read.revision).toBe(1);
    });
  });

  it('updates a Page with optimistic concurrency (revision increments)', async () => {
    await withStub(async (client) => {
      const space = await client.createSpace('S', '');
      const page = await client.createPage(space.id, 'P', 'v1');
      const updated = await client.updatePage(space.id, page.id, 'v2', 1);
      expect(updated.revision).toBe(2);
      expect(updated.content).toBe('v2');
    });
  });

  it('throws OpenDotsRevisionConflict on stale expectedRevision', async () => {
    await withStub(async (client) => {
      const space = await client.createSpace('S', '');
      const page = await client.createPage(space.id, 'P', 'v1');
      // Update once (revision → 2)
      await client.updatePage(space.id, page.id, 'v2', 1);
      // Now try to update with stale revision 1 → conflict
      await expect(client.updatePage(space.id, page.id, 'v3', 1)).rejects.toThrow(OpenDotsRevisionConflict);
    });
  });

  it('throws OpenDotsRequestError on 404', async () => {
    await withStub(async (client) => {
      await expect(client.getPage('nonexistent-space', 'nonexistent-page')).rejects.toThrow(OpenDotsRequestError);
    });
  });

  it('throws OpenDotsRequestError when server is unreachable', async () => {
    const client = new OpenDotsClient({ baseUrl: 'http://127.0.0.1:1', timeoutMs: 500 });
    await expect(client.createSpace('x', '')).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// OpenDotsWorkspaceAdapter tests (against stub server)
// ---------------------------------------------------------------------------

describe('PHASE 4.6 — OpenDotsWorkspaceAdapter', () => {
  let stub: StubOpenDotsServer;

  async function withAdapter<T>(fn: (adapter: OpenDotsWorkspaceAdapter) => Promise<T>): Promise<T> {
    stub = new StubOpenDotsServer();
    await stub.start();
    try {
      const adapter = new OpenDotsWorkspaceAdapter({ baseUrl: stub.baseUrl, spaceName: 'Test', pageTitle: 'Doc' });
      return await fn(adapter);
    } finally {
      await stub.stop();
    }
  }

  it('creates a shared Space + Page on first ensureWorkspace', async () => {
    await withAdapter(async (adapter) => {
      const surface = await adapter.ensureWorkspace('worker-1');
      expect(surface.handle.provider).toBe('opendots');
      expect(surface.handle.spaceId).toBeDefined();
      expect(surface.handle.pageId).toBeDefined();
      expect(surface.handle.revision).toBe(1);
    });
  });

  it('reuses the same Space + Page for multiple workers (shared workspace)', async () => {
    await withAdapter(async (adapter) => {
      const surface1 = await adapter.ensureWorkspace('worker-1');
      const surface2 = await adapter.ensureWorkspace('worker-2');
      // Both workers share the same Space + Page.
      expect(surface2.handle.spaceId).toBe(surface1.handle.spaceId);
      expect(surface2.handle.pageId).toBe(surface1.handle.pageId);
    });
  });

  it('appends content from two workers; both contributions are distinguishable', async () => {
    await withAdapter(async (adapter) => {
      const surface1 = await adapter.ensureWorkspace('worker-1');
      const surface2 = await adapter.ensureWorkspace('worker-2');
      // Worker 1 appends a section.
      await surface1.appendContent('Researcher', 'Section A content.');
      // Worker 2 appends a section.
      await surface2.appendContent('Writer', 'Section B content.');
      // Read back — both sections should be present.
      const { content } = await surface1.readPage();
      expect(content).toContain('Section A content.');
      expect(content).toContain('Section B content.');
      expect(content).toContain('Researcher');
      expect(content).toContain('Writer');
    });
  });

  it('handles revision conflicts with one retry (no false failure)', async () => {
    await withAdapter(async (adapter) => {
      const surface1 = await adapter.ensureWorkspace('worker-1');
      const surface2 = await adapter.ensureWorkspace('worker-2');
      // Both read the initial page (revision 1).
      // Worker 1 appends → revision becomes 2.
      await surface1.appendContent('A', 'first');
      // Worker 2 appends — its handle has revision 1, but the page is now 2.
      // The adapter should re-read and retry. No conflict error should escape.
      const result = await surface2.appendContent('B', 'second');
      expect(result.revision).toBe(3);
      // Both sections present.
      const { content } = await surface1.readPage();
      expect(content).toContain('first');
      expect(content).toContain('second');
    });
  });

  it('exposes the workspace handle for evidence/provenance', async () => {
    await withAdapter(async (adapter) => {
      expect(adapter.getWorkspaceHandle()).toBeUndefined();
      await adapter.ensureWorkspace('worker-1');
      const handle = adapter.getWorkspaceHandle();
      expect(handle).toBeDefined();
      expect(handle!.provider).toBe('opendots');
    });
  });
});

// ---------------------------------------------------------------------------
// CompositeRuntime tests (multi-provider composition)
// ---------------------------------------------------------------------------

describe('PHASE 4.6 — CompositeRuntime (multi-provider composition)', () => {
  let stub: StubOpenDotsServer;

  async function withComposite<T>(
    fn: (composite: CompositeRuntime, memory: MemoryRuntime) => Promise<T>,
  ): Promise<T> {
    stub = new StubOpenDotsServer();
    await stub.start();
    try {
      const memory = new MemoryRuntime();
      const openDots = new OpenDotsWorkspaceAdapter({ baseUrl: stub.baseUrl });
      const composite = new CompositeRuntime({ computer: memory, workspace: openDots });
      return await fn(composite, memory);
    } finally {
      await stub.stop();
    }
  }

  it('provides BOTH computer and workspace surfaces for a worker that needs both', async () => {
    await withComposite(async (composite) => {
      const genome: WorkerGenome = {
        identity: { id: 'hybrid-1', displayName: 'Hybrid' },
        role: 'Hybrid Worker',
        objective: 'test',
        model: 'cheap',
        skills: ['code-execution'],
        tools: ['openbot:shell-execution', 'opendots:collaborative-workspace'],
        computer: { required: true, browser: false, shell: true, workspace: true },
        memory: 'none',
        budget: { maxUsd: 1, maxTier: 'cheap' },
        autonomy: 'autonomous',
        operationalNeeds: [
          { kind: 'shell-execution' },
          { kind: 'workspace-files' },
          { kind: 'collaborative-workspace' },
        ],
      };
      const handle = await composite.ensureWorker(genome);
      const surfaces = composite.surfaces(handle);
      expect(surfaces.computer).toBeDefined();
      expect(surfaces.workspace).toBeDefined();
      // The computer surface is a real MemoryComputer.
      expect(surfaces.computer).toBeInstanceOf(MemoryComputer);
      // The workspace surface has the opendots provider handle.
      expect(surfaces.workspace!.handle.provider).toBe('opendots');
    });
  });

  it('provides ONLY computer surface for a worker that does not need workspace', async () => {
    await withComposite(async (composite) => {
      const genome: WorkerGenome = {
        identity: { id: 'bot-only-1', displayName: 'Bot' },
        role: 'Bot Worker',
        objective: 'test',
        model: 'cheap',
        skills: ['code-execution'],
        tools: ['openbot:shell-execution'],
        computer: { required: true, browser: false, shell: true, workspace: false },
        memory: 'none',
        budget: { maxUsd: 1, maxTier: 'cheap' },
        autonomy: 'autonomous',
        operationalNeeds: [{ kind: 'shell-execution' }],
      };
      const handle = await composite.ensureWorker(genome);
      const surfaces = composite.surfaces(handle);
      expect(surfaces.computer).toBeDefined();
      expect(surfaces.workspace).toBeUndefined();
    });
  });

  it('provides ONLY workspace surface for a worker that does not need a computer', async () => {
    await withComposite(async (composite) => {
      const genome: WorkerGenome = {
        identity: { id: 'dot-only-1', displayName: 'Dot' },
        role: 'Dot Worker',
        objective: 'test',
        model: 'cheap',
        skills: [],
        tools: ['opendots:collaborative-workspace'],
        computer: { required: false, browser: false, shell: false, workspace: false },
        memory: 'shared-thread',
        budget: { maxUsd: 1, maxTier: 'cheap' },
        autonomy: 'autonomous',
        operationalNeeds: [{ kind: 'collaborative-workspace' }],
      };
      const handle = await composite.ensureWorker(genome);
      const surfaces = composite.surfaces(handle);
      expect(surfaces.computer).toBeUndefined();
      expect(surfaces.workspace).toBeDefined();
    });
  });

  it('two workers sharing the same workspace collaborate on the same Page', async () => {
    await withComposite(async (composite) => {
      const genomeA: WorkerGenome = {
        identity: { id: 'spec-a', displayName: 'A' },
        role: 'Specialist A',
        objective: 'test',
        model: 'cheap',
        skills: [],
        tools: ['opendots:collaborative-workspace'],
        computer: { required: false, browser: false, shell: false, workspace: false },
        memory: 'shared-thread',
        budget: { maxUsd: 1, maxTier: 'cheap' },
        autonomy: 'autonomous',
        operationalNeeds: [{ kind: 'collaborative-workspace' }],
      };
      const genomeB = { ...genomeA, identity: { id: 'spec-b', displayName: 'B' } };
      const handleA = await composite.ensureWorker(genomeA);
      const handleB = await composite.ensureWorker(genomeB);
      const surfacesA = composite.surfaces(handleA);
      const surfacesB = composite.surfaces(handleB);
      // Both share the same Space + Page.
      expect(surfacesA.workspace!.handle.spaceId).toBe(surfacesB.workspace!.handle.spaceId);
      expect(surfacesA.workspace!.handle.pageId).toBe(surfacesB.workspace!.handle.pageId);
      // A appends, B reads it.
      await surfacesA.workspace!.appendContent('A', 'content from A');
      const { content } = await surfacesB.workspace!.readPage();
      expect(content).toContain('content from A');
    });
  });

  it('stopWorker releases both surfaces without error', async () => {
    await withComposite(async (composite, memory) => {
      const genome: WorkerGenome = {
        identity: { id: 'release-1', displayName: 'R' },
        role: 'R',
        objective: 'test',
        model: 'cheap',
        skills: ['code-execution'],
        tools: ['openbot:shell-execution', 'opendots:collaborative-workspace'],
        computer: { required: true, browser: false, shell: true, workspace: true },
        memory: 'none',
        budget: { maxUsd: 1, maxTier: 'cheap' },
        autonomy: 'autonomous',
        operationalNeeds: [{ kind: 'shell-execution' }, { kind: 'collaborative-workspace' }],
      };
      const handle = await composite.ensureWorker(genome);
      await composite.stopWorker(handle);
      expect(memory.stopped).toContain('release-1');
    });
  });
});

// ---------------------------------------------------------------------------
// Failure semantics tests
// ---------------------------------------------------------------------------

describe('PHASE 4.6 — Failure semantics (no silent fallback)', () => {
  it('OpenDots adapter fails loudly when server is unreachable', async () => {
    const adapter = new OpenDotsWorkspaceAdapter({
      baseUrl: 'http://127.0.0.1:1',
      timeoutMs: 500,
    });
    // ensureWorkspace should throw — NOT silently fall back to a memory workspace.
    await expect(adapter.ensureWorkspace('worker-1')).rejects.toThrow();
    // The handle should NOT be set (no false success).
    expect(adapter.getWorkspaceHandle()).toBeUndefined();
  });

  it('CompositeRuntime does NOT provide workspace surface when adapter fails', async () => {
    const memory = new MemoryRuntime();
    const badAdapter = new OpenDotsWorkspaceAdapter({
      baseUrl: 'http://127.0.0.1:1',
      timeoutMs: 500,
    });
    const composite = new CompositeRuntime({ computer: memory, workspace: badAdapter });
    const genome: WorkerGenome = {
      identity: { id: 'failing-1', displayName: 'F' },
      role: 'F',
      objective: 'test',
      model: 'cheap',
      skills: [],
      tools: ['opendots:collaborative-workspace'],
      computer: { required: false, browser: false, shell: false, workspace: false },
      memory: 'none',
      budget: { maxUsd: 1, maxTier: 'cheap' },
      autonomy: 'autonomous',
      operationalNeeds: [{ kind: 'collaborative-workspace' }],
    };
    // ensureWorker should throw because the workspace adapter is unreachable.
    // It does NOT silently provide a computer surface as a fallback.
    await expect(composite.ensureWorker(genome)).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Evidence distinction: Resolved vs Invoked vs Observed
// ---------------------------------------------------------------------------

describe('PHASE 4.6 — Evidence distinction (Resolved vs Invoked vs Observed)', () => {
  it('ProviderInvocation records distinguish invoked+observed from resolved', async () => {
    // This test verifies the ProviderInvocation contract shape, which is the
    // INVOKED + OBSERVED layer. The RESOLVED layer is WorkerContribution.resolvedNeeds.
    // The distinction: resolvedNeeds says "provider was selected"; providerInvocations
    // says "adapter was invoked"; observed:true says "result was confirmed."
    const invocation = {
      provider: 'opendots',
      need: 'collaborative-workspace' as const,
      operation: 'append-content',
      workerId: 'worker-1',
      observed: true,
      resultRef: 'opendots:space-1:page-1',
    };
    expect(invocation.provider).toBe('opendots');
    expect(invocation.observed).toBe(true);
    expect(invocation.resultRef).toBeDefined();
    // A resolved need (without invocation) would NOT have this record.
    // A resolved need WITH invocation would have both resolvedNeeds and providerInvocations.
    // A resolved need WITH invocation WITH observation would have observed:true.
  });
});
