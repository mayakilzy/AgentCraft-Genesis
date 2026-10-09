/**
 * G7-14A — MCP Server Configuration Schema + Loader.
 *
 * Loads and validates an operator-authored YAML configuration file that
 * declares MCP servers, their transports (stdio or http), and the tool
 * grants each server provides. This is the ONLY mechanism for configuring
 * MCP servers — there is no dynamic installation, no marketplace, no
 * model-authored configuration changes.
 *
 * Architect constraints honored:
 *   - YAML format (approved).
 *   - Reuse existing `mcp:` grant prefix (approved).
 *   - Only the operator may configure MCP servers (the config file is
 *     read from a server-side path, never from client input).
 *   - No model-authored command, installation, or configuration changes.
 *   - Treat stdio processes as trusted local execution (not sandboxed
 *     plugins). The StdioClientTransport uses child_process.spawn(command,
 *     args, { env }) — NOT child_process.exec(command_string) — so there
 *     is no shell injection risk.
 *
 * Security/privacy:
 *   - The config file may contain `command`, `args`, `env`, and `url`
 *     fields (operator-authored, trusted). These are NEVER exposed through
 *     the Gateway or Studio API — see `toPublicSummary()` which strips
 *     all sensitive fields.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, isAbsolute } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Zod schema for MCP server configuration
// ---------------------------------------------------------------------------

const stdioTransportSchema = z.object({
  kind: z.literal('stdio'),
  command: z.string().min(1, 'stdio transport requires a non-empty "command"'),
  args: z.array(z.string()).optional().default([]),
  env: z.record(z.string(), z.string()).optional(),
  cwd: z.string().optional(),
});

const httpTransportSchema = z.object({
  kind: z.literal('http'),
  url: z.string().min(1, 'http transport requires a non-empty "url"'),
});

const transportSchema = z.discriminatedUnion('kind', [stdioTransportSchema, httpTransportSchema]);

const serverEntrySchema = z.object({
  name: z.string().min(1, 'server name must be non-empty'),
  transport: transportSchema,
  grants: z.array(
    z.string().regex(/^mcp:.+$/, 'grants must be in the format "mcp:<tool-name>"'),
  ).min(1, 'each server must grant at least one mcp: tool'),
  satisfies: z.array(z.string()).optional().default([]),
  description: z.string().optional(),
});

const configSchema = z.object({
  servers: z.array(serverEntrySchema).min(0, 'servers array is required (can be empty)'),
});

// ---------------------------------------------------------------------------
// Types (derived from zod schema)
// ---------------------------------------------------------------------------

export type StdioTransport = z.infer<typeof stdioTransportSchema>;
export type HttpTransport = z.infer<typeof httpTransportSchema>;
export type McpTransport = z.infer<typeof transportSchema>;
export type McpServerConfig = z.infer<typeof serverEntrySchema>;
export type McpServerConfigFile = z.infer<typeof configSchema>;

// ---------------------------------------------------------------------------
// Public summary (safe for Gateway/Studio — strips all sensitive fields)
// ---------------------------------------------------------------------------

export type PluginStatus = 'CONFIGURED' | 'AVAILABLE' | 'RUNTIME_VERIFIED' | 'UNAVAILABLE';

export interface McpServerPublicSummary {
  readonly name: string;
  readonly transportKind: 'stdio' | 'http';
  readonly grants: readonly string[];
  readonly satisfies: readonly string[];
  readonly description?: string;
  /**
   * CONFIGURED: configuration was validated at load time.
   * AVAILABLE: a recent reachability check (preflight probe) succeeded.
   * RUNTIME_VERIFIED: actual execution evidence (a tool was invoked).
   * UNAVAILABLE: a recent reachability check failed or the server crashed.
   *
   * Per the architect's correction: never upgrade status merely because
   * a server is listed. The loader sets CONFIGURED; the activation module
   * sets AVAILABLE/UNAVAILABLE after a preflight probe; the worker's
   * invokeTool sets RUNTIME_VERIFIED after a successful invocation.
   */
  readonly status: PluginStatus;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class McpConfigError extends Error {
  constructor(message: string) {
    super(`MCP config error: ${message}`);
    this.name = 'McpConfigError';
  }
}

export class McpConfigNotFoundError extends Error {
  constructor(path: string) {
    super(`MCP config file not found: ${path}`);
    this.name = 'McpConfigNotFoundError';
  }
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export interface McpConfigLoadResult {
  readonly servers: readonly McpServerConfig[];
  readonly sourcePath: string;
}

/**
 * Load and validate the MCP server configuration file.
 *
 * The config path is read from the `GENESIS_MCP_SERVERS_CONFIG` environment
 * variable. If the variable is not set, returns null (zero servers) —
 * the gateway starts normally with no MCP capabilities.
 *
 * If the variable IS set, the file must exist and be valid. A missing or
 * malformed config file is a fatal startup error (fail-closed).
 */
export function loadMcpConfig(envPath?: string): McpConfigLoadResult | null {
  const configPath = envPath ?? process.env.GENESIS_MCP_SERVERS_CONFIG;
  if (configPath === undefined || configPath.trim().length === 0) {
    return null;
  }

  const resolvedPath = isAbsolute(configPath) ? configPath : resolve(process.cwd(), configPath);
  if (!existsSync(resolvedPath)) {
    throw new McpConfigNotFoundError(resolvedPath);
  }

  const raw = readFileSync(resolvedPath, 'utf8');
  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (e) {
    throw new McpConfigError(
      `YAML parse failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  if (parsed === null || parsed === undefined) {
    return { servers: [], sourcePath: resolvedPath };
  }

  const result = configSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new McpConfigError(`schema validation failed:\n${issues}`);
  }

  // Cross-server uniqueness checks.
  const servers = result.data.servers;
  const seenNames = new Set<string>();
  const seenToolNames = new Set<string>();
  for (const server of servers) {
    if (seenNames.has(server.name)) {
      throw new McpConfigError(`duplicate server name: "${server.name}" — each server must have a unique name`);
    }
    seenNames.add(server.name);
    for (const grant of server.grants) {
      const toolName = grant.slice(4); // strip "mcp:" prefix
      if (seenToolNames.has(toolName)) {
        throw new McpConfigError(
          `duplicate tool name "${toolName}" — granted by both "${server.name}" and a prior server. ` +
          `Each tool must be provided by exactly one server to avoid ambiguous routing.`,
        );
      }
      seenToolNames.add(toolName);
    }
  }

  return { servers, sourcePath: resolvedPath };
}

/**
 * Convert a validated server config to a public summary that is safe to
 * expose through the Gateway and Studio API. Strips ALL sensitive fields:
 * command, args, env, cwd, url. Only returns: name, transport kind, grants,
 * satisfies, description, status.
 */
export function toPublicSummary(server: McpServerConfig, status: PluginStatus = 'CONFIGURED'): McpServerPublicSummary {
  return {
    name: server.name,
    transportKind: server.transport.kind,
    grants: server.grants,
    satisfies: server.satisfies,
    ...(server.description !== undefined ? { description: server.description } : {}),
    status,
  };
}

/**
 * Find the server that provides a given tool name.
 */
export function findServerForTool(
  servers: readonly McpServerConfig[],
  toolName: string,
): McpServerConfig | undefined {
  const grant = `mcp:${toolName}`;
  return servers.find((s) => s.grants.includes(grant));
}
