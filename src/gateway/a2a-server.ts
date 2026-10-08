/**
 * G6-05A-R1 — Genesis A2A Inbound Server (official SDK-backed).
 *
 * Replaces the G6-05A manual JSON-RPC dispatch with the official
 * @a2a-js/sdk server abstractions:
 *   - DefaultRequestHandler (implements A2ARequestHandler)
 *   - AgentExecutor (Genesis implements this interface)
 *   - InMemoryTaskStore (SDK-provided task persistence)
 *   - JsonRpcTransportHandler (SDK-provided JSON-RPC dispatch)
 *   - Official AgentCard, Task, Message, Part types
 *
 * The HTTP transport remains native node:http (no express dependency
 * required — JsonRpcTransportHandler.handle() returns a JSONRPCResponse
 * that we serialize ourselves).
 *
 * Per Section 4.2 (G6-05A): "Use official SDK abstractions. Do not
 * implement a custom A2A protocol parser or fork the SDK."
 *
 * Authentication and caller isolation remain enforced via a custom
 * UserBuilder that maps the Bearer API key to a CallerIdentity, and
 * via the AgentExecutor's caller-scoped MissionService delegation.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';

import type { MissionService } from './mission-service.js';
import type { CallerIdentity, GatewayConfig, MissionSubmission, MissionStatus } from './types.js';
import { statusToA2ATaskState } from './types.js';

// Official SDK server abstractions (dynamic import to mirror the outbound
// FederationService pattern — production code that does not use A2A inbound
// does not pay the SDK load cost).
type AgentCard = import('@a2a-js/sdk').AgentCard;
type Task = import('@a2a-js/sdk').Task;
type Part = import('@a2a-js/sdk').Part;
type ExecutionEventBus = import('@a2a-js/sdk/server').ExecutionEventBus;
type RequestContext = import('@a2a-js/sdk/server').RequestContext;
type ServerCallContext = import('@a2a-js/sdk/server').ServerCallContext;
type User = import('@a2a-js/sdk/server').User;
type AgentExecutorInterface = import('@a2a-js/sdk/server').AgentExecutor;

/**
 * The A2A task-store record we keep in parallel with the SDK's
 * InMemoryTaskStore. We need this to map the SDK task id back to the
 * Genesis mission id and the authenticated caller — the SDK's
 * TaskStore is tenant-scoped, but our authorization boundary is the
 * API-key-derived callerId.
 */
interface TaskMissionBinding {
  readonly taskId: string;
  readonly missionId: string;
  readonly callerId: string;
  readonly abortController: AbortController;
}

/**
 * A GenesisAgentExecutor implements the SDK's AgentExecutor interface.
 * It translates A2A SendMessage requests into Genesis mission
 * submissions, runs the mission via the shared MissionService, and
 * publishes A2A task/artifact/status events on the ExecutionEventBus.
 *
 * Per Section 5: both HTTP API and inbound A2A call the SAME shared
 * MissionService. No second orchestration engine.
 */
class GenesisAgentExecutor implements AgentExecutorInterface {
  private readonly service: MissionService;
  private readonly bindings = new Map<string, TaskMissionBinding>();
  /**
   * The caller identity for the CURRENT request, set by the HTTP handler
   * before dispatching to the SDK. This bridges the gap where the SDK's
   * AgentExecutor.cancelTask() does not receive a RequestContext and
   * therefore cannot see who is calling. Cleared after each request.
   */
  private currentRequestCaller: CallerIdentity | null = null;

  constructor(service: MissionService) {
    this.service = service;
  }

  /**
   * Set the caller for the current request. Called by the HTTP handler
   * BEFORE dispatching to the SDK transport handler.
   */
  setCurrentRequestCaller(caller: CallerIdentity): void {
    this.currentRequestCaller = caller;
  }

  /**
   * Clear the current request caller after the request completes.
   */
  clearCurrentRequestCaller(): void {
    this.currentRequestCaller = null;
  }

  async execute(
    requestContext: RequestContext,
    eventBus: ExecutionEventBus,
  ): Promise<void> {
    const user = requestContext.context.user;
    const caller = extractCallerFromUser(user);
    if (caller === null) {
      // Should not happen — authenticateA2AUser rejects unknown keys before
      // the executor runs. Publish a FAILED task as a safety net.
      publishFailedTask(eventBus, requestContext.taskId);
      return;
    }

    // Extract the goal text from the incoming message parts.
    const parts = requestContext.userMessage.parts ?? [];
    const goalText = extractTextFromParts(parts);
    if (goalText.length === 0) {
      publishFailedTask(eventBus, requestContext.taskId);
      return;
    }

    // Translate the A2A message into a Genesis mission submission.
    // The SDK assigns the taskId; we use it directly as the mission id
    // (1:1 correlation) so GetTask/CancelTask map trivially.
    const taskId = requestContext.taskId;
    const submission: MissionSubmission = {
      outcome: goalText,
      idempotencyKey: `a2a:${caller.callerId}:${taskId}`,
      label: `a2a-task:${taskId}`,
    };

    // Create a per-task AbortController so CancelTask can abort the mission.
    const abortController = new AbortController();

    try {
      // Start the mission. The MissionService returns synchronously with
      // a missionId; the orchestrator runs in the background.
      const { missionId } = this.service.start(submission, caller);
      this.bindings.set(taskId, { taskId, missionId, callerId: caller.callerId, abortController });

      // Publish an initial WORKING status so the SDK's blocking sendMessage
      // returns a Task (not a Message). The SDK requires the first event
      // to be either a `task` or a `message` event.
      const initialTask = buildTask(taskId, 'RUNNING');
      eventBus.publish({ kind: 'task', data: initialTask });

      // Poll the mission until terminal. We poll the MissionService
      // snapshot (in-process, cheap) and publish status updates as the
      // mission progresses. The SDK's InMemoryTaskStore retains the last
      // task state for GetTask queries.
      const finalSnapshot = await this.pollToTerminal(taskId, missionId, caller, eventBus, abortController.signal);

      // Publish the terminal task state with artifacts.
      const terminalTask = buildTaskFromSnapshot(taskId, finalSnapshot);
      eventBus.publish({ kind: 'task', data: terminalTask });
    } catch {
      publishFailedTask(eventBus, taskId);
    } finally {
      this.bindings.delete(taskId);
    }
  }

  async cancelTask(taskId: string, eventBus: ExecutionEventBus): Promise<void> {
    const binding = this.bindings.get(taskId);
    if (binding === undefined) {
      // Task not found or already completed. Publish a terminal CANCELED
      // task so the caller sees a consistent state.
      eventBus.publish({ kind: 'task', data: buildTask(taskId, 'CANCELLED') });
      return;
    }

    // P1-A2A-CANCELTASK-NO-CALLER-AUTHZ fix: verify the requesting caller
    // owns this task. The currentRequestCaller is set by the HTTP handler
    // before dispatching to the SDK. If it doesn't match the binding's
    // original callerId, reject the cancellation.
    const requestingCaller = this.currentRequestCaller;
    if (requestingCaller === null) {
      // No caller context — should not happen (auth is enforced before
      // dispatch). Fail closed: do NOT cancel.
      eventBus.publish({ kind: 'task', data: buildTask(taskId, 'FAILED') });
      return;
    }
    if (requestingCaller.callerId !== binding.callerId) {
      // Cross-caller cancellation attempt. Return the current task state
      // without cancelling — do not leak that the task exists to a
      // different caller. The SDK will return whatever task state we
      // publish here.
      const snapshot = this.service.get(binding.missionId, {
        callerId: binding.callerId,
        allowedOperations: ['mission:submit'],
        maxActiveMissions: 999,
        maxMissionTimeoutMs: 300_000,
      }).status;
      eventBus.publish({ kind: 'task', data: buildTask(taskId, snapshot) });
      return;
    }

    // Authorized cancellation — proceed.
    binding.abortController.abort();
    const caller: CallerIdentity = {
      callerId: binding.callerId,
      allowedOperations: ['mission:submit', 'mission:cancel'],
      maxActiveMissions: 999,
      maxMissionTimeoutMs: 300_000,
    };
    try {
      this.service.cancel(binding.missionId, caller);
    } catch {
      // Mission may have already terminated; the publish below reflects
      // the binding's view.
    }
    eventBus.publish({ kind: 'task', data: buildTask(taskId, 'CANCELLATION_REQUESTED') });
  }

  private async pollToTerminal(
    taskId: string,
    missionId: string,
    caller: CallerIdentity,
    eventBus: ExecutionEventBus,
    signal: AbortSignal,
  ): Promise<{ status: MissionStatus; result?: { summary: string }; failureClass?: string; failureMessage?: string }> {
    // Poll until terminal. Use the MissionService's awaitCompletion for
    // efficiency, but check the abort signal between polls.
    const pollIntervalMs = 50;
    for (;;) {
      if (signal.aborted) {
        // The CancelTask handler aborted us. Wait briefly for the
        // MissionService to reflect the cancellation, then break.
        await new Promise((r) => setTimeout(r, 100));
      }
      const snapshot = this.service.get(missionId, caller);
      if (snapshot.terminal) {
        return snapshot;
      }
      await new Promise((r) => setTimeout(r, pollIntervalMs));
    }
  }

  /**
   * Look up a binding (used by tests to verify caller isolation).
   */
  getBinding(taskId: string): TaskMissionBinding | undefined {
    return this.bindings.get(taskId);
  }
}

/**
 * Start the A2A inbound server using the official SDK.
 */
export async function startA2AServer(
  service: MissionService,
  config: GatewayConfig,
): Promise<{ server: Server; url: string; agentCardUrl: string; executor: GenesisAgentExecutor }> {
  // Dynamic import of the official SDK server abstractions.
  const serverModule = await import('@a2a-js/sdk/server');
  const { DefaultRequestHandler, InMemoryTaskStore, JsonRpcTransportHandler, DefaultExecutionEventBusManager } = serverModule;

  const executor = new GenesisAgentExecutor(service);
  const taskStore = new InMemoryTaskStore();
  const eventBusManager = new DefaultExecutionEventBusManager();
  const agentCard = buildAgentCard(config);

  const requestHandler = new DefaultRequestHandler(
    agentCard,
    taskStore,
    executor,
    eventBusManager,
  );

  const transportHandler = new JsonRpcTransportHandler(requestHandler);

  const server = createServer(async (req, res) => {
    try {
      await handleA2ARequest(req, res, config, transportHandler, executor);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sendJson(res, 200, {
        jsonrpc: '2.0' as const,
        error: { code: -32603, message: `internal error: ${message}` },
        id: null,
      });
    }
  });

  const url = `http://${config.a2aHost}:${config.a2aPort}`;
  await new Promise<void>((resolve) => {
    server.listen(config.a2aPort, config.a2aHost, () => resolve());
  });
  return { server, url, agentCardUrl: `${url}/.well-known/agent-card.json`, executor };
}

/**
 * Handle a single A2A HTTP request: serve the agent card, or dispatch
 * JSON-RPC to the SDK's JsonRpcTransportHandler.
 */
async function handleA2ARequest(
  req: IncomingMessage,
  res: ServerResponse,
  config: GatewayConfig,
  transportHandler: import('@a2a-js/sdk/server').JsonRpcTransportHandler,
  executor: GenesisAgentExecutor,
): Promise<void> {
  // CORS (matches reference agent + outbound federation).
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

  // Serve the Agent Card (public — no auth required for discovery).
  if (path === '/.well-known/agent-card.json' && req.method === 'GET') {
    sendJson(res, 200, buildAgentCard(config));
    return;
  }

  // JSON-RPC endpoint.
  if ((path === '/' || path === '/a2a' || path === '/jsonrpc') && req.method === 'POST') {
    const body = await readBody(req, config.maxRequestBodyBytes);
    if (body === null) {
      sendJson(res, 200, {
        jsonrpc: '2.0' as const,
        error: { code: -32700, message: 'parse error: invalid or oversized JSON body' },
        id: null,
      });
      return;
    }

    // Authenticate the caller BEFORE dispatching to the SDK handler.
    // Per Section 10: A2A uses the same authorization boundary.
    const caller = authenticateA2A(req, config);
    if (caller === null) {
      sendJson(res, 200, {
        jsonrpc: '2.0' as const,
        error: { code: -32600, message: 'unauthorized: missing or invalid API key' },
        id: extractJsonRpcId(body),
      });
      return;
    }

    // Build a ServerCallContext carrying the authenticated user.
    // The SDK's DefaultRequestHandler passes this context to the
    // AgentExecutor via RequestContext.context.
    const serverModule = await import('@a2a-js/sdk/server');
    const context: ServerCallContext = buildServerCallContext(serverModule, caller);

    let parsedBody: string | Record<string, unknown>;
    try {
      parsedBody = JSON.parse(body) as Record<string, unknown>;
    } catch {
      parsedBody = body;
    }

    // Set the current request caller on the executor BEFORE dispatching
    // to the SDK. This bridges the gap where AgentExecutor.cancelTask()
    // does not receive a RequestContext.
    executor.setCurrentRequestCaller(caller);
    try {
      const result = await transportHandler.handle(parsedBody, context);

      // The SDK returns a single JSONRPCResponse for non-streaming methods
      // (SendMessage blocking, GetTask, CancelTask). Streaming methods
      // (sendMessageStream, subscribe) return an AsyncGenerator — we do
      // not support streaming in v1 (the AgentCard declares streaming:false).
      if (isAsyncGenerator(result)) {
        // Take the first response and discard the rest (no streaming in v1).
        const first = await result.next();
        if (first.done || first.value === undefined) {
          sendJson(res, 200, {
            jsonrpc: '2.0' as const,
            error: { code: -32603, message: 'no response from streaming method' },
            id: extractJsonRpcId(body),
          });
          return;
        }
        sendJson(res, 200, first.value);
        return;
      }

      sendJson(res, 200, result);
      return;
    } finally {
      executor.clearCurrentRequestCaller();
    }
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('not found');
}

/**
 * Stop the A2A inbound server.
 */
export function stopA2AServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

/**
 * Build the A2A Agent Card using the official SDK type.
 */
function buildAgentCard(config: GatewayConfig): AgentCard {
  return {
    name: config.agentName,
    description: config.agentDescription,
    version: '1.0.0',
    capabilities: { streaming: false, pushNotifications: false, extensions: [] },
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
  } as unknown as AgentCard;
}

/**
 * A User implementation that carries the authenticated CallerIdentity
 * through the SDK's ServerCallContext. The SDK's User interface uses
 * getters (isAuthenticated, userName); we implement a minimal class
 * that satisfies it and embeds the CallerIdentity for the executor.
 */
class AuthenticatedGatewayUser implements User {
  readonly caller: CallerIdentity;
  constructor(caller: CallerIdentity) {
    this.caller = caller;
  }
  get isAuthenticated(): boolean {
    return true;
  }
  get userName(): string {
    return this.caller.callerId;
  }
}

/**
 * Build a ServerCallContext carrying the authenticated caller as a User.
 */
function buildServerCallContext(
  serverModule: typeof import('@a2a-js/sdk/server'),
  caller: CallerIdentity,
): ServerCallContext {
  const user = new AuthenticatedGatewayUser(caller);
  return new serverModule.ServerCallContext({ user, tenant: '' } as ConstructorParameters<typeof serverModule.ServerCallContext>[0]);
}

/**
 * Extract the CallerIdentity from the SDK User object.
 */
function extractCallerFromUser(user: User | undefined): CallerIdentity | null {
  if (user === undefined) return null;
  if (user instanceof AuthenticatedGatewayUser) {
    return user.caller;
  }
  // For unknown User implementations, fall back to userName as callerId.
  if (user.isAuthenticated) {
    return {
      callerId: user.userName,
      allowedOperations: ['mission:submit'],
      maxActiveMissions: 5,
      maxMissionTimeoutMs: 30_000,
    };
  }
  return null;
}

/**
 * Authenticate the A2A caller via the Authorization: Bearer header.
 * Same mechanism as the HTTP API (constant-time comparison).
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
 * Extract text from A2A Message parts. Handles both wire format (top-level
 * `text` key) and in-memory format (`content: { $case: 'text', value }`).
 */
function extractTextFromParts(parts: readonly Part[] | readonly unknown[]): string {
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
 * Build an A2A Task object from a MissionSnapshot.
 */
function buildTaskFromSnapshot(taskId: string, snapshot: { status: MissionStatus; result?: { summary: string } }): Task {
  const state = statusToA2ATaskState(snapshot.status);
  const artifacts =
    snapshot.result && snapshot.result.summary.length > 0
      ? [
          {
            artifactId: `${taskId}-result`,
            name: 'Result',
            description: 'Genesis mission result',
            parts: [
              {
                text: snapshot.result.summary,
                filename: '',
                mediaType: 'text/plain',
              },
            ],
            metadata: undefined,
            extensions: [],
          },
        ]
      : [];
  return {
    id: taskId,
    contextId: taskId,
    status: {
      state,
      message: undefined,
      timestamp: new Date().toISOString(),
    },
    artifacts,
    history: [],
    metadata: undefined,
  } as unknown as Task;
}

function buildTask(taskId: string, status: MissionStatus): Task {
  return {
    id: taskId,
    contextId: taskId,
    status: {
      state: statusToA2ATaskState(status),
      message: undefined,
      timestamp: new Date().toISOString(),
    },
    artifacts: [],
    history: [],
    metadata: undefined,
  } as unknown as Task;
}

function publishFailedTask(eventBus: ExecutionEventBus, taskId: string): void {
  const failedTask: Task = {
    id: taskId,
    contextId: taskId,
    status: {
      state: 4, // TASK_STATE_FAILED
      message: undefined,
      timestamp: new Date().toISOString(),
    },
    artifacts: [],
    history: [],
    metadata: undefined,
  } as unknown as Task;
  eventBus.publish({ kind: 'task', data: failedTask });
}

function isAsyncGenerator(value: unknown): value is AsyncGenerator<unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as AsyncGenerator<unknown>).next === 'function' &&
    typeof (value as AsyncGenerator<unknown>).return === 'function'
  );
}

function extractJsonRpcId(body: string): unknown {
  try {
    const parsed = JSON.parse(body) as { id?: unknown };
    return parsed.id ?? null;
  } catch {
    return null;
  }
}

async function readBody(req: IncomingMessage, maxBytes: number): Promise<string | null> {
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
      resolve(Buffer.concat(chunks).toString('utf8'));
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

// Re-export for tests.
export { GenesisAgentExecutor };
