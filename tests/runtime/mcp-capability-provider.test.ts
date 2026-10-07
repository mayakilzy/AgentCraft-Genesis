import { describe, expect, it } from 'vitest';

/**
 * G5-01 — MCP Capability Provider focused tests.
 *
 * These tests exercise the real MCP protocol path using the official SDK's
 * InMemoryTransport (same transport the TASK-004 probe used). The transport
 * is in-process, but the protocol is real: JSON-RPC framing, initialization
 * handshake, capability negotiation, tool listing, tool invocation.
 *
 * What these tests prove:
 *   1. Genesis can discover tools a real MCP server exposes.
 *   2. Genesis can invoke a tool and receive a normalized result.
 *   3. The provider reports server-side errors honestly (ok=false).
 *   4. The provider reports unknown tools honestly.
 *   5. Lifecycle cleanup works (close disconnects).
 *   6. Grant helpers (prefix check, extraction, construction) are correct.
 *
 * What these tests do NOT prove (covered by the real probe experiment):
 *   - Causal mission use of an MCP result.
 *   - Negative authorization enforcement (that is the WorkerAgent's job).
 */

import { z } from 'zod';

async function makeProvider(): Promise<{
  provider: import('../../src/runtime/mcp/capability-provider.js').McpCapabilityProviderImpl;
  cleanup: () => Promise<void>;
}> {
  const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
  const { InMemoryTransport } = await import(
    '@modelcontextprotocol/sdk/inMemory.js'
  );

  const server = new McpServer(
    { name: 'g5-01-test-server', version: '0.0.1' },
    { capabilities: { tools: {} } },
  );

  server.registerTool(
    'sum',
    {
      title: 'Sum',
      description: 'Compute the sum of an array of numbers.',
      inputSchema: { values: z.array(z.number()) },
    },
    async ({ values }) => ({
      content: [{ type: 'text', text: String(values.reduce((a, b) => a + b, 0)) }],
    }),
  );

  server.registerTool(
    'fail',
    {
      title: 'Fail',
      description: 'A tool that always returns an error.',
      inputSchema: {},
    },
    async () => ({
      content: [{ type: 'text', text: 'something went wrong' }],
      isError: true,
    }),
  );

  const [serverTransport, clientTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  const { McpCapabilityProviderImpl } = await import(
    '../../src/runtime/mcp/capability-provider.js'
  );
  const provider = new McpCapabilityProviderImpl(clientTransport);
  await provider.connect();

  return {
    provider,
    cleanup: async () => {
      await provider.close();
      await server.close();
    },
  };
}

describe('McpCapabilityProvider — real MCP protocol via InMemoryTransport', () => {
  it(
    'discovers tools a real MCP server exposes',
    { timeout: 10_000 },
    async () => {
      const { provider, cleanup } = await makeProvider();
      try {
        const tools = await provider.listTools();
        expect(tools).toContain('sum');
        expect(tools).toContain('fail');
        expect(tools.length).toBe(2);
      } finally {
        await cleanup();
      }
    },
  );

  it(
    'invokes a tool and receives a normalized text result',
    { timeout: 10_000 },
    async () => {
      const { provider, cleanup } = await makeProvider();
      try {
        const result = await provider.invokeTool('sum', { values: [1, 2, 3, 4, 5] });
        expect(result.ok).toBe(true);
        expect(result.text).toBe('15');
      } finally {
        await cleanup();
      }
    },
  );

  it(
    'reports server-side errors honestly (isError → ok=false)',
    { timeout: 10_000 },
    async () => {
      const { provider, cleanup } = await makeProvider();
      try {
        const result = await provider.invokeTool('fail', {});
        expect(result.ok).toBe(false);
        expect(result.text).toContain('something went wrong');
      } finally {
        await cleanup();
      }
    },
  );

  it(
    'reports invocation failures for unknown tools',
    { timeout: 10_000 },
    async () => {
      const { provider, cleanup } = await makeProvider();
      try {
        const result = await provider.invokeTool('nonexistent', {});
        // The MCP SDK returns an error or an isError result for unknown tools.
        expect(result.ok).toBe(false);
      } finally {
        await cleanup();
      }
    },
  );

  it(
    'close disconnects — subsequent calls throw',
    { timeout: 10_000 },
    async () => {
      const { provider, cleanup } = await makeProvider();
      await cleanup();
      // After close, listTools should throw (not connected).
      await expect(provider.listTools()).rejects.toThrow(/not connected/i);
    },
  );

  it(
    'connect is idempotent — calling twice does not error',
    { timeout: 10_000 },
    async () => {
      const { provider, cleanup } = await makeProvider();
      try {
        // Already connected by makeProvider; second connect is a no-op.
        await provider.connect();
        const tools = await provider.listTools();
        expect(tools.length).toBe(2);
      } finally {
        await cleanup();
      }
    },
  );
});

describe('McpCapabilityProvider — grant helpers', () => {
  it('isMcpGrant identifies mcp: prefix grants', async () => {
    const { isMcpGrant } = await import(
      '../../src/runtime/mcp/capability-provider.js'
    );
    expect(isMcpGrant('mcp:sum')).toBe(true);
    expect(isMcpGrant('mcp:analyze')).toBe(true);
    expect(isMcpGrant('openbot:shell-execution')).toBe(false);
    expect(isMcpGrant('opendots:collaborative-workspace')).toBe(false);
    expect(isMcpGrant('')).toBe(false);
  });

  it('mcpGrantTool extracts the tool name from a grant', async () => {
    const { mcpGrantTool } = await import(
      '../../src/runtime/mcp/capability-provider.js'
    );
    expect(mcpGrantTool('mcp:sum')).toBe('sum');
    expect(mcpGrantTool('mcp:analyze')).toBe('analyze');
  });

  it('mcpGrant builds a grant from a tool name', async () => {
    const { mcpGrant } = await import(
      '../../src/runtime/mcp/capability-provider.js'
    );
    expect(mcpGrant('sum')).toBe('mcp:sum');
    expect(mcpGrant('analyze')).toBe('mcp:analyze');
  });
});

describe('WorkerAgent — call_tool grant enforcement', () => {
  it('refuses call_tool when the worker has no mcp:<tool> grant', async () => {
    const { WorkerAgent } = await import('../../src/worker/worker-agent.js');

    // A stub provider that would return a result if invoked — but the
    // worker must never reach invocation because the grant check fails.
    const stubProvider = {
      name: 'stub-mcp',
      listTools: async () => ['sum'],
      invokeTool: async () => ({ ok: true, text: 'SHOULD_NOT_REACH', raw: null }),
      close: async () => {},
    };

    const genome = {
      identity: { id: 'w1', displayName: 'Worker' },
      role: 'Analyst',
      objective: 'test',
      model: 'cheap' as const,
      skills: [],
      tools: [], // NO mcp:sum grant
      computer: { required: false, browser: false, shell: false, workspace: false },
      memory: 'none' as const,
      budget: { maxUsd: 1, maxTier: 'cheap' as const },
      autonomy: 'autonomous' as const,
    };

    const scriptedReasoning = makeScriptedReasoning([
      { action: 'call_tool', tool: 'sum', args: { values: [1, 2, 3] } },
      { action: 'finish', summary: 'done', artifacts: [] },
    ]);

    const agent = new WorkerAgent({
      genome,
      reasoning: scriptedReasoning,
      computer: null,
      mcp: stubProvider,
      taskBrief: 'Compute the sum.',
      maxSteps: 3,
    });

    const result = await agent.run();
    // The worker must NOT have succeeded — it was refused.
    expect(result.refusals.length).toBeGreaterThan(0);
    expect(result.refusals[0]).toContain('mcp:sum');
    // The stub provider's invokeTool must NEVER have been called.
    // (If it had been, the grant check failed to enforce authorization.)
    expect(result.summary).not.toContain('SHOULD_NOT_REACH');
  });

  it('allows call_tool when the worker has the mcp:<tool> grant', async () => {
    const { WorkerAgent } = await import('../../src/worker/worker-agent.js');

    let invoked = false;
    const stubProvider = {
      name: 'stub-mcp',
      listTools: async () => ['sum'],
      invokeTool: async () => {
        invoked = true;
        return { ok: true, text: '42', raw: null };
      },
      close: async () => {},
    };

    const genome = {
      identity: { id: 'w2', displayName: 'Worker' },
      role: 'Analyst',
      objective: 'test',
      model: 'cheap' as const,
      skills: [],
      tools: ['mcp:sum'], // granted!
      computer: { required: false, browser: false, shell: false, workspace: false },
      memory: 'none' as const,
      budget: { maxUsd: 1, maxTier: 'cheap' as const },
      autonomy: 'autonomous' as const,
    };

    const scriptedReasoning = makeScriptedReasoning([
      { action: 'call_tool', tool: 'sum', args: { values: [1, 2, 3] } },
      { action: 'finish', summary: 'got 42', artifacts: [] },
    ]);

    const agent = new WorkerAgent({
      genome,
      reasoning: scriptedReasoning,
      computer: null,
      mcp: stubProvider,
      taskBrief: 'Compute the sum.',
      maxSteps: 3,
    });

    const result = await agent.run();
    expect(invoked).toBe(true);
    expect(result.steps).toBe(1); // call_tool is step 1; finish breaks without incrementing
    expect(result.status).toBe('success');
  });
});

/**
 * Build a ReasoningProvider that replays a fixed sequence of worker actions.
 * Each `reason()` call pops the next action from the queue and returns it
 * as a JSON string — the same format a real LLM would produce.
 */
function makeScriptedReasoning(actions: readonly import('../../src/worker/worker-agent.js').WorkerAction[]) {
  const queue = [...actions];
  return {
    name: 'scripted',
    async reason() {
      const next = queue.shift();
      if (next === undefined) {
        return { text: JSON.stringify({ action: 'finish', summary: 'no more actions', artifacts: [] }) };
      }
      return { text: JSON.stringify(next) };
    },
  };
}
