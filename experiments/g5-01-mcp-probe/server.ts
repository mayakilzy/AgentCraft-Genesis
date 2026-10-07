/**
 * G5-01 MCP Probe Server — a REAL MCP server process.
 *
 * Uses the official @modelcontextprotocol/sdk McpServer + StdioServerTransport.
 * Communicates via actual MCP protocol over stdio (JSON-RPC framing,
 * initialization handshake, capability negotiation, tool listing, tool
 * invocation). This is NOT a direct function call — the client spawns this
 * process and communicates through stdin/stdout.
 *
 * Tools exposed:
 *   - `analyze`: computes sum, mean, count, min, max on an array of numbers.
 *     The result is deterministic and NOT embedded in the worker's prompt —
 *     the worker must invoke this tool to obtain it.
 *
 * Usage (standalone): `node --experimental-strip-types server.ts`
 * The probe runner spawns this as a child process via StdioClientTransport.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer(
  { name: 'g5-01-probe-server', version: '0.1.0' },
  { capabilities: { tools: {} } },
);

server.registerTool(
  'analyze',
  {
    title: 'Dataset Analyzer',
    description:
      'Compute statistics (sum, mean, count, min, max) on an array of numbers. ' +
      'Returns a JSON string with all computed values.',
    inputSchema: {
      values: z.array(z.number()).describe('The array of numbers to analyze'),
    },
  },
  async ({ values }) => {
    if (values.length === 0) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: 'empty array' }) }],
        isError: true,
      };
    }
    const sum = values.reduce((a, b) => a + b, 0);
    const mean = sum / values.length;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const result = {
      count: values.length,
      sum,
      mean: Math.round(mean * 1e6) / 1e6,
      min,
      max,
    };
    return {
      content: [{ type: 'text', text: JSON.stringify(result) }],
    };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
