/**
 * G6-05A — Genesis A2A Inbound Server.
 *
 * An A2A-compatible inbound surface using the same JSON-RPC wire format
 * the existing reference agent (experiments/g6-02/reference-agent/server.mjs)
 * implements. Genesis BECOMES an A2A agent that external agents can discover
 * and delegate work to.
 *
 * Per Section 4.2:
 *   - Publish an Agent Card with truthful supported capabilities.
 *   - Accept a valid external A2A task (SendMessage JSON-RPC method).
 *   - Validate and authorize the request.
 *   - Translate the task into a Genesis mission.
 *   - Return protocol-compliant task identity/status.
 *   - Expose task progress and final results through GetTask.
 *   - Handle cancellation via CancelTask.
 *   - Reject malformed and unauthorized requests.
 *
 * Per Section 3: this server delegates to the SAME MissionService that
 * the HTTP API uses. No second orchestration engine.
 *
 * Wire format mirrors the @a2a-js/sdk protobuf JSON shapes:
 *   Task { id, contextId, status: { state, message?, timestamp }, artifacts, history, metadata }
 *   Part { text?, filename?, mediaType? } (top-level keys, NOT nested under content)
 *   Message { messageId, contextId, taskId, role, parts, metadata, extensions, referenceTaskIds }
 *
 * A2A TaskState numeric codes:
 *   0 UNSPECIFIED, 1 SUBMITTED, 2 WORKING, 3 COMPLETED,
 *   4 FAILED, 5 CANCELED, 6 INPUT_REQUIRED, 7 REJECTED, 8 AUTH_REQUIRED
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { timingSafeEqual } from 'node:crypto';

import type { MissionService } from './mission-service.js';
import type {
  CallerIdentity,
  GatewayConfig,
  MissionSubmission,
} from './types.js';
import { statusToA2ATaskState } from './types.js';

/**
 * A2A TaskState numeric codes (mirror of the SDK enum).
 */
const TASK_STATE = {
  UNSPECIFIED: 0,
  SUBMITTED: 1,
  WORKING: 2,
  COMPLETED: 3,
  FAILED: 4,
  CANCELED: 5,
  INPUT_REQUIRED: 6,
  REJECTED: 7,
  AUTH_REQUIRED: 8,
} as const;

/**
 * Mapping from A2A task id to Genesis mission id. Both are UUIDs; we
 * use the A2A task id AS the mission id when no caller idempotency key
 * is provided. This keeps the mapping 1:1 and simplifies correlation.
 */
interface A2ATaskRecord {
  readonly taskId: string;
  readonly missionId: string;
  readonly callerId: string;
}

/**
 * Start the A2A inbound server.
 */
export function startA2AServer(
  service: MissionService,
  config: GatewayConfig,
): { server: Server; url: string; agentCardUrl: string } {
  const tasks = new Map<string, A2ATaskRecord>();

  const server = createServer(async (req, res) => {
    try {
      await handleA2ARequest(req, res, service, config, tasks);
    } catch (error) {
      sendJsonRpcError(res, null, -32603, `internal error: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  const url = `http://${config.a2aHost}:${config.a2aPort}`;
  server.listen(config.a2aPort, config.a2aHost);
  return { server, url, agentCardUrl: `${url}/.well-known/agent-card.json` };
}

/**
 * Stop the A2A inbound server.
 */
export function stopA2AServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

async function handleA2ARequest(
  req: IncomingMessage,
  res: ServerResponse,
  service: MissionService,
  config: GatewayConfig,
  tasks: Map<string, A2ATaskRecord>,
): Promise<void> {
  // CORS (matches reference agent).
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, A2A-Version, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const path = url.pathname;

  // Serve the Agent Card.
  if (path === '/.well-known/agent-card.json' && req.method === 'GET') {
    sendJson(res, 200, buildAgentCard(config));
    return;
  }

  // JSON-RPC endpoint.
  if ((path === '/' || path === '/a2a' || path === '/jsonrpc') && req.method === 'POST') {
    const body = await readJsonBody(req, config.maxRequestBodyBytes);
    if (body === null) {
      sendJsonRpcError(res, null, -32700, 'parse error: invalid JSON body');
      return;
    }
    await handleJsonRpc(body, req, res, service, config, tasks);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('not found');
}

/**
 * Build the A2A Agent Card. Per Section 4.2: truthful supported capabilities.
 *
 * The card declares:
 *   - JSONRPC protocol binding at the server's base URL.
 *   - No streaming, no push notifications (we are polling-only in v1).
 *   - A single skill: "genesis-mission" (submit a goal, get a verified result).
 */
function buildAgentCard(config: GatewayConfig) {
  return {
    name: config.agentName,
    description: config.agentDescription,
    version: '1.0.0',
    capabilities: {
      streaming: false,
      pushNotifications: false,
      extensions: [],
    },
    supportedInterfaces: [
      {
        url: `${config.a2aBaseUrl}/`,
        protocolBinding: 'JSONRPC',
        protocolVersion: '1.0',
        tenant: '',
      },
    ],
    skills: [
      {
        id: 'genesis-mission',
        name: 'Genesis Mission',
        description:
          'Submit a goal as text; Genesis builds the organization, executes the work, and returns a verified result as a text artifact.',
        tags: ['genesis', 'mission', 'goal', 'organization'],
        examples: [],
        inputModes: ['text/plain'],
        outputModes: ['text/plain'],
      },
    ],
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain'],
    securitySchemes: {},
    securityRequirements: [],
    signatures: [],
  };
}

/**
 * Handle a JSON-RPC request (SendMessage, GetTask, CancelTask).
 */
async function handleJsonRpc(
  body: unknown,
  req: IncomingMessage,
  res: ServerResponse,
  service: MissionService,
  config: GatewayConfig,
  tasks: Map<string, A2ATaskRecord>,
): Promise<void> {
  const rpcReq = body as { jsonrpc?: string; method?: string; params?: unknown; id?: unknown };
  const id = rpcReq.id ?? null;
  const method = rpcReq.method;

  // Authenticate all A2A operations (per Section 10: A2A uses the same
  // authorization boundary even if its authentication transport differs).
  const caller = authenticateA2A(req, config);
  if (caller === null) {
    sendJsonRpcError(res, id, -32600, 'unauthorized: missing or invalid API key');
    return;
  }

  try {
    switch (method) {
      case 'SendMessage': {
        await handleSendMessage(rpcReq.params, res, id, service, caller, tasks);
        return;
      }
      case 'GetTask': {
        handleGetTask(rpcReq.params, res, id, service, caller, tasks);
        return;
      }
      case 'CancelTask': {
        await handleCancelTask(rpcReq.params, res, id, service, caller, tasks);
        return;
      }
      default:
        sendJsonRpcError(res, id, -32601, `method not found: ${method ?? '(none)'}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendJsonRpcError(res, id, -32603, `internal error: ${message}`);
  }
}

async function handleSendMessage(
  params: unknown,
  res: ServerResponse,
  id: unknown,
  service: MissionService,
  caller: CallerIdentity,
  tasks: Map<string, A2ATaskRecord>,
): Promise<void> {
  const p = params as { message?: { parts?: unknown[] } } | undefined;
  const message = p?.message;
  if (message === undefined) {
    sendJsonRpcError(res, id, -32602, 'invalid params: missing message');
    return;
  }
  const parts = message.parts ?? [];
  const goalText = extractText(parts);
  if (goalText.length === 0) {
    sendJsonRpcError(res, id, -32602, 'invalid params: message must contain at least one text part');
    return;
  }

  // Translate the A2A message into a Genesis mission submission.
  const submission: MissionSubmission = {
    outcome: goalText,
    idempotencyKey: `a2a:${caller.callerId}:${hashText(goalText)}`,
  };

  try {
    const { missionId } = service.start(submission, caller);
    // The A2A task id IS the mission id (1:1 correlation).
    const taskId = missionId;
    tasks.set(taskId, { taskId, missionId, callerId: caller.callerId });

    // Build the initial Task (SUBMITTED state). The actual work runs in
    // the background; the caller polls GetTask for status.
    const snapshot = service.get(missionId, caller);
    const task = buildTask(taskId, snapshot.status, undefined, undefined);
    sendJsonRpcResult(res, id, { task });
  } catch (error) {
    if (error instanceof Error && error.name === 'MissionAdmissionError') {
      sendJsonRpcError(res, id, -32603, `admission denied: ${error.message}`);
      return;
    }
    if (error instanceof Error && error.name === 'GatewayAuthorizationError') {
      sendJsonRpcError(res, id, -32600, `forbidden: ${error.message}`);
      return;
    }
    // Idempotency hit: the same goal was already submitted. Return the existing task.
    if (error instanceof Error && error.message.includes('idempotency')) {
      // Find the existing task by scanning the tasks map for this caller.
      for (const [taskId, record] of tasks) {
        if (record.callerId === caller.callerId) {
          const snapshot = service.get(record.missionId, caller);
          const task = buildTask(taskId, snapshot.status, snapshot.result?.summary, undefined);
          sendJsonRpcResult(res, id, { task });
          return;
        }
      }
    }
    throw error;
  }
}

function handleGetTask(
  params: unknown,
  res: ServerResponse,
  id: unknown,
  service: MissionService,
  caller: CallerIdentity,
  tasks: Map<string, A2ATaskRecord>,
): void {
  const p = params as { id?: string } | undefined;
  const taskId = p?.id;
  if (typeof taskId !== 'string') {
    sendJsonRpcError(res, id, -32602, 'invalid params: missing id');
    return;
  }
  const record = tasks.get(taskId);
  if (record === undefined) {
    sendJsonRpcError(res, id, -32602, `task not found: ${taskId}`);
    return;
  }
  if (record.callerId !== caller.callerId) {
    // Cross-caller access: return not-found (do not leak existence).
    sendJsonRpcError(res, id, -32602, `task not found: ${taskId}`);
    return;
  }

  try {
    const snapshot = service.get(record.missionId, caller);
    const task = buildTask(taskId, snapshot.status, snapshot.result?.summary, undefined);
    sendJsonRpcResult(res, id, task);
  } catch (error) {
    if (error instanceof Error && error.name === 'MissionNotFoundError') {
      sendJsonRpcError(res, id, -32602, `task not found: ${taskId}`);
      return;
    }
    throw error;
  }
}

async function handleCancelTask(
  params: unknown,
  res: ServerResponse,
  id: unknown,
  service: MissionService,
  caller: CallerIdentity,
  tasks: Map<string, A2ATaskRecord>,
): Promise<void> {
  const p = params as { id?: string } | undefined;
  const taskId = p?.id;
  if (typeof taskId !== 'string') {
    sendJsonRpcError(res, id, -32602, 'invalid params: missing id');
    return;
  }
  const record = tasks.get(taskId);
  if (record === undefined) {
    sendJsonRpcError(res, id, -32602, `task not found: ${taskId}`);
    return;
  }
  if (record.callerId !== caller.callerId) {
    sendJsonRpcError(res, id, -32602, `task not found: ${taskId}`);
    return;
  }

  const status = service.cancel(record.missionId, caller);
  const task = buildTask(taskId, status, undefined, undefined);
  sendJsonRpcResult(res, id, task);
}

/**
 * Build an A2A Task object in the SDK's protobuf JSON wire format.
 * Mirrors the reference agent's buildTask() exactly.
 */
function buildTask(
  taskId: string,
  missionStatus: import('./types.js').MissionStatus,
  resultText: string | undefined,
  message: unknown,
): unknown {
  const state = statusToA2ATaskState(missionStatus);
  const artifacts =
    resultText === undefined || resultText.length === 0
      ? []
      : [
          {
            artifactId: `${taskId}-result`,
            name: 'Result',
            description: 'Genesis mission result',
            parts: [
              {
                text: resultText,
                filename: '',
                mediaType: 'text/plain',
              },
            ],
            metadata: undefined,
            extensions: [],
          },
        ];
  return {
    id: taskId,
    contextId: taskId,
    status: {
      state,
      message: message === undefined ? undefined : message,
      timestamp: new Date().toISOString(),
    },
    artifacts,
    history: [],
    metadata: undefined,
  };
}

/**
 * Extract text from A2A Message parts. Handles both wire format (top-level
 * `text` key) and in-memory format (`content: { $case: 'text', value: ... }`).
 * Mirrors the reference agent's extractText().
 */
function extractText(parts: unknown[]): string {
  const texts: string[] = [];
  for (const part of parts ?? []) {
    if (part === null || typeof part !== 'object') continue;
    const p = part as Record<string, unknown>;
    // Wire format: { text: "value", ... }
    if (typeof p.text === 'string') {
      texts.push(p.text);
    }
    // In-memory format: { content: { $case: 'text', value: "value" } }
    else if (
      p.content !== null &&
      typeof p.content === 'object' &&
      (p.content as Record<string, unknown>).$case === 'text' &&
      typeof (p.content as Record<string, unknown>).value === 'string'
    ) {
      texts.push((p.content as Record<string, unknown>).value as string);
    }
  }
  return texts.join('\n');
}

/**
 * Authenticate the A2A caller. Per Section 10: A2A uses the same
 * authorization boundary. We accept the same Bearer token as the HTTP API.
 *
 * Future: A2A may use a different transport (e.g., mTLS, signed cards);
 * for v1 we reuse the API-key mechanism via the Authorization header.
 */
function authenticateA2A(req: IncomingMessage, config: GatewayConfig): CallerIdentity | null {
  const authHeader = req.headers.authorization;
  if (typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  const providedKey = authHeader.slice('Bearer '.length);
  if (providedKey.length === 0) {
    return null;
  }

  let matched: CallerIdentity | null = null;
  let matchedCount = 0;
  for (const [validKey, identity] of config.apiKeys) {
    if (constantTimeEquals(providedKey, validKey)) {
      matched = identity;
      matchedCount += 1;
    }
  }
  if (matchedCount !== 1) {
    return null;
  }
  return matched;
}

function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) {
    timingSafeEqual(Buffer.from(a), Buffer.from(a));
    return false;
  }
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

/**
 * Compute a short hex hash of the goal text (for idempotency key derivation).
 */
function hashText(text: string): string {
  // Simple FNV-1a hash (no crypto dependency needed for idempotency keys,
  // which are not security-sensitive — they only need to be deterministic).
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

async function readJsonBody(
  req: IncomingMessage,
  maxBytes: number,
): Promise<unknown> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    let aborted = false;

    req.on('data', (chunk: Buffer) => {
      totalBytes += chunk.length;
      if (totalBytes > maxBytes) {
        aborted = true;
        resolve(null);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (aborted) return;
      const raw = Buffer.concat(chunks).toString('utf8');
      if (raw.length === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve(null);
      }
    });

    req.on('error', () => resolve(null));
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function sendJsonRpcResult(res: ServerResponse, id: unknown, result: unknown): void {
  sendJson(res, 200, { jsonrpc: '2.0', result, id });
}

function sendJsonRpcError(
  res: ServerResponse,
  id: unknown,
  code: number,
  message: string,
): void {
  sendJson(res, 200, { jsonrpc: '2.0', error: { code, message }, id });
}

// Re-export TASK_STATE for tests that need to assert wire-format values.
export { TASK_STATE };
// Re-export randomUUID for any test that needs deterministic task ids.
export { randomUUID };
