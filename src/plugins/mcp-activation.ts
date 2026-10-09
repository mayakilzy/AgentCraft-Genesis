/**
 * G7-14D — Composite MCP Provider + Per-mission Activation.
 *
 * Implements the EXISTING McpCapabilityProvider interface — a drop-in
 * replacement for the orchestrator's `mcp?` option. No frozen contract
 * change.
 *
 * Architect constraints honored:
 *   1. "Preserve existing orchestration contracts." — CompositeMcpProvider
 *      implements McpCapabilityProvider; the orchestrator's mcp? option
 *      is unchanged.
 *   2. "Activate only the configured providers required by the mission's
 *      authorized tool grants." — buildMcpProvidersForMission() filters
 *      for mcp: grants and connects ONLY the servers that provide them.
 *   3. "Use bounded connection and preflight timeouts." — 5s connect,
 *      3s preflight.
 *   4. "Close connections and child processes on completion, failure,
 *      cancellation, and startup rollback." — close() cleans up all
 *      connected providers.
 *   5. "An unavailable required provider must produce explicit
 *      capability-unavailable evidence." — unavailable tools return
 *      { ok: false, text: 'tool "X" unavailable: <reason>' }.
 */
import type { McpServerConfig } from './mcp-config.js';
import { findServerForTool } from './mcp-config.js';
import type { McpCapabilityProvider, McpToolResult } from '../runtime/mcp/capability-provider.js';
import { McpCapabilityProviderImpl } from '../runtime/mcp/capability-provider.js';

const CONNECT_TIMEOUT_MS = 5_000;
const PREFLIGHT_TIMEOUT_MS = 3_000;

export class McpActivationError extends Error {
  constructor(message: string) { super(`MCP activation error: ${message}`); this.name = 'McpActivationError'; }
}

/**
 * Composite MCP provider — routes tool invocations to the server that
 * owns the tool. Implements the EXISTING McpCapabilityProvider interface.
 */
export class CompositeMcpProvider implements McpCapabilityProvider {
  readonly name = 'composite-mcp';
  private readonly toolToProvider = new Map<string, McpCapabilityProvider>();
  private readonly unavailableTools = new Map<string, string>();
  private readonly connectedProviders: McpCapabilityProvider[] = [];

  registerProvider(tools: readonly string[], provider: McpCapabilityProvider): void {
    for (const tool of tools) this.toolToProvider.set(tool, provider);
    this.connectedProviders.push(provider);
  }

  registerUnavailable(tool: string, reason: string): void {
    this.unavailableTools.set(tool, reason);
  }

  async listTools(): Promise<readonly string[]> {
    return [...this.toolToProvider.keys()];
  }

  async invokeTool(name: string, args?: Readonly<Record<string, unknown>>): Promise<McpToolResult> {
    const provider = this.toolToProvider.get(name);
    if (provider !== undefined) return provider.invokeTool(name, args);
    const reason = this.unavailableTools.get(name);
    if (reason !== undefined) {
      return { ok: false, text: `tool "${name}" unavailable: ${reason}`, raw: undefined };
    }
    return { ok: false, text: `tool "${name}" not found in any connected MCP server`, raw: undefined };
  }

  async close(): Promise<void> {
    for (const p of this.connectedProviders) {
      try { await p.close(); } catch (e) {
        console.error(`[mcp-composite] close error: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    this.toolToProvider.clear();
    this.unavailableTools.clear();
    this.connectedProviders.length = 0;
  }
}

/**
 * Build a composite MCP provider for a mission.
 *
 * Activates ONLY servers needed by the mission's mcp: grants.
 * Returns null if the genome has no mcp: grants.
 */
export async function buildMcpProvidersForMission(
  config: readonly McpServerConfig[],
  genomeTools: readonly string[],
): Promise<CompositeMcpProvider | null> {
  const mcpGrants = genomeTools.filter((t) => t.startsWith('mcp:'));
  if (mcpGrants.length === 0) return null;

  const toolNames = [...new Set(mcpGrants.map((g) => g.slice(4)))];
  const serversToConnect = new Map<string, McpServerConfig>();
  for (const toolName of toolNames) {
    const server = findServerForTool(config, toolName);
    if (server !== undefined && !serversToConnect.has(server.name)) {
      serversToConnect.set(server.name, server);
    }
  }

  const composite = new CompositeMcpProvider();
  for (const [serverName, server] of serversToConnect) {
    const provider = await connectWithTimeout(server);
    if (provider === null) {
      for (const grant of server.grants) {
        composite.registerUnavailable(grant.slice(4), `server "${serverName}" unreachable (connect failed or timed out)`);
      }
      continue;
    }
    const discoveredTools = await listToolsWithTimeout(provider);
    if (discoveredTools === null) {
      for (const grant of server.grants) {
        composite.registerUnavailable(grant.slice(4), `server "${serverName}" preflight probe failed or timed out`);
      }
      await provider.close();
      continue;
    }
    for (const grant of server.grants) {
      const tool = grant.slice(4);
      if (discoveredTools.includes(tool)) {
        composite.registerProvider([tool], provider);
      } else {
        composite.registerUnavailable(tool, `server "${serverName}" did not expose tool "${tool}"`);
      }
    }
  }
  return composite;
}

async function connectWithTimeout(server: McpServerConfig): Promise<McpCapabilityProvider | null> {
  try {
    const transport = createTransport(server);
    const provider = new McpCapabilityProviderImpl(transport);
    await withTimeout(provider.connect(), CONNECT_TIMEOUT_MS, `connect to "${server.name}"`);
    return provider;
  } catch (e) {
    console.error(`[mcp-activation] connect failed for "${server.name}": ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

async function listToolsWithTimeout(provider: McpCapabilityProvider): Promise<readonly string[] | null> {
  try {
    return await withTimeout(provider.listTools(), PREFLIGHT_TIMEOUT_MS, 'preflight listTools');
  } catch (e) {
    console.error(`[mcp-activation] preflight failed: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

function createTransport(server: McpServerConfig): { start(): Promise<void> } {
  if (server.transport.kind === 'stdio') {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
    const t = server.transport;
    return new StdioClientTransport({
      command: t.command,
      ...(t.args !== undefined && t.args.length > 0 ? { args: t.args } : {}),
      ...(t.env !== undefined ? { env: t.env } : {}),
      ...(t.cwd !== undefined ? { cwd: t.cwd } : {}),
      stderr: 'pipe',
    });
  }
  if (server.transport.kind === 'http') {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
    return new StreamableHTTPClientTransport(server.transport.url);
  }
  throw new McpActivationError(`unsupported transport: ${(server.transport as { kind: string }).kind}`);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new McpActivationError(`timed out after ${timeoutMs}ms: ${label}`)), timeoutMs);
    promise.then((r) => { clearTimeout(timer); resolve(r); }, (e) => { clearTimeout(timer); reject(e); });
  });
}

// ---------------------------------------------------------------------------
// LazyCompositeMcpProvider — connects servers on demand
// ---------------------------------------------------------------------------

/**
 * A lazy composite provider that connects MCP servers on first use.
 *
 * Per the architect's F1 correction: "Derive activation from authorized
 * mission/worker grants, not untrusted user-supplied tool names." This
 * provider holds the full MCP config but does NOT connect any servers at
 * construction time. Servers are connected lazily when a worker (whose
 * genome grants `mcp:<tool>`) actually calls `invokeTool(name, args)`.
 *
 * The WorkerAgent's existing grant check (`genome.tools.includes(grant)`)
 * determines which tools the worker is authorized to invoke. Only
 * authorized tools reach `invokeTool` — the lazy provider connects the
 * server for that tool on first use.
 *
 * This approach:
 *   - Preserves the orchestrator interface (mcp? option unchanged).
 *   - Only connects servers when a worker actually needs a tool (minimal
 *     activation — per architect: "Activate only the configured providers
 *     required by the mission's authorized tool grants").
 *   - Works with the existing genome compilation flow (MCP grants are
 *     in `genome.tools`, set by the GenomeCompiler; the lazy provider
 *     doesn't need to know the genome at construction time).
 */
export class LazyCompositeMcpProvider implements McpCapabilityProvider {
  readonly name = 'lazy-composite-mcp';
  private readonly config: readonly McpServerConfig[];
  private readonly connectedServers = new Map<string, McpCapabilityProvider>();
  private readonly unavailableTools = new Map<string, string>();

  constructor(config: readonly McpServerConfig[]) {
    this.config = config;
  }

  async listTools(): Promise<readonly string[]> {
    // Return all configured tool names without connecting any server.
    // The worker's genome grants determine which tools it can actually
    // invoke — listTools is informational.
    const tools: string[] = [];
    for (const server of this.config) {
      for (const grant of server.grants) {
        tools.push(grant.slice(4)); // strip "mcp:" prefix
      }
    }
    return tools;
  }

  async invokeTool(name: string, args?: Readonly<Record<string, unknown>>): Promise<McpToolResult> {
    // Check if already unavailable.
    const unavailableReason = this.unavailableTools.get(name);
    if (unavailableReason !== undefined) {
      return { ok: false, text: `tool "${name}" unavailable: ${unavailableReason}`, raw: undefined };
    }

    // Find the server for this tool.
    const server = findServerForTool(this.config, name);
    if (server === undefined) {
      return { ok: false, text: `tool "${name}" not found in any configured MCP server`, raw: undefined };
    }

    // Check if already connected.
    const existing = this.connectedServers.get(server.name);
    if (existing !== undefined) {
      return existing.invokeTool(name, args);
    }

    // Connect lazily with bounded timeout.
    const connected = await connectWithTimeout(server);
    if (connected === null) {
      const reason = `server "${server.name}" unreachable (connect failed or timed out)`;
      for (const grant of server.grants) {
        this.unavailableTools.set(grant.slice(4), reason);
      }
      return { ok: false, text: `tool "${name}" unavailable: ${reason}`, raw: undefined };
    }
    this.connectedServers.set(server.name, connected);

    // Invoke the tool through the connected provider.
    return connected.invokeTool(name, args);
  }

  async close(): Promise<void> {
    for (const [name, provider] of this.connectedServers) {
      try { await provider.close(); } catch (e) {
        console.error(`[mcp-lazy] close error for "${name}": ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    this.connectedServers.clear();
    this.unavailableTools.clear();
  }
}
