/**
 * G6-05A-R1 — A2A Inbound tests (SDK-backed server).
 *
 * Tests the inbound A2A server that now uses the official
 * @a2a-js/sdk server abstractions (DefaultRequestHandler,
 * AgentExecutor, InMemoryTaskStore, JsonRpcTransportHandler).
 *
 * All tests use the A2A JSON-RPC wire protocol over real HTTP —
 * they do NOT call MissionService methods directly (except for
 * the outbound regression which uses the SDK client).
 *
 * Covers A2A-01..A2A-06 from the Test Matrix (Section 24).
 */
import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { a2aCall, httpGetJson, SIMPLE_GOAL, a2aUrl } from './helpers.js';

describe('G6-05A-R1 — A2A Inbound (official SDK server)', () => {
  it('A2A-01: Agent Card discovery at /.well-known/agent-card.json', async () => {
    const card = (await httpGetJson(`${a2aUrl}/.well-known/agent-card.json`)) as Record<string, unknown>;
    expect(card.name).toBeDefined();
    expect(card.version).toBe('1.0.0');
    expect(Array.isArray(card.supportedInterfaces)).toBe(true);
    const iface = (card.supportedInterfaces as Array<Record<string, unknown>>)[0];
    expect(iface.protocolBinding).toBe('JSONRPC');
    expect(iface.protocolVersion).toBe('1.0');
    expect(Array.isArray(card.skills)).toBe(true);
  });

  it('A2A-02: authorized inbound task submits and returns task id', async () => {
    const result = (await a2aCall('SendMessage', {
      message: {
        messageId: randomUUID(),
        contextId: randomUUID(),
        taskId: '',
        role: 1,
        parts: [{ text: SIMPLE_GOAL }],
        metadata: undefined,
        extensions: [],
        referenceTaskIds: [],
      },
    }, 'key-a')) as { result?: { task?: { id: string; status: { state: string | number } } }; error?: { code: number; message: string } };
    expect(result.error).toBeUndefined();
    expect(result.result).toBeDefined();
    expect(result.result!.task).toBeDefined();
    expect(typeof result.result!.task!.id).toBe('string');
  });

  it('A2A-03: lifecycle mapping — GetTask returns terminal state', async () => {
    const sendResult = (await a2aCall('SendMessage', {
      message: {
        messageId: randomUUID(),
        contextId: randomUUID(),
        taskId: '',
        role: 1,
        parts: [{ text: SIMPLE_GOAL }],
        metadata: undefined,
        extensions: [],
        referenceTaskIds: [],
      },
    }, 'key-a')) as { result?: { task?: { id: string } } };
    const taskId = sendResult.result!.task!.id;

    // The SDK's blocking sendMessage already returns the terminal task.
    // Poll GetTask to confirm the task store retains it.
    let terminalState: string | number | null = null;
    for (let i = 0; i < 60; i++) {
      const getResult = (await a2aCall('GetTask', { id: taskId }, 'key-a')) as {
        result?: { status: { state: string | number } };
        error?: { code: number; message: string };
      };
      if (getResult.error) {
        await new Promise((r) => setTimeout(r, 100));
        continue;
      }
      const state = getResult.result!.status.state;
      // Terminal states: "TASK_STATE_COMPLETED" (3), "TASK_STATE_FAILED" (4), "TASK_STATE_CANCELED" (5)
      const stateStr = typeof state === 'string' ? state : String(state);
      if (stateStr.includes('COMPLETED') || stateStr.includes('FAILED') || stateStr.includes('CANCELED') || [3, 4, 5].includes(Number(state))) {
        terminalState = state;
        break;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(terminalState).not.toBeNull();
  });

  it('A2A-04: result mapping — completed task has artifacts', async () => {
    const sendResult = (await a2aCall('SendMessage', {
      message: {
        messageId: randomUUID(),
        contextId: randomUUID(),
        taskId: '',
        role: 1,
        parts: [{ text: SIMPLE_GOAL }],
        metadata: undefined,
        extensions: [],
        referenceTaskIds: [],
      },
    }, 'key-a')) as { result?: { task?: { id: string; status: { state: string | number }; artifacts: Array<{ parts: Array<Record<string, unknown>> }> } } };
    const task = sendResult.result!.task!;

    // The SDK's blocking sendMessage returns the terminal task directly.
    const stateStr = String(task.status.state);
    if (stateStr.includes('COMPLETED') || stateStr === '3') {
      // COMPLETED — should have at least one artifact
      expect(task.artifacts.length).toBeGreaterThan(0);
    }
  });

  it('A2A-05: unauthorized request rejected', async () => {
    const result = (await a2aCall('SendMessage', {
      message: {
        messageId: randomUUID(),
        contextId: randomUUID(),
        taskId: '',
        role: 1,
        parts: [{ text: SIMPLE_GOAL }],
        metadata: undefined,
        extensions: [],
        referenceTaskIds: [],
      },
    }, 'bogus-key')) as { error?: { code: number; message: string } };
    expect(result.error).toBeDefined();
    expect(result.error!.code).toBe(-32600);
    expect(result.error!.message).toContain('unauthorized');
  });

  it('A2A-05b: malformed protocol request (missing message) rejected', async () => {
    const result = (await a2aCall('SendMessage', {}, 'key-a')) as {
      error?: { code: number; message: string };
    };
    // The SDK should reject malformed params
    expect(result.error).toBeDefined();
  });

  it('A2A-06: method-not-found for unknown JSON-RPC method', async () => {
    const result = (await a2aCall('BogusMethod', {}, 'key-a')) as {
      error?: { code: number; message: string };
    };
    expect(result.error).toBeDefined();
    expect(result.error!.code).toBe(-32601);
  });
});
