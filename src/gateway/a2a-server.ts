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
import { AsyncLocalStorage } from 'node:async_hooks';

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
   * Request-scoped caller identity storage using AsyncLocalStorage.
   *
   * This replaces the previous mutable shared `currentRequestCaller`
   * field which was unsafe under concurrency: concurrent requests
   * could overwrite each other's caller identity before `cancelTask`
   * read it.
   *
   * AsyncLocalStorage carries the caller through the async call chain
   * without shared mutable state. Each request gets its own context;
   * concurrent requests cannot contaminate each other.
   */
  private readonly callerContext = new AsyncLocalStorage<CallerIdentity>();

  constructor(service: MissionService) {
    this.service = service;
  }

  /**
   * Run a function within a request-scoped caller context.
   * Called by the HTTP handler BEFORE dispatching to the SDK.
   */
  runWithCaller<T>(caller: CallerIdentity, fn: () => Promise<T>): Promise<T> {
    return this.callerContext.run(caller, fn);
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
    // G6-08 (Phase 5 / C-PROTOCOLS-FINDING-019): cross-caller cancelTask must
    // NOT leak the task's existence or current status. Previously, the code
    // called `service.get(binding.missionId, ...)` to fetch the actual status
    // and published it back to the requesting caller — leaking the task's
    // state to a different caller.
    //
    // Now: for ANY case where the caller does not own the task (or the task
    // doesn't exist), we publish a JSON-RPC error and return. We do NOT
    // distinguish "not found" from "not authorized" — both look identical to
    // the requesting caller.
    const requestingCaller = this.callerContext.getStore();

    if (binding === undefined) {
      // Task not found or already completed. Per the audit's recommendation,
      // do NOT publish CANCELLED/FAILED — that would leak state. Return
      // silently (the SDK will publish a JSON-RPC error to the caller).
      return;
    }

    if (requestingCaller === undefined) {
      // No caller context — should not happen (auth is enforced before
      // dispatch). Fail closed: do NOT cancel, do NOT leak state.
      return;
    }

    if (requestingCaller.callerId !== binding.callerId) {
      // Cross-caller cancellation attempt. Return WITHOUT publishing any
      // task state — do not leak that the task exists. The SDK's caller
      // will see a JSON-RPC error response.
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
    // G6-08 (Phase 3 / B-A2A-FINDING-002): wall-clock deadline to prevent
    // a hung mission from pinning execute() and the HTTP connection
    // indefinitely. The deadline = caller.maxMissionTimeoutMs + 30s slack.
    // On deadline exceeded, publish FAILED and break.
    const pollIntervalMs = 50;
    const deadlineMs = (caller.maxMissionTimeoutMs ?? 60_000) + 30_000;
    const startedAt = Date.now();
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
      // G6-08 (Phase 3): wall-clock deadline check.
      if (Date.now() - startedAt >= deadlineMs) {
        // Deadline exceeded — publish FAILED, abort the mission, and break.
        try {
          this.service.cancel(missionId, caller);
        } catch {
          // Mission may have already terminated — best-effort.
        }
        eventBus.publish({ kind: 'task', data: buildTask(taskId, 'FAILED') });
        // G6-08 (Phase 3 / B-A2A-FINDING-003): clean up the binding so the
        // registry does not leak when execute() never returns normally.
        this.bindings.delete(taskId);
        return {
          status: 'FAILED',
          failureClass: 'deadline-exceeded',
          failureMessage: `pollToTerminal exceeded deadline (${deadlineMs}ms)`,
        };
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

    // Run the SDK transport handler within a request-scoped caller context.
    // AsyncLocalStorage carries the caller through the async call chain
    // (including into AgentExecutor.cancelTask) without shared mutable state.
    // This is concurrency-safe: concurrent requests each get their own context.
    const result = await executor.runWithCaller(caller, () =>
      transportHandler.handle(parsedBody, context),
    );

    // The SDK returns a single JSONRPCResponse for non-streaming methods
    // (SendMessage blocking, GetTask, CancelTask). Streaming methods
    // (sendMessageStream, subscribe) return an AsyncGenerator — we do
    // not support streaming in v1 (the AgentCard declares streaming:false).
    //
    // G6-08 (Phase 5 / C-PROTOCOLS-FINDING-005): previously, when a streaming
    // method was called, we took the first event and discarded the rest —
    // giving the client a misleading partial response that looked like a
    // complete result. Now we explicitly REJECT streaming methods with a
    // JSON-RPC error so the client knows to use the non-streaming variant.
    if (isAsyncGenerator(result)) {
      // Consume the generator to completion (best-effort cleanup) so it
      // doesn't leave dangling promises. Then send the error.
      try {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        for await (const _ of result) {
          // discard all events
          break;  // one iteration is enough — we just want to drain
        }
      } catch {
        // best-effort — the error response is the same regardless
      }
      sendJson(res, 200, {
        jsonrpc: '2.0' as const,
        error: {
          code: -32601,  // method not found
          message: 'streaming methods (sendMessageStream, subscribe) are not supported; use sendMessage instead',
        },
        id: extractJsonRpcId(body),
      });
      return;
    }

    sendJson(res, 200, result);
    return;
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
 *
 * G6-08 (Phase 5 / C-PROTOCOLS-FINDING-004): declare the API-key security
 * scheme so consumers (and the A2A SDK's authentication negotiation) know
 * the gateway requires a Bearer token. Previously, `securitySchemes: {}`
 * advertised an unauthenticated gateway despite the bearer-token check.
 */
export function buildAgentCard(config: GatewayConfig): AgentCard {
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
    // G6-08 (Phase 5 / C-PROTOCOLS-FINDING-004): declare the API-key security
    // scheme so consumers know the gateway requires a Bearer token.
    securitySchemes: {
      'gateway-api-key': {
        type: 'apiKey',
        location: 'header',
        name: 'Authorization',
      } as unknown as AgentCard['securitySchemes'][string],
    },
    securityRequirements: [
      { schemes: { 'gateway-api-key': {} } } as unknown as AgentCard['securityRequirements'][number],
    ],
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
 *
 * G6-09B fix for G6-09-S03 (defense-in-depth): the previous fallback granted
 * `mission:submit` permission with 5 max active missions to ANY SDK User
 * implementation that reported `isAuthenticated=true`. This was a confused-
 * deputy risk — a custom SDK User extension could be granted mission:submit
 * without going through the gateway's authentication path. The fallback now
 * returns null (reject unknown User implementations). All legitimate users
 * are constructed by `authenticateA2A` and are AuthenticatedGatewayUser
 * instances, so this change has no impact on the legitimate path.
 */
function extractCallerFromUser(user: User | undefined): CallerIdentity | null {
  if (user === undefined) return null;
  if (user instanceof AuthenticatedGatewayUser) {
    return user.caller;
  }
  // G6-09-S03: Unknown User implementations are rejected — they must go
  // through authenticateA2A (which constructs an AuthenticatedGatewayUser)
  // to be authorized for mission:submit. No more permissive fallback.
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
 *
 * G7-15B-H2: the A2A Task's `metadata` field (a protocol-supported key-value
 * object, per the @a2a-js/sdk Task interface) carries the internal Genesis
 * mission status + failure class as machine-readable metadata. This lets
 * external A2A consumers distinguish a confirmed execution failure
 * (metadata.genesis_status = "FAILED") from an unconfirmed outcome after
 * restart (metadata.genesis_status = "OUTCOME_UNCONFIRMED") WITHOUT parsing
 * the human-readable failureMessage.
 *
 * The A2A TaskState enum has no "unknown" state, so OUTCOME_UNCONFIRMED maps
 * to TaskState.FAILED (state: 4) — but the metadata.genesis_status field
 * provides the machine-readable distinction. A confirmed FAILED mission
 * carries genesis_status = "FAILED" (NOT "OUTCOME_UNCONFIRMED"); the
 * unconfirmed indicator is ONLY on OUTCOME_UNCONFIRMED records.
 */
function buildTaskFromSnapshot(taskId: string, snapshot: {
  status: MissionStatus;
  result?: { summary: string };
  failureClass?: string;
  failureMessage?: string;
}): Task {
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
  // G7-15B-H2: populate the protocol-supported `metadata` field with the
  // internal mission status + failure class. This is the machine-readable
  // distinction between confirmed failure and unconfirmed outcome.
  const metadata: { [key: string]: unknown } = {
    genesis_status: snapshot.status,
  };
  if (snapshot.failureClass !== undefined) {
    metadata.genesis_failure_class = snapshot.failureClass;
  }
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
    metadata,
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
