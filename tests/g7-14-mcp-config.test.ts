/**
 * G7-14A — MCP server config schema + loader tests.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  loadMcpConfig,
  toPublicSummary,
  findServerForTool,
  McpConfigError,
  McpConfigNotFoundError,
  type McpServerConfig,
} from '../src/plugins/mcp-config.js';

const TMP_ROOT = join(tmpdir(), 'g7-14-config-tests');
mkdirSync(TMP_ROOT, { recursive: true });

function writeConfig(dir: string, content: string): string {
  const path = join(dir, `mcp-${Date.now()}-${Math.random().toString(36).slice(2)}.yaml`);
  writeFileSync(path, content, 'utf8');
  return path;
}

describe('G7-14A — MCP config schema + loader', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(TMP_ROOT, 't-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  describe('valid configs', () => {
    it('loads a valid stdio config', () => {
      const p = writeConfig(dir, `
servers:
  - name: analyze-server
    transport: { kind: stdio, command: node, args: [server.ts] }
    grants: [mcp:analyze]
    satisfies: [data-analysis]
    description: Test
`);
      const r = loadMcpConfig(p)!;
      expect(r.servers).toHaveLength(1);
      expect(r.servers[0].name).toBe('analyze-server');
      expect(r.servers[0].transport.kind).toBe('stdio');
      expect(r.servers[0].grants).toEqual(['mcp:analyze']);
    });

    it('loads a valid http config', () => {
      const p = writeConfig(dir, `
servers:
  - name: http-server
    transport: { kind: http, url: http://127.0.0.1:8080 }
    grants: [mcp:search]
`);
      const r = loadMcpConfig(p)!;
      expect(r.servers).toHaveLength(1);
      expect(r.servers[0].transport.kind).toBe('http');
    });

    it('loads a config with multiple servers', () => {
      const p = writeConfig(dir, `
servers:
  - name: a
    transport: { kind: stdio, command: node }
    grants: [mcp:tool-a, mcp:tool-b]
  - name: b
    transport: { kind: http, url: http://localhost:9000 }
    grants: [mcp:tool-c]
`);
      expect(loadMcpConfig(p)!.servers).toHaveLength(2);
    });

    it('loads an empty config', () => {
      expect(loadMcpConfig(writeConfig(dir, 'servers: []'))!.servers).toHaveLength(0);
    });

    it('loads an empty YAML file', () => {
      expect(loadMcpConfig(writeConfig(dir, ''))!.servers).toHaveLength(0);
    });
  });

  describe('no env var → null', () => {
    it('returns null when not set', () => {
      const saved = process.env.GENESIS_MCP_SERVERS_CONFIG;
      delete process.env.GENESIS_MCP_SERVERS_CONFIG;
      expect(loadMcpConfig()).toBeNull();
      if (saved !== undefined) process.env.GENESIS_MCP_SERVERS_CONFIG = saved;
    });
  });

  describe('error cases', () => {
    it('throws McpConfigNotFoundError for missing file', () => {
      expect(() => loadMcpConfig('/nonexistent/mcp.yaml')).toThrow(McpConfigNotFoundError);
    });
    it('throws McpConfigError on malformed YAML', () => {
      const p = writeConfig(dir, 'servers: [invalid');
      expect(() => loadMcpConfig(p)).toThrow(McpConfigError);
    });
    it('throws on missing server name', () => {
      expect(() => loadMcpConfig(writeConfig(dir, 'servers:\n  - transport: { kind: stdio, command: node }\n    grants: [mcp:analyze]'))).toThrow(McpConfigError);
    });
    it('throws on unknown transport kind', () => {
      expect(() => loadMcpConfig(writeConfig(dir, 'servers:\n  - name: bad\n    transport: { kind: websocket }\n    grants: [mcp:tool]'))).toThrow(McpConfigError);
    });
    it('throws on non-mcp grant prefix', () => {
      expect(() => loadMcpConfig(writeConfig(dir, 'servers:\n  - name: bad\n    transport: { kind: stdio, command: node }\n    grants: [analyze]'))).toThrow(McpConfigError);
    });
    it('throws on empty grants', () => {
      expect(() => loadMcpConfig(writeConfig(dir, 'servers:\n  - name: bad\n    transport: { kind: stdio, command: node }\n    grants: []'))).toThrow(McpConfigError);
    });
    it('throws on duplicate server names', () => {
      const p = writeConfig(dir, 'servers:\n  - name: dup\n    transport: { kind: stdio, command: node }\n    grants: [mcp:a]\n  - name: dup\n    transport: { kind: stdio, command: node }\n    grants: [mcp:b]');
      expect(() => loadMcpConfig(p)).toThrow(/duplicate server name/);
    });
    it('throws on duplicate tool names across servers', () => {
      const p = writeConfig(dir, 'servers:\n  - name: a\n    transport: { kind: stdio, command: node }\n    grants: [mcp:shared]\n  - name: b\n    transport: { kind: stdio, command: node }\n    grants: [mcp:shared]');
      expect(() => loadMcpConfig(p)).toThrow(/duplicate tool name/);
    });
  });

  describe('toPublicSummary', () => {
    it('strips command, args, env, cwd, url', () => {
      const s: McpServerConfig = { name: 't', transport: { kind: 'stdio', command: 'node', args: ['secret.ts'], env: { KEY: 'val' }, cwd: '/secret' }, grants: ['mcp:analyze'], satisfies: [], description: 't' };
      const sum = toPublicSummary(s);
      expect(JSON.stringify(sum)).not.toContain('node');
      expect(JSON.stringify(sum)).not.toContain('secret.ts');
      expect(JSON.stringify(sum)).not.toContain('KEY');
      expect(JSON.stringify(sum)).not.toContain('/secret');
    });
    it('strips url from http transport', () => {
      const s: McpServerConfig = { name: 'h', transport: { kind: 'http', url: 'http://user:pass@host:8080' }, grants: ['mcp:search'], satisfies: [] };
      expect(JSON.stringify(toPublicSummary(s))).not.toContain('user:pass');
      expect(JSON.stringify(toPublicSummary(s))).not.toContain('host:8080');
    });
  });

  describe('findServerForTool', () => {
    it('finds the correct server', () => {
      const servers: McpServerConfig[] = [
        { name: 'a', transport: { kind: 'stdio', command: 'node', args: [] }, grants: ['mcp:tool-a'], satisfies: [] },
        { name: 'b', transport: { kind: 'http', url: 'http://localhost' }, grants: ['mcp:tool-b'], satisfies: [] },
      ];
      expect(findServerForTool(servers, 'tool-a')?.name).toBe('a');
      expect(findServerForTool(servers, 'tool-b')?.name).toBe('b');
      expect(findServerForTool(servers, 'nonexistent')).toBeUndefined();
    });
  });
});
