import { describe, expect, it } from 'vitest';
import { z } from 'zod';

/**
 * TASK-004 — Protocol & Compatibility Probe.
 *
 * Proves that the AG-UI / MCP / A2A baselines are actually usable before Genesis
 * designs anything on top of them. Results are recorded in docs/protocol-probe.md
 * and data/dependency-baseline.json. No protocol code of our own is written here:
 * everything below exercises the OFFICIAL SDKs exactly as shipped.
 */

describe('MCP probe — official TypeScript SDK (in-process client/server)', () => {
  it(
    'connects a client to a server over InMemoryTransport, lists and calls a tool',
    { timeout: 15_000 },
    async () => {
      const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
      const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
      const { InMemoryTransport } = await import(
        '@modelcontextprotocol/sdk/inMemory.js'
      );

      const server = new McpServer(
        { name: 'genesis-probe-server', version: '0.0.1' },
        { capabilities: { tools: {} } },
      );

      server.registerTool(
        'echo',
        {
          title: 'Echo',
          description: 'Echoes a message back (probe tool).',
          inputSchema: { message: z.string() },
        },
        async ({ message }) => ({
          content: [{ type: 'text', text: `echo:${message}` }],
        }),
      );

      const client = new Client(
        { name: 'genesis-probe-client', version: '0.0.1' },
        { capabilities: {} },
      );

      const [serverTransport, clientTransport] =
        InMemoryTransport.createLinkedPair();
      await server.connect(serverTransport);
      await client.connect(clientTransport);

      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name)).toContain('echo');

      const result = await client.callTool({
        name: 'echo',
        arguments: { message: 'genesis' },
      });
      expect(result).toBeDefined();
      const content = (
        result as { content: Array<{ type: string; text?: string }> }
      ).content;
      expect(content[0]?.type).toBe('text');
      expect(content[0]?.text).toBe('echo:genesis');

      await client.close();
      await server.close();
    },
  );
});

describe('AG-UI probe — official core package (schema 1.0)', () => {
  it('exposes protocol version 1.0 and the full lifecycle event vocabulary', async () => {
    const agui = await import('@ag-ui/core');

    expect(agui.PROTOCOL_VERSION).toBe('1.0');

    const events: string[] = Object.values(agui.EventType);
    // Message lifecycle.
    expect(events).toContain('TEXT_MESSAGE_START');
    expect(events).toContain('TEXT_MESSAGE_END');
    // Tool-call lifecycle.
    expect(events).toContain('TOOL_CALL_START');
    expect(events).toContain('TOOL_CALL_RESULT');
    // State synchronization.
    expect(events).toContain('STATE_SNAPSHOT');
    expect(events).toContain('STATE_DELTA');
    // Run/step lifecycle.
    expect(events).toContain('RUN_STARTED');
    expect(events).toContain('RUN_FINISHED');
    expect(events).toContain('RUN_ERROR');
    expect(events).toContain('STEP_STARTED');
    expect(events).toContain('STEP_FINISHED');
    // Reasoning + subagent events exist upstream — Genesis must never duplicate them.
    expect(events).toContain('REASONING_START');
    expect(events).toContain('SUBAGENT_STARTED');
    expect(events).toContain('SUBAGENT_FINISHED');

    // 31 event types observed at baseline.
    expect(events.length).toBeGreaterThanOrEqual(31);
  });
});

describe('A2A probe — official SDK basics only (no Genesis integration)', () => {
  it('constructs an Agent Card and round-trips task state', async () => {
    const a2a = await import('@a2a-js/sdk');

    const cardJson = {
      name: 'genesis-probe-agent',
      description: 'Probe agent card — TASK-004 compatibility check.',
      url: 'http://localhost:9999/',
      version: '0.0.1',
      capabilities: {},
      skills: [{ id: 'probe-skill', name: 'Probe Skill' }],
    };

    // Agent Card basics via the official SDK helpers.
    const card = a2a.AgentCard.fromJSON(cardJson);
    expect(card.name).toBe('genesis-probe-agent');
    expect(card.version).toBe('0.0.1');
    expect(card.skills.length).toBe(1);

    // Canonical JSON form is produced by the SDK, not by us.
    const canonical = a2a.canonicalizeAgentCard(card);
    expect(typeof canonical).toBe('string');
    expect(canonical.length).toBeGreaterThan(0);
    expect(canonical).toContain('genesis-probe-agent');

    // Task state enum basics.
    expect(a2a.taskStateFromJSON('TASK_STATE_SUBMITTED')).toBe(1);
    expect(a2a.taskStateToJSON(1)).toBe('TASK_STATE_SUBMITTED');
  });
});

describe('Node/TypeScript baseline probe', () => {
  it('runs on the pinned Node major with ESM + TypeScript strict toolchain', async () => {
    const [major] = process.version.replace(/^v/, '').split('.');
    expect(Number(major)).toBeGreaterThanOrEqual(24);

    // Dynamic import of our own compiled-contract-free entrypoint proves the
    // ESM + NodeNext toolchain round-trips inside the test runtime.
    const entry = await import('../src/index.js');
    expect(entry.GENESIS_VERSION).toBe('0.1.0');
  });
});
