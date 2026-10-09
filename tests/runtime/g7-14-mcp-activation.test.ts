/**
 * G7-14D — Composite MCP Provider + Per-mission Activation tests.
 */
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  CompositeMcpProvider,
  LazyCompositeMcpProvider,
  buildMcpProvidersForMission,
} from '../../src/plugins/mcp-activation.js';
import type { McpServerConfig } from '../../src/plugins/mcp-config.js';

describe('G7-14D — Composite MCP Provider', () => {
  it('routes tool invocations to the registered provider', async () => {
    const composite = new CompositeMcpProvider();
    composite.registerProvider(['sum'], {
      name: 'mock', listTools: async () => ['sum'],
      invokeTool: async (n: string) => ({ ok: true, text: `result for ${n}`, raw: undefined }),
      close: async () => {},
    });
    const r = await composite.invokeTool('sum');
    expect(r.ok).toBe(true);
    expect(r.text).toContain('result');
    await composite.close();
  });

  it('returns honest failure for unavailable tools', async () => {
    const c = new CompositeMcpProvider();
    c.registerUnavailable('broken', 'server crashed');
    const r = await c.invokeTool('broken');
    expect(r.ok).toBe(false);
    expect(r.text).toContain('unavailable');
    expect(r.text).toContain('server crashed');
    await c.close();
  });

  it('returns honest failure for unknown tools', async () => {
    const c = new CompositeMcpProvider();
    const r = await c.invokeTool('nonexistent');
    expect(r.ok).toBe(false);
    expect(r.text).toContain('not found');
    await c.close();
  });

  it('close() calls close() on all child providers', async () => {
    let c1 = 0, c2 = 0;
    const comp = new CompositeMcpProvider();
    comp.registerProvider(['a'], { name: 'm1', listTools: async () => ['a'], invokeTool: async () => ({ ok: true, text: '', raw: undefined }), close: async () => { c1++; } });
    comp.registerProvider(['b'], { name: 'm2', listTools: async () => ['b'], invokeTool: async () => ({ ok: true, text: '', raw: undefined }), close: async () => { c2++; } });
    await comp.close();
    expect(c1).toBe(1);
    expect(c2).toBe(1);
  });
});

describe('G7-14D — LazyCompositeMcpProvider', () => {
  it('listTools returns all configured tools without connecting', async () => {
    const config: McpServerConfig[] = [
      { name: 's1', transport: { kind: 'stdio', command: 'node', args: [] }, grants: ['mcp:analyze'], satisfies: [] },
      { name: 's2', transport: { kind: 'http', url: 'http://localhost' }, grants: ['mcp:search'], satisfies: [] },
    ];
    const lazy = new LazyCompositeMcpProvider(config);
    const tools = await lazy.listTools();
    expect(tools).toContain('analyze');
    expect(tools).toContain('search');
    await lazy.close();
  });

  it('returns honest failure for tools not in any configured server', async () => {
    const lazy = new LazyCompositeMcpProvider([]);
    const r = await lazy.invokeTool('nonexistent');
    expect(r.ok).toBe(false);
    expect(r.text).toContain('not found');
    await lazy.close();
  });

  it('returns honest failure for tools from unreachable servers', async () => {
    const config: McpServerConfig[] = [
      { name: 'unreachable', transport: { kind: 'http', url: 'http://127.0.0.1:1' }, grants: ['mcp:broken'], satisfies: [] },
    ];
    const lazy = new LazyCompositeMcpProvider(config);
    const r = await lazy.invokeTool('broken');
    expect(r.ok).toBe(false);
    expect(r.text).toContain('unavailable');
    await lazy.close();
  });
});

describe('G7-14D — buildMcpProvidersForMission', () => {
  it('returns null when genome has no mcp: grants', async () => {
    const result = await buildMcpProvidersForMission([], ['openbot:shell-execution']);
    expect(result).toBeNull();
  });

  it('positive: real MCP tool invocation via composite provider', async () => {
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
    const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');
    const server = new McpServer(
      { name: 'g7-14d-test', version: '0.0.1' },
      { capabilities: { tools: {} } },
    );
    server.registerTool(
      'analyze',
      { title: 'Analyze', description: 'Compute statistics', inputSchema: { values: z.array(z.number()) } },
      async ({ values }) => {
        const arr = values as number[];
        const sum = arr.reduce((a, b) => a + b, 0);
        return { content: [{ type: 'text', text: JSON.stringify({ sum, count: arr.length, mean: sum / arr.length }) }] };
      },
    );
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    const { McpCapabilityProviderImpl } = await import('../../src/runtime/mcp/capability-provider.js');
    const provider = new McpCapabilityProviderImpl(clientTransport);
    await provider.connect();

    const composite = new CompositeMcpProvider();
    composite.registerProvider(['analyze'], provider);

    const r = await composite.invokeTool('analyze', { values: [1, 2, 3, 4, 5] });
    expect(r.ok).toBe(true);
    const parsed = JSON.parse(r.text);
    expect(parsed.sum).toBe(15);
    expect(parsed.count).toBe(5);

    await composite.close();
    try { await server.close(); } catch { /* ignore */ }
  });

  it('negative: tool not in genome grants → honest failure', async () => {
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
    const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');
    const server = new McpServer({ name: 'neg-test', version: '0.1' }, { capabilities: { tools: {} } });
    server.registerTool('sum', { title: 'S', description: 'D', inputSchema: {} }, async () => ({ content: [{ type: 'text', text: '42' }] }));
    server.registerTool('search', { title: 'S', description: 'D', inputSchema: {} }, async () => ({ content: [{ type: 'text', text: 'results' }] }));
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await server.connect(st);

    const { McpCapabilityProviderImpl } = await import('../../src/runtime/mcp/capability-provider.js');
    const p = new McpCapabilityProviderImpl(ct);
    await p.connect();

    const comp = new CompositeMcpProvider();
    comp.registerProvider(['sum'], p);

    expect((await comp.invokeTool('sum')).ok).toBe(true);
    const denied = await comp.invokeTool('search');
    expect(denied.ok).toBe(false);
    expect(denied.text).toContain('not found');

    await comp.close();
    try { await server.close(); } catch { /* ignore */ }
  });
});
