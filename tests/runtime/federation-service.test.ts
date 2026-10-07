import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import {
  FederationService,
  type FederationClientFactory,
} from '../../src/runtime/federation/service.js';
import type { Client } from '@a2a-js/sdk/client';
import type { AgentCard, Task, TaskState } from '@a2a-js/sdk';
import { TaskState as TaskStateEnum } from '@a2a-js/sdk';
import {
  buildSuccessResult,
  buildFailureResult,
  externalAgentId,
  type ExternalAgent,
  type FederationEvent,
  type FederationResult,
} from '../../src/runtime/federation/types.js';

/**
 * G6-02 — FederationService unit tests.
 *
 * These tests verify the mapping/state/failure semantics of the
 * FederationService using stub clients (no real network). The real
 * protocol-level interoperability is proven by the integration tests
 * in federation-integration.test.ts.
 *
 * Per Section 50: required test areas covered:
 *   - external identity mapping
 *   - task delegation
 *   - status mapping
 *   - result mapping
 *   - failure mapping
 *   - timeout/cancellation semantics
 *   - provenance
 *   - event emission
 *   - external success ≠ Genesis verification success
 *   - malformed result
 *   - internal Worker ≠ external Agent identity
 */

// -- Stubs ----------------------------------------------------------------

class StubClient implements Pick<Client, 'sendMessage' | 'getTask' | 'cancelTask'> {
  readonly calls: Array<{ method: string; args: unknown }> = [];
  private readonly taskBehavior: (taskId: string, inputText: string) => Task;

  constructor(taskBehavior: (taskId: string, inputText: string) => Task) {
    this.taskBehavior = taskBehavior;
  }

  /**
   * The SDK's sendMessage returns `Message | Task` directly.
   * The stub returns a Task directly (matching what the reference agent
   * returns over the real wire protocol).
   */
  async sendMessage(params: unknown): Promise<Task> {
    this.calls.push({ method: 'sendMessage', args: params });
    const taskId = `stub-task-${this.calls.length}`;
    const inputText = extractTextFromParams(params);
    return this.taskBehavior(taskId, inputText);
  }

  async getTask(params: unknown): Promise<Task> {
    const id = (params as { id: string }).id;
    this.calls.push({ method: 'getTask', args: params });
    return this.taskBehavior(id, 'stub-input');
  }

  async cancelTask(params: unknown): Promise<Task> {
    const id = (params as { id: string }).id;
    this.calls.push({ method: 'cancelTask', args: params });
    return buildStubTask(id, TaskStateEnum.TASK_STATE_CANCELED, '');
  }
}

function extractTextFromParams(params: unknown): string {
  const message = (params as { message?: { parts?: Array<{ content?: { $case?: string; value?: unknown } }> } }).message;
  const parts = message?.parts ?? [];
  const texts: string[] = [];
  for (const part of parts) {
    if (part.content?.$case === 'text' && typeof part.content.value === 'string') {
      texts.push(part.content.value);
    }
  }
  return texts.join('\n');
}

function buildStubTask(id: string, state: TaskState, resultText: string): Task {
  return {
    id,
    contextId: id,
    status: { state, message: undefined, timestamp: new Date().toISOString() },
    artifacts:
      resultText === ''
        ? []
        : [
            {
              artifactId: `${id}-result`,
              name: 'Result',
              description: '',
              parts: [
                {
                  content: { $case: 'text', value: resultText },
                  metadata: undefined,
                  filename: '',
                  mediaType: 'text/plain',
                },
              ],
              metadata: undefined,
              extensions: [],
            },
          ],
    history: [],
    metadata: undefined,
  };
}

function buildStubCard(endpoint: string): AgentCard {
  return {
    name: 'Stub Agent',
    description: 'test stub',
    version: '1.0.0',
    supportedInterfaces: [
      { url: endpoint, protocolBinding: 'JSONRPC', protocolVersion: '1.0', tenant: '' },
    ],
    provider: { url: '', organization: '' },
    capabilities: { extensions: [] },
    skills: [{ id: 'test', name: 'Test', description: '', tags: [], examples: [], inputModes: [], outputModes: [], securityRequirements: [] }],
    defaultInputModes: [],
    defaultOutputModes: [],
    securitySchemes: {},
    securityRequirements: [],
    signatures: [],
  };
}

function buildStubFactory(client: StubClient, endpoint: string): FederationClientFactory {
  const agent: ExternalAgent = {
    id: externalAgentId(endpoint),
    name: 'Stub Agent',
    endpoint,
    declaredSkills: [{ id: 'test', name: 'Test', description: '' }],
    protocolVersion: '1.0.0',
  };
  const card = buildStubCard(endpoint);
  return {
    resolveAgent: async () => ({ agent, card }),
    clientFor: async () => client as unknown as Client,
  };
}

// -- Tests ----------------------------------------------------------------

describe('G6-02 FederationService — unit tests (stub client)', () => {
  const endpoint = 'http://127.0.0.1:4173';

  it('discover() returns an ExternalAgent with stable identity', async () => {
    const client = new StubClient((id) => buildStubTask(id, TaskStateEnum.TASK_STATE_COMPLETED, 'ok'));
    const service = new FederationService({ clientFactory: buildStubFactory(client, endpoint) });
    const agent = await service.discover(endpoint);
    expect(agent.id).toBe(externalAgentId(endpoint));
    expect(agent.name).toBe('Stub Agent');
    expect(agent.endpoint).toBe(endpoint);
    expect(agent.protocolVersion).toBe('1.0.0');
    expect(agent.declaredSkills).toHaveLength(1);
  });

  it('delegate() returns a completed FederationResult with provenance', async () => {
    const client = new StubClient((id) =>
      buildStubTask(id, TaskStateEnum.TASK_STATE_COMPLETED, 'sha256-result-here'),
    );
    const events: FederationEvent[] = [];
    const service = new FederationService({
      clientFactory: buildStubFactory(client, endpoint),
      onEvent: (e) => events.push(e),
    });
    const agent = await service.discover(endpoint);
    const result = await service.delegate({
      agent,
      task: 'compute hash of this input',
      missionId: 'test-mission-1',
    });
    expect(result.ok).toBe(true);
    expect(result.status).toBe('completed');
    expect(result.result).toBe('sha256-result-here');
    expect(result.remoteTaskId).toMatch(/^stub-task-/);
    expect(result.agent.id).toBe(agent.id);
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0].location).toBe(`a2a:${agent.id}:${result.remoteTaskId}`);
    // Events: delegated + state-change (if polled) + result-received
    const types = events.map((e) => e.type);
    expect(types).toContain('federation-delegated');
    expect(types).toContain('federation-result-received');
  });

  it('maps TASK_STATE_FAILED to WORKER_FAILURE', async () => {
    const client = new StubClient((id) => buildStubTask(id, TaskStateEnum.TASK_STATE_FAILED, ''));
    const events: FederationEvent[] = [];
    const service = new FederationService({
      clientFactory: buildStubFactory(client, endpoint),
      onEvent: (e) => events.push(e),
      pollIntervalMs: 0,
    });
    const agent = await service.discover(endpoint);
    const result = await service.delegate({ agent, task: 'fail please' });
    expect(result.ok).toBe(false);
    expect(result.status).toBe('failed');
    expect(result.failureClass).toBe('WORKER_FAILURE');
    expect(events.some((e) => e.type === 'federation-failed')).toBe(true);
  });

  it('maps TASK_STATE_CANCELED to CANCELLED', async () => {
    const client = new StubClient((id) => buildStubTask(id, TaskStateEnum.TASK_STATE_CANCELED, ''));
    const service = new FederationService({
      clientFactory: buildStubFactory(client, endpoint),
      pollIntervalMs: 0,
    });
    const agent = await service.discover(endpoint);
    const result = await service.delegate({ agent, task: 'cancel please' });
    expect(result.ok).toBe(false);
    expect(result.status).toBe('canceled');
    expect(result.failureClass).toBe('CANCELLED');
  });

  it('maps TASK_STATE_REJECTED to WORKER_FAILURE (failed)', async () => {
    const client = new StubClient((id) => buildStubTask(id, TaskStateEnum.TASK_STATE_REJECTED, ''));
    const service = new FederationService({
      clientFactory: buildStubFactory(client, endpoint),
      pollIntervalMs: 0,
    });
    const agent = await service.discover(endpoint);
    const result = await service.delegate({ agent, task: 'reject please' });
    expect(result.ok).toBe(false);
    expect(result.status).toBe('failed');
    expect(result.failureClass).toBe('WORKER_FAILURE');
  });

  it('sendMessage failure is classified as PROVIDER_FAILURE', async () => {
    const failingClient = {
      sendMessage: async () => {
        throw new Error('ECONNREFUSED 127.0.0.1:4173');
      },
      getTask: async () => buildStubTask('x', TaskStateEnum.TASK_STATE_COMPLETED, ''),
      cancelTask: async () => buildStubTask('x', TaskStateEnum.TASK_STATE_CANCELED, ''),
    };
    const service = new FederationService({
      clientFactory: buildStubFactory(failingClient as unknown as StubClient, endpoint),
    });
    const agent = await service.discover(endpoint);
    const result = await service.delegate({ agent, task: 'fail at network' });
    expect(result.ok).toBe(false);
    expect(result.status).toBe('failed');
    expect(result.failureClass).toBe('PROVIDER_FAILURE');
    expect(result.failureMessage).toContain('sendMessage failed');
  });

  it('delegate() without discover() returns CONFIGURATION_FAILURE', async () => {
    const client = new StubClient((id) => buildStubTask(id, TaskStateEnum.TASK_STATE_COMPLETED, ''));
    const service = new FederationService({
      clientFactory: buildStubFactory(client, endpoint),
    });
    // Construct an agent that was NOT discovered through the service.
    const undiscoveredAgent: ExternalAgent = {
      id: externalAgentId(endpoint),
      name: 'Undiscovered',
      endpoint,
      declaredSkills: [],
    };
    const result = await service.delegate({ agent: undiscoveredAgent, task: '...' });
    expect(result.ok).toBe(false);
    expect(result.failureClass).toBe('CONFIGURATION_FAILURE');
  });

  it('local AbortSignal triggers CANCELLED', async () => {
    // Use a client whose task never reaches terminal state (stays WORKING).
    const workingClient = {
      sendMessage: async () => buildStubTask('working-task', TaskStateEnum.TASK_STATE_WORKING, ''),
      getTask: async () => buildStubTask('working-task', TaskStateEnum.TASK_STATE_WORKING, ''),
      cancelTask: async (params: { id: string }) =>
        buildStubTask(params.id, TaskStateEnum.TASK_STATE_CANCELED, ''),
    };
    const service = new FederationService({
      clientFactory: buildStubFactory(workingClient as unknown as StubClient, endpoint),
      pollIntervalMs: 5,
    });
    const agent = await service.discover(endpoint);
    const controller = new AbortController();
    const resultPromise = service.delegate({
      agent,
      task: 'long running',
      signal: controller.signal,
      timeoutMs: 60_000,
    });
    // Abort after 20ms.
    setTimeout(() => controller.abort(), 20);
    const result = await resultPromise;
    expect(result.ok).toBe(false);
    expect(result.status).toBe('canceled');
    expect(result.failureClass).toBe('CANCELLED');
  });

  it('timeout produces TIMEOUT failure', async () => {
    // Use a client whose task never reaches terminal state.
    const workingClient = {
      sendMessage: async () => buildStubTask('slow-task', TaskStateEnum.TASK_STATE_WORKING, ''),
      getTask: async () => buildStubTask('slow-task', TaskStateEnum.TASK_STATE_WORKING, ''),
      cancelTask: async (params: { id: string }) =>
        buildStubTask(params.id, TaskStateEnum.TASK_STATE_CANCELED, ''),
    };
    const service = new FederationService({
      clientFactory: buildStubFactory(workingClient as unknown as StubClient, endpoint),
      pollIntervalMs: 5,
    });
    const agent = await service.discover(endpoint);
    const result = await service.delegate({
      agent,
      task: 'slow',
      timeoutMs: 30,
    });
    expect(result.ok).toBe(false);
    expect(result.status).toBe('timed_out');
    expect(result.failureClass).toBe('TIMEOUT');
  });

  it('external success carries provenance but does NOT constitute Genesis verification', async () => {
    // This is the KEY trust-boundary test (Section 23, 38). The FederationService
    // returns ok=true (the federation succeeded), but the CALLER must subject
    // result to Genesis verification. The service itself does NOT verify.
    const correctHash = createHash('sha256').update('input', 'utf8').digest('hex');
    const client = new StubClient((id) =>
      buildStubTask(id, TaskStateEnum.TASK_STATE_COMPLETED, correctHash),
    );
    const service = new FederationService({
      clientFactory: buildStubFactory(client, endpoint),
    });
    const agent = await service.discover(endpoint);
    const result = await service.delegate({ agent, task: 'input' });
    expect(result.ok).toBe(true);
    expect(result.status).toBe('completed');
    expect(result.result).toBe(correctHash);
    // The service returns the external agent's CLAIM. The caller must verify.
    // This test asserts the service does NOT perform verification itself.
    expect(result.failureClass).toBeUndefined();
    // The evidence is from the external agent, not from Genesis verification.
    expect(result.evidence[0].location).toContain('a2a:');
  });

  it('malformed result (no text parts) produces empty result but ok=true', async () => {
    const client = new StubClient((id) => buildStubTask(id, TaskStateEnum.TASK_STATE_COMPLETED, ''));
    const service = new FederationService({
      clientFactory: buildStubFactory(client, endpoint),
    });
    const agent = await service.discover(endpoint);
    const result = await service.delegate({ agent, task: 'empty result' });
    expect(result.ok).toBe(true);
    expect(result.status).toBe('completed');
    expect(result.result).toBe('');
    expect(result.evidence).toHaveLength(0);
  });

  it('internal Worker id ≠ external Agent id', async () => {
    const client = new StubClient((id) => buildStubTask(id, TaskStateEnum.TASK_STATE_COMPLETED, ''));
    const service = new FederationService({
      clientFactory: buildStubFactory(client, endpoint),
    });
    const agent = await service.discover(endpoint);
    // The external agent id uses the "ext:a2a:" prefix — it is NOT a
    // Genesis worker id (which would be a plain string like "worker-1").
    expect(agent.id).toMatch(/^ext:a2a:/);
    expect(agent.id).not.toBe('worker-1');
    // The external agent does NOT have a WorkerGenome field.
    expect((agent as unknown as { genome?: unknown }).genome).toBeUndefined();
  });

  it('constraints are passed through to the remote agent metadata', async () => {
    const client = new StubClient((id) => buildStubTask(id, TaskStateEnum.TASK_STATE_COMPLETED, 'ok'));
    const service = new FederationService({
      clientFactory: buildStubFactory(client, endpoint),
    });
    const agent = await service.discover(endpoint);
    await service.delegate({ agent, task: 'do work', constraints: ['no side effects', 'under 1s'] });
    const sendCall = client.calls.find((c) => c.method === 'sendMessage');
    expect(sendCall).toBeDefined();
    const metadata = (sendCall?.args as { metadata?: { constraints?: string } }).metadata;
    expect(metadata?.constraints).toContain('no side effects');
    expect(metadata?.constraints).toContain('under 1s');
  });
});

// -- Types tests ----------------------------------------------------------

describe('G6-02 federation types', () => {
  it('externalAgentId is stable per endpoint', () => {
    expect(externalAgentId('http://127.0.0.1:4173')).toBe('ext:a2a:http://127.0.0.1:4173');
    expect(externalAgentId('http://127.0.0.1:4173')).toBe(externalAgentId('http://127.0.0.1:4173'));
    expect(externalAgentId('http://127.0.0.1:4173')).not.toBe(externalAgentId('http://127.0.0.1:4174'));
  });

  it('buildSuccessResult carries provenance', () => {
    const agent: ExternalAgent = {
      id: 'ext:a2a:http://x',
      name: 'X',
      endpoint: 'http://x',
      declaredSkills: [],
    };
    const result = buildSuccessResult(agent, 'task-1', 'hello', 'mission-1');
    expect(result.ok).toBe(true);
    expect(result.status).toBe('completed');
    expect(result.result).toBe('hello');
    expect(result.remoteTaskId).toBe('task-1');
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0].location).toBe('a2a:ext:a2a:http://x:task-1');
    expect(result.failureClass).toBeUndefined();
    expect(result.failureMessage).toBe('');
  });

  it('buildFailureResult carries the failure class', () => {
    const agent: ExternalAgent = {
      id: 'ext:a2a:http://x',
      name: 'X',
      endpoint: 'http://x',
      declaredSkills: [],
    };
    const result = buildFailureResult(agent, 'task-1', 'failed', 'PROVIDER_FAILURE', 'connection refused');
    expect(result.ok).toBe(false);
    expect(result.status).toBe('failed');
    expect(result.failureClass).toBe('PROVIDER_FAILURE');
    expect(result.failureMessage).toBe('connection refused');
    expect(result.evidence).toEqual([]);
    expect(result.result).toBe('');
  });

  it('FederationResult satisfies the Section 23 invariant (external success ≠ verified fact)', () => {
    // A completed FederationResult has ok=true but does NOT carry a
    // "verified" flag. The caller MUST subject result to Genesis
    // verification before treating it as mission truth.
    const agent: ExternalAgent = {
      id: 'ext:a2a:http://x',
      name: 'X',
      endpoint: 'http://x',
      declaredSkills: [],
    };
    const result: FederationResult = buildSuccessResult(agent, 'task-1', 'claimed-result');
    expect(result.ok).toBe(true);
    // There is no "verified" field on FederationResult.
    expect((result as unknown as { verified?: boolean }).verified).toBeUndefined();
  });
});
