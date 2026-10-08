/**
 * G6-05A — A2A Inbound tests.
 *
 * Covers A2A-01..A2A-06 from the Test Matrix (Section 24).
 */
import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { a2aCall, httpGetJson, SIMPLE_GOAL, CALLER_A, service, a2aUrl } from './helpers.js';

describe('G6-05A — A2A Inbound', () => {
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
    }, 'key-a')) as { result?: { task?: { id: string; status: { state: number } } } };
    expect(result.result).toBeDefined();
    expect(result.result!.task).toBeDefined();
    expect(typeof result.result!.task!.id).toBe('string');
    expect([1, 2]).toContain(result.result!.task!.status.state);
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
    await service.awaitCompletion(taskId, CALLER_A);
    const getResult = (await a2aCall('GetTask', { id: taskId }, 'key-a')) as {
      result?: { status: { state: number }; artifacts: Array<{ parts: Array<{ text: string }> }> };
    };
    expect(getResult.result).toBeDefined();
    expect([3, 4, 5]).toContain(getResult.result!.status.state);
  });

  it('A2A-04: result mapping — task artifacts contain the mission summary', async () => {
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
    await service.awaitCompletion(taskId, CALLER_A);
    const getResult = (await a2aCall('GetTask', { id: taskId }, 'key-a')) as {
      result?: { status: { state: number }; artifacts: Array<{ parts: Array<{ text: string }> }> };
    };
    if (getResult.result!.status.state === 3) {
      expect(getResult.result!.artifacts.length).toBeGreaterThan(0);
      const text = getResult.result!.artifacts[0].parts[0].text;
      expect(typeof text).toBe('string');
      expect(text.length).toBeGreaterThan(0);
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

  it('A2A-05b: malformed protocol request rejected', async () => {
    const result = (await a2aCall('SendMessage', {}, 'key-a')) as {
      error?: { code: number; message: string };
    };
    expect(result.error).toBeDefined();
    expect(result.error!.code).toBe(-32602);
  });

  it('A2A-06: method-not-found for unknown JSON-RPC method', async () => {
    const result = (await a2aCall('BogusMethod', {}, 'key-a')) as {
      error?: { code: number; message: string };
    };
    expect(result.error).toBeDefined();
    expect(result.error!.code).toBe(-32601);
  });
});
