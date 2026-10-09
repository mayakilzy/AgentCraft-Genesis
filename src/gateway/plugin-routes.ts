/**
 * G7-14B — Gateway Plugin Routes (read-only, authenticated).
 * Returns ONLY public summaries — command, args, env, cwd, url NEVER exposed.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { McpServerConfig, McpServerPublicSummary } from '../plugins/mcp-config.js';
import { toPublicSummary } from '../plugins/mcp-config.js';

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) });
  res.end(payload);
}
function sendError(res: ServerResponse, status: number, code: string, message: string): void {
  sendJson(res, status, { error: { code, message } });
}

export interface PluginRouteDeps {
  readonly mcpServers: readonly McpServerConfig[];
}

export async function handlePluginRoute(
  req: IncomingMessage,
  res: ServerResponse,
  deps: PluginRouteDeps,
  path: string,
): Promise<boolean> {
  if (!path.startsWith('/v1/plugins')) return false;

  if (path === '/v1/plugins' && req.method === 'GET') {
    const summaries: McpServerPublicSummary[] = deps.mcpServers.map((s) => toPublicSummary(s));
    sendJson(res, 200, { plugins: summaries });
    return true;
  }

  const match = /^\/v1\/plugins\/([^/]+)$/.exec(path);
  if (match && req.method === 'GET') {
    const name = decodeURIComponent(match[1]);
    const server = deps.mcpServers.find((s) => s.name === name);
    if (server === undefined) {
      sendError(res, 404, 'PLUGIN_NOT_FOUND', `plugin not found: ${name}`);
    } else {
      sendJson(res, 200, toPublicSummary(server));
    }
    return true;
  }

  return false;
}
