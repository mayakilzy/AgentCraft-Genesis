/**
 * G5-01 — MCP Capability Provider.
 *
 * The capability interoperability seam for external tools exposed through
 * the Model Context Protocol. This is NOT a fourth operational pillar
 * (ComputerSurface / WorkspaceSurface / JobSurface remain the three
 * pillars). MCP enters at the capability/tool resolution layer: a worker
 * whose genome grants `mcp:<tool>` may invoke that tool through this
 * provider, and the official MCP SDK performs all protocol work.
 *
 * Anti-reimplementation: transport, session, initialization, capability
 * negotiation, tool discovery, and tool invocation are ALL owned by the
 * official `@modelcontextprotocol/sdk`. Genesis wraps; it does not
 * reinvent. The provider holds one connected `Client` and exposes exactly
 * two operations the WorkerAgent needs: list available tools and invoke
 * one. Everything else is the SDK's concern.
 *
 * Authorization is NOT this provider's job. Grant enforcement lives in the
 * WorkerAgent (genome.tools check). The provider is the mechanism; the
 * grant is the policy. A provider connected to a server does NOT mean
 * every worker may call every tool — only workers whose genome carries
 * the matching `mcp:<tool>` grant may invoke it.
 */

// Official MCP SDK imports — dynamic to keep the module loadable without
// the SDK present at import time (dev-only dependency promotion happens at
// G5-01; the dynamic import lets tests and experiments opt in explicitly).
import type { Client as McpClientType } from '@modelcontextprotocol/sdk/client/index.js';

/**
 * A normalized MCP tool invocation result. The official SDK returns a
 * `CallToolResult` with a `content` array of typed blocks. Genesis normalizes
 * that to a single text string for the worker's observation — the worker
 * reasons about text, not about MCP content block schemas.
 *
 * If the server returns an `isError` flag, the result carries the error text
 * but `ok` is `false` — the worker sees the failure honestly.
 */
export interface McpToolResult {
  /** Whether the tool call succeeded (no SDK error and no server-side isError). */
  readonly ok: boolean;
  /** Normalized text from the tool's content blocks. */
  readonly text: string;
  /** Raw structured content for callers that need it (verification, telemetry). */
  readonly raw: unknown;
}

/**
 * The minimal capability surface the WorkerAgent consumes. This interface
 * exists so tests can inject a stub without spinning up a real MCP server.
 * Production code uses {@link McpCapabilityProvider}.
 */
export interface McpCapabilityProvider {
  readonly name: string;
  /** Discover tool names the connected server exposes. */
  listTools(): Promise<readonly string[]>;
  /** Invoke a tool by name with structured arguments. */
  invokeTool(name: string, args?: Readonly<Record<string, unknown>>): Promise<McpToolResult>;
  /** Close the connection and release resources. */
  close(): Promise<void>;
}

/**
 * A connected MCP client wrapping the official SDK `Client`.
 *
 * Construction does NOT connect — call {@link connect} to establish the
 * session. This separates "I have a provider" from "the server is
 * reachable", which matters for honest failure behavior: a mission that
 * cannot connect reports the failure, it does not pretend the capability
 * exists.
 *
 * Lifecycle:
 *   const provider = new McpCapabilityProvider(transport);
 *   await provider.connect();
 *   const tools = await provider.listTools();
 *   const result = await provider.invokeTool('sum', { values: [1,2,3] });
 *   await provider.close();
 */
export class McpCapabilityProviderImpl implements McpCapabilityProvider {
  readonly name = 'mcp';

  private client: McpClientType | undefined;
  private connected = false;

  /**
   * @param transport The official MCP SDK transport (InMemoryTransport,
   * StdioClientTransport, or any conforming transport). Genesis does NOT
   * construct transports — the caller chooses the transport, the provider
   * owns the protocol.
   */
  constructor(private readonly transport: { start(): Promise<void> }) {}

  /** Establish the MCP session (initialization handshake, capability negotiation). */
  async connect(): Promise<void> {
    if (this.connected) return;
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
    this.client = new Client(
      { name: 'genesis-mcp-client', version: '0.1.0' },
      { capabilities: {} },
    );
    await this.client.connect(this.transport as Parameters<McpClientType['connect']>[0]);
    this.connected = true;
  }

  async listTools(): Promise<readonly string[]> {
    this.assertConnected();
    const result = await this.client!.listTools();
    return result.tools.map((t) => t.name);
  }

  async invokeTool(
    name: string,
    args?: Readonly<Record<string, unknown>>,
  ): Promise<McpToolResult> {
    this.assertConnected();
    try {
      const result = await this.client!.callTool({
        name,
        arguments: args ?? {},
      });
      const raw = result as {
        content?: Array<{ type: string; text?: string }>;
        isError?: boolean;
      };
      const text = (raw.content ?? [])
        .map((block) => block.text ?? '')
        .join('\n');
      const ok = raw.isError !== true && text.length > 0;
      return { ok, text, raw: result };
    } catch (error) {
      return {
        ok: false,
        text: `mcp tool "${name}" failed: ${(error as Error).message.slice(0, 300)}`,
        raw: undefined,
      };
    }
  }

  async close(): Promise<void> {
    if (!this.connected || this.client === undefined) return;
    try {
      await this.client.close();
    } finally {
      this.connected = false;
      this.client = undefined;
    }
  }

  private assertConnected(): void {
    if (!this.connected || this.client === undefined) {
      throw new Error(
        'McpCapabilityProvider is not connected — call connect() before listTools/invokeTool',
      );
    }
  }
}

/**
 * The grant prefix for MCP tools in `WorkerGenome.tools`.
 *
 * Format: `mcp:<tool-name>` — e.g. `mcp:sum`, `mcp:analyze`.
 *
 * Why a prefix (not a new genome field or no prefix):
 *   1. The existing grant convention is `<owner>:<domain>` (openbot:shell-execution,
 *      opendots:collaborative-workspace, openmuse:durable-delegation). The owner
 *      `mcp` is already in data/ownership.yaml. `mcp:<tool>` is the same shape.
 *   2. No prefix → ambiguity: "sum" could be an MCP tool or a future native tool.
 *      The `<owner>:` prefix disambiguates the resolution path.
 *   3. A new genome field (mcpTools) would violate the worker-genome invariant:
 *      the genome describes WHAT, not WHICH PROTOCOL implements it.
 *
 * This is the ONLY place the prefix is frozen. The WorkerAgent's grant check
 * uses this constant; the GenomeCompiler does not need to know about it
 * (MCP grants are injected by the caller, same as collaborative-workspace).
 */
export const MCP_GRANT_PREFIX = 'mcp:';

/** Check whether a grant string is an MCP tool grant. */
export function isMcpGrant(grant: string): boolean {
  return grant.startsWith(MCP_GRANT_PREFIX);
}

/** Extract the tool name from an MCP grant (`mcp:sum` → `sum`). */
export function mcpGrantTool(grant: string): string {
  return grant.slice(MCP_GRANT_PREFIX.length);
}

/** Build an MCP grant from a tool name (`sum` → `mcp:sum`). */
export function mcpGrant(tool: string): string {
  return `${MCP_GRANT_PREFIX}${tool}`;
}
