/**
 * G6-02 — A2A FederationService.
 *
 * The EDGE adapter between Genesis organizational work and external
 * independent A2A agents. Wraps the official @a2a-js/sdk ClientFactory
 * and Client; maps A2A Task states to Genesis FederationResult; emits
 * federation events to a sink; maps failures to the G6-01 FailureClass
 * taxonomy.
 *
 * Per Section 1: A2A lives at the EDGE. This service does NOT replace
 * internal handoffs, WorkerGenome, MissionOrchestrator, OpenBot,
 * OpenDots, OpenMuse, or MCP. It is a mission-level federation service
 * that the orchestrator (or a worker with federation capability) can
 * OPTIONALLY invoke.
 *
 * Per Section 13: CONFIGURE → REUSE. The official SDK performs all
 * protocol work (transport, session, JSON-RPC, discovery). Genesis
 * wraps; it does not reinvent.
 *
 * Per Section 23: A2A RESULT ≠ VERIFIED GENESIS FACT. This service
 * returns FederationResult with the external agent's reported status.
 * Genesis verification remains authoritative — the caller MUST subject
 * `result` to VerificationLoop before treating it as mission truth.
 *
 * Per Section 24: reuse the G6-01 failure taxonomy. A2A failures map
 * to PROVIDER_FAILURE, WORKER_FAILURE, TIMEOUT, CANCELLED, or
 * UNKNOWN_FAILURE. No second failure ontology.
 *
 * Per Section 26: conservative retry. sendMessage is NOT retried
 * (creates duplicate remote tasks). getTask polls are retried up to
 * the delegation timeout (read-only, idempotent).
 *
 * Anti-reimplementation (Section 13): transport, session, JSON-RPC,
 * HTTP, and discovery are ALL owned by @a2a-js/sdk. This file is the
 * smallest Genesis ownership per Section 14.
 */

import type { Client } from '@a2a-js/sdk/client';
import type { AgentCard, Task, TaskState } from '@a2a-js/sdk';
import { TaskState as TaskStateEnum } from '@a2a-js/sdk';
import { classifyError, type FailureClass } from '../../mission/failure-class.js';
import {
  buildFailureResult,
  buildSuccessResult,
  externalAgentId,
  type ExternalAgent,
  type FederationEvent,
  type FederationEventSink,
  type FederationRequest,
  type FederationResult,
  type FederationStatus,
} from './types.js';

/**
 * The minimal subset of the A2A ClientFactory that FederationService
 * consumes. Defined as a local interface so tests can substitute a
 * stub without depending on the SDK's concrete ClientFactory class.
 */
export interface FederationClientFactory {
  /** Fetch the AgentCard from the endpoint and build an ExternalAgent. */
  resolveAgent(endpoint: string): Promise<{ agent: ExternalAgent; card: AgentCard }>;
  /** Build (or fetch a cached) Client for the endpoint. */
  clientFor(endpoint: string, card: AgentCard): Promise<Client>;
}

/**
 * The FederationService. Construct with a FederationClientFactory
 * (injected so tests can substitute a stub). Call `discover()` to
 * resolve an ExternalAgent from an endpoint URL, or `delegate()` to
 * send a bounded task to an already-discovered agent.
 *
 * The service is OPTIONAL — missions without federation needs do not
 * construct it. The orchestrator remains protocol-neutral (Section 33).
 *
 * Lifecycle:
 *   const service = new FederationService({ clientFactory, onEvent });
 *   const agent = await service.discover('http://127.0.0.1:4173');
 *   const result = await service.delegate({ agent, task: '...', missionId });
 *   // result.status === 'completed' → subject result to Genesis verification
 */
export class FederationService {
  private readonly factory: FederationClientFactory;
  private readonly onEvent?: FederationEventSink;
  private readonly pollIntervalMs: number;
  private readonly discovered = new Map<string, { agent: ExternalAgent; card: AgentCard }>();
  private readonly clients = new Map<string, Client>();

  constructor(options: {
    readonly clientFactory: FederationClientFactory;
    readonly onEvent?: FederationEventSink;
    /** Polling interval for getTask() (default 500ms). */
    readonly pollIntervalMs?: number;
  }) {
    this.factory = options.clientFactory;
    this.onEvent = options.onEvent;
    this.pollIntervalMs = options.pollIntervalMs ?? 500;
  }

  /**
   * Discover an external A2A agent by fetching its AgentCard from the
   * well-known endpoint. Returns an ExternalAgent with stable identity
   * (Section 17). Caches the discovery result for reuse.
   *
   * Per Section 18: only the discovery needed for a bounded federation
   * path. No marketplace, no global registry, no search engine.
   */
  async discover(endpoint: string): Promise<ExternalAgent> {
    const cached = this.discovered.get(endpoint);
    if (cached !== undefined) return cached.agent;
    const { agent, card } = await this.factory.resolveAgent(endpoint);
    this.discovered.set(endpoint, { agent, card });
    return agent;
  }

  /**
   * Delegate bounded work to an external A2A agent. Sends a message,
   * polls the task to terminal state, and returns a FederationResult
   * with provenance.
   *
   * Per Section 20: this is the primary required direction (outbound
   * federation). Per Section 25: bounded by timeoutMs and the local
   * AbortSignal. Per Section 26: sendMessage is NOT retried.
   */
  async delegate(request: FederationRequest): Promise<FederationResult> {
    const { agent, task, missionId } = request;
    const timeoutMs = request.timeoutMs ?? 30_000;
    const signal = request.signal;

    const cached = this.discovered.get(agent.endpoint);
    if (cached === undefined) {
      return buildFailureResult(
        agent,
        '',
        'failed',
        'CONFIGURATION_FAILURE',
        `agent at "${agent.endpoint}" not discovered — call discover() first`,
      );
    }
    let client = this.clients.get(agent.endpoint);
    if (client === undefined) {
      client = await this.factory.clientFor(agent.endpoint, cached.card);
      this.clients.set(agent.endpoint, client);
    }

    // Send the message. Per Section 26: NOT retried — creates duplicate tasks.
    // The SDK's sendMessage returns `Message | Task` directly (not wrapped).
    // A Task has a `status` field; a Message has a `messageId` field and no `status`.
    let sendResult: unknown;
    try {
      sendResult = await client.sendMessage({
        message: {
          messageId: `genesis-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          contextId: '',
          taskId: '',
          role: 1, // ROLE_USER
          parts: [
            {
              content: { $case: 'text', value: task },
              metadata: undefined,
              filename: '',
              mediaType: 'text/plain',
            },
          ],
          metadata: undefined,
          extensions: [],
          referenceTaskIds: [],
        },
        configuration: undefined,
        metadata:
          request.constraints === undefined || request.constraints.length === 0
            ? undefined
            : { constraints: request.constraints.join('; ') },
        tenant: '',
      });
    } catch (error) {
      const cls = classifyError(error);
      this.emitFailure(agent, '', cls, `sendMessage failed: ${(error as Error).message.slice(0, 200)}`, missionId);
      return buildFailureResult(agent, '', 'failed', cls, `sendMessage failed: ${(error as Error).message.slice(0, 200)}`);
    }

    // The SDK returns either a Message (synchronous reply) or a Task
    // (asynchronous, requires polling). For federation we expect a Task;
    // a Message reply is treated as a completed task with the message
    // text as the result.
    const sentTask = this.extractTask(sendResult);
    if (sentTask === undefined) {
      // Synchronous message reply — treat as completed.
      const resultText = this.extractTextFromParts(
        (sendResult as { parts?: ReadonlyArray<{ content?: { $case?: string; value?: unknown } }> })?.parts ?? [],
      );
      this.emit({
        type: 'federation-result-received',
        missionId,
        remoteTaskId: '',
        status: 'completed' as FederationStatus,
        resultChars: resultText.length,
        evidenceCount: resultText.length > 0 ? 1 : 0,
      });
      return buildSuccessResult(agent, '', resultText, missionId);
    }

    const remoteTaskId = sentTask.id;
    this.emit({
      type: 'federation-delegated',
      missionId,
      externalAgentId: agent.id,
      externalAgentName: agent.name,
      remoteTaskId,
      taskChars: task.length,
    });

    // If the task is already terminal, return immediately without polling.
    const state = sentTask.status?.state ?? TaskStateEnum.TASK_STATE_UNSPECIFIED;
    if (this.isTerminal(state)) {
      return this.toResult(agent, sentTask, state, missionId);
    }

    // Poll the task to terminal state.
    return this.pollToTerminal(client, remoteTaskId, timeoutMs, signal, missionId, agent);
  }

  /**
   * Cancel a remote task. Best-effort per Section 25. Used by the
   * delegate() method when the local AbortSignal fires; can also be
   * called directly by the caller.
   */
  async cancel(agent: ExternalAgent, remoteTaskId: string, missionId?: string): Promise<void> {
    const client = this.clients.get(agent.endpoint);
    if (client === undefined || remoteTaskId === '') return;
    try {
      await client.cancelTask({ id: remoteTaskId, tenant: '', metadata: undefined });
      this.emit({
        type: 'federation-cancelled',
        missionId,
        remoteTaskId,
        reason: 'caller requested cancellation',
      });
    } catch (error) {
      // Best-effort — a failing cancel does not mask the real outcome.
      this.emit({
        type: 'federation-failed',
        missionId,
        remoteTaskId,
        failureClass: 'PROVIDER_FAILURE',
        message: `cancelTask failed: ${(error as Error).message.slice(0, 160)}`,
      });
    }
  }

  // -- Private helpers ----------------------------------------------------

  private async pollToTerminal(
    client: Client,
    taskId: string,
    timeoutMs: number,
    signal: AbortSignal | undefined,
    missionId: string | undefined,
    agent: ExternalAgent,
  ): Promise<FederationResult> {
    const deadline = Date.now() + timeoutMs;
    let lastState: TaskState = TaskStateEnum.TASK_STATE_UNSPECIFIED;

    while (Date.now() < deadline) {
      if (signal?.aborted) {
        await this.cancel(agent, taskId, missionId);
        return buildFailureResult(agent, taskId, 'canceled', 'CANCELLED', 'local mission aborted');
      }
      let task: Task;
      try {
        task = await client.getTask({ id: taskId, tenant: '', historyLength: 0 });
      } catch (error) {
        const cls = classifyError(error);
        this.emitFailure(agent, taskId, cls, `getTask failed: ${(error as Error).message.slice(0, 200)}`, missionId);
        return buildFailureResult(agent, taskId, 'failed', cls, `getTask failed: ${(error as Error).message.slice(0, 200)}`);
      }
      const state = task.status?.state ?? TaskStateEnum.TASK_STATE_UNSPECIFIED;
      if (state !== lastState) {
        lastState = state;
        this.emit({
          type: 'federation-state-change',
          missionId,
          remoteTaskId: taskId,
          remoteState: this.stateName(state),
        });
      }
      if (this.isTerminal(state)) {
        return this.toResult(agent, task, state, missionId);
      }
      await sleep(this.pollIntervalMs);
    }

    // Timeout — cancel the remote task and return TIMEOUT.
    await this.cancel(agent, taskId, missionId);
    this.emitFailure(agent, taskId, 'TIMEOUT', `delegation timed out after ${timeoutMs}ms`, missionId);
    return buildFailureResult(agent, taskId, 'timed_out', 'TIMEOUT', `delegation timed out after ${timeoutMs}ms`);
  }

  private isTerminal(state: TaskState): boolean {
    return (
      state === TaskStateEnum.TASK_STATE_COMPLETED ||
      state === TaskStateEnum.TASK_STATE_FAILED ||
      state === TaskStateEnum.TASK_STATE_CANCELED ||
      state === TaskStateEnum.TASK_STATE_REJECTED
    );
  }

  private stateName(state: TaskState): string {
    return TaskStateEnum[state] ?? `UNKNOWN(${state})`;
  }

  private toResult(
    agent: ExternalAgent,
    task: Task,
    state: TaskState,
    missionId: string | undefined,
  ): FederationResult {
    const status: FederationStatus = this.mapStatus(state);
    if (status === 'completed') {
      const resultText = this.extractResultText(task);
      this.emit({
        type: 'federation-result-received',
        missionId,
        remoteTaskId: task.id,
        status,
        resultChars: resultText.length,
        evidenceCount: resultText.length > 0 ? 1 : 0,
      });
      return buildSuccessResult(agent, task.id, resultText, missionId);
    }
    const failureClass = this.mapFailureClass(state, status);
    const failureMessage = this.extractFailureMessage(task, status);
    this.emitFailure(agent, task.id, failureClass, failureMessage, missionId);
    return buildFailureResult(agent, task.id, status, failureClass, failureMessage);
  }

  private mapStatus(state: TaskState): FederationStatus {
    switch (state) {
      case TaskStateEnum.TASK_STATE_COMPLETED:
        return 'completed';
      case TaskStateEnum.TASK_STATE_FAILED:
        return 'failed';
      case TaskStateEnum.TASK_STATE_CANCELED:
        return 'canceled';
      case TaskStateEnum.TASK_STATE_REJECTED:
        return 'failed';
      default:
        return 'unknown';
    }
  }

  private mapFailureClass(state: TaskState, status: FederationStatus): FailureClass {
    if (status === 'canceled') return 'CANCELLED';
    if (state === TaskStateEnum.TASK_STATE_REJECTED) return 'WORKER_FAILURE';
    if (status === 'unknown') return 'UNKNOWN_FAILURE';
    return 'WORKER_FAILURE';
  }

  private extractFailureMessage(task: Task, status: FederationStatus): string {
    const statusMessage = task.status?.message;
    const text = this.extractTextFromParts(statusMessage?.parts ?? []);
    if (text.length > 0) return `remote task ${status}: ${text.slice(0, 200)}`;
    return `remote task ${status} (state=${this.stateName(task.status?.state ?? 0)})`;
  }

  private extractResultText(task: Task): string {
    // Concatenate all text parts from all artifacts.
    const parts: string[] = [];
    for (const artifact of task.artifacts ?? []) {
      parts.push(this.extractTextFromParts(artifact.parts ?? []));
    }
    return parts.join('\n').trim();
  }

  /**
   * Extract text from a list of A2A Parts. The Part.content is a
   * discriminated union ($case: 'text' | 'raw' | 'url' | 'data'); we
   * only collect text parts and ignore the others. The parameter is
   * typed loosely to accept the SDK's Part type without dragging its
   * full union into the function signature.
   */
  private extractTextFromParts(
    parts: ReadonlyArray<{
      content?: { $case?: string; value?: unknown };
    }>,
  ): string {
    const texts: string[] = [];
    for (const part of parts) {
      const content = part.content;
      if (content?.$case === 'text' && typeof content.value === 'string') {
        texts.push(content.value);
      }
    }
    return texts.join('\n');
  }

  /**
   * Extract a Task from the sendMessage return value. The SDK returns
   * `Message | Task` directly. A Task has a `status` field; a Message
   * has a `messageId` field and no `status`. Returns undefined when the
   * result is a Message (synchronous reply).
   */
  private extractTask(result: unknown): Task | undefined {
    if (typeof result !== 'object' || result === null) return undefined;
    const maybeTask = result as { status?: unknown; id?: unknown };
    if (maybeTask.status !== undefined && typeof maybeTask.id === 'string') {
      return result as Task;
    }
    return undefined;
  }

  private emit(event: FederationEvent): void {
    this.onEvent?.(event);
  }

  private emitFailure(
    agent: ExternalAgent,
    remoteTaskId: string,
    failureClass: FailureClass,
    message: string,
    missionId?: string,
  ): void {
    this.emit({
      type: 'federation-failed',
      missionId,
      remoteTaskId,
      failureClass,
      message,
    });
    void agent;
  }
}

/** Sleep helper. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * A FederationClientFactory backed by the official @a2a-js/sdk
 * ClientFactory and DefaultAgentCardResolver. The SDK is imported
 * dynamically so production code that does not use federation does
 * not pay the SDK load cost (mirrors the MCP adapter pattern).
 */
export class SdkFederationClientFactory implements FederationClientFactory {
  private readonly clientFactory: {
    createFromAgentCard(card: AgentCard): Promise<Client>;
  };
  private readonly cardResolver: {
    resolve(baseUrl: string, path?: string): Promise<AgentCard>;
  };

  constructor(deps: {
    clientFactory: { createFromAgentCard(card: AgentCard): Promise<Client> };
    cardResolver: { resolve(baseUrl: string, path?: string): Promise<AgentCard> };
  }) {
    this.clientFactory = deps.clientFactory;
    this.cardResolver = deps.cardResolver;
  }

  async resolveAgent(endpoint: string): Promise<{ agent: ExternalAgent; card: AgentCard }> {
    const card = await this.cardResolver.resolve(endpoint);
    return { agent: this.buildAgentFromCard(endpoint, card), card };
  }

  async clientFor(endpoint: string, card: AgentCard): Promise<Client> {
    void endpoint; // the card already carries the interface URL
    return this.clientFactory.createFromAgentCard(card);
  }

  private buildAgentFromCard(endpoint: string, card: AgentCard): ExternalAgent {
    return {
      id: externalAgentId(endpoint),
      name: card.name,
      endpoint,
      declaredSkills: (card.skills ?? []).map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
      })),
      protocolVersion: card.version,
    };
  }
}

/**
 * Construct a FederationService backed by the official @a2a-js/sdk.
 * The SDK is imported dynamically so production code that does not
 * use federation does not pay the SDK load cost.
 */
export async function createFederationService(
  onEvent?: FederationEventSink,
): Promise<FederationService> {
  const { ClientFactory, DefaultAgentCardResolver, JsonRpcTransportFactory } = await import(
    '@a2a-js/sdk/client'
  );
  const clientFactory = new ClientFactory({
    transports: [new JsonRpcTransportFactory()],
  });
  const cardResolver = new DefaultAgentCardResolver();
  const factory = new SdkFederationClientFactory({ clientFactory, cardResolver });
  return new FederationService({ clientFactory: factory, onEvent });
}
