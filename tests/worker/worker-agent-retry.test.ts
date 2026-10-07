import { describe, it, expect } from 'vitest';
import { WorkerAgent, type WorkerEventSink, type WorkerLoopEvent } from '../../src/worker/worker-agent.js';
import type { ReasoningProvider, ReasoningInput, ReasoningOutput, WorkerGenome } from '../../src/contracts/core.js';

/**
 * G6-01 (P1 H-01, H-03): worker-agent bounded retry on transient
 * reasoning-provider failures.
 *
 * Tests that:
 *   1. A retryable PROVIDER_FAILURE (e.g. ECONNRESET) is retried once,
 *      then succeeds if the second attempt works.
 *   2. A non-retryable CANCELLED failure is NOT retried — propagates
 *      immediately and truthfully.
 *   3. The WorkerResult carries the failureClass when the worker fails.
 *   4. The WorkerResult carries the reasoningRetries count.
 */

class ScriptedReasoningProvider implements ReasoningProvider {
  readonly name = 'scripted';
  private readonly responses: ReadonlyArray<{ readonly text: string } | { readonly error: Error }>;
  private callIndex = 0;
  readonly callLog: ReasoningInput[] = [];

  constructor(responses: ReadonlyArray<{ readonly text: string } | { readonly error: Error }>) {
    this.responses = responses;
  }

  async reason(input: ReasoningInput): Promise<ReasoningOutput> {
    this.callLog.push(input);
    const response = this.responses[this.callIndex];
    this.callIndex += 1;
    if (response === undefined) {
      throw new Error('scripted provider exhausted');
    }
    if ('error' in response) {
      throw response.error;
    }
    return { text: response.text };
  }
}

const TEST_GENOME: WorkerGenome = {
  identity: { id: 'test-worker', displayName: 'Test Worker' },
  role: 'Tester',
  objective: 'test the worker agent',
  model: 'cheap',
  skills: [],
  tools: [],
  computer: { required: false, browser: false, shell: false, workspace: false },
  memory: 'none',
  budget: { maxUsd: 1, maxTier: 'cheap' },
  autonomy: 'autonomous',
};

describe('G6-01 worker-agent retry — P1 H-01, H-03', () => {
  it('retries a transient PROVIDER_FAILURE and succeeds on the second attempt', async () => {
    const provider = new ScriptedReasoningProvider([
      { error: new Error('ECONNRESET socket hang up') },
      { text: '{"action":"finish","summary":"done"}' },
    ]);
    const events: WorkerLoopEvent[] = [];
    const sink: WorkerEventSink = (e) => events.push(e);
    const agent = new WorkerAgent({
      genome: TEST_GENOME,
      reasoning: provider,
      computer: null,
      taskBrief: 'do nothing',
      maxSteps: 1,
      maxReasoningRetries: 1,
      reasoningRetryBackoffMs: [0], // no real backoff in tests
      onEvent: sink,
    });
    const result = await agent.run();
    expect(result.status).toBe('success');
    expect(result.reasoningCalls).toBe(1);
    expect(result.reasoningRetries).toBe(1);
    // The retry should have emitted a worker-step event with action=reasoning-retry:PROVIDER_FAILURE
    const retryEvents = events.filter(
      (e) => e.type === 'worker-step' && e.action.startsWith('reasoning-retry:'),
    );
    expect(retryEvents).toHaveLength(1);
    expect(retryEvents[0]).toMatchObject({
      action: 'reasoning-retry:PROVIDER_FAILURE',
      ok: false,
    });
  });

  it('does NOT retry a non-retryable CANCELLED failure', async () => {
    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';
    const provider = new ScriptedReasoningProvider([
      { error: abortError },
      { text: '{"action":"finish","summary":"should not reach"}' },
    ]);
    const agent = new WorkerAgent({
      genome: TEST_GENOME,
      reasoning: provider,
      computer: null,
      taskBrief: 'do nothing',
      maxSteps: 1,
      maxReasoningRetries: 1,
      reasoningRetryBackoffMs: [0],
    });
    const result = await agent.run();
    expect(result.status).toBe('failure');
    expect(result.failureClass).toBe('CANCELLED');
    expect(result.reasoningRetries).toBe(0);
  });

  it('does NOT retry a CONFIGURATION_FAILURE (missing secret)', async () => {
    const provider = new ScriptedReasoningProvider([
      { error: new Error('missing required env ZAI_API_KEY') },
      { text: '{"action":"finish","summary":"should not reach"}' },
    ]);
    const agent = new WorkerAgent({
      genome: TEST_GENOME,
      reasoning: provider,
      computer: null,
      taskBrief: 'do nothing',
      maxSteps: 1,
      maxReasoningRetries: 1,
      reasoningRetryBackoffMs: [0],
    });
    const result = await agent.run();
    expect(result.status).toBe('failure');
    expect(result.failureClass).toBe('CONFIGURATION_FAILURE');
    expect(result.reasoningRetries).toBe(0);
  });

  it('fails honestly when retry budget is exhausted', async () => {
    const provider = new ScriptedReasoningProvider([
      { error: new Error('ECONNREFUSED 127.0.0.1:443') },
      { error: new Error('ECONNREFUSED 127.0.0.1:443') },
    ]);
    const agent = new WorkerAgent({
      genome: TEST_GENOME,
      reasoning: provider,
      computer: null,
      taskBrief: 'do nothing',
      maxSteps: 1,
      maxReasoningRetries: 1,
      reasoningRetryBackoffMs: [0],
    });
    const result = await agent.run();
    expect(result.status).toBe('failure');
    expect(result.failureClass).toBe('PROVIDER_FAILURE');
    expect(result.reasoningRetries).toBe(1);
    expect(result.summary).toContain('reasoning provider failed');
  });

  it('preserves GROUP 2 behavior when maxReasoningRetries=0', async () => {
    const provider = new ScriptedReasoningProvider([
      { error: new Error('ECONNRESET socket hang up') },
    ]);
    const agent = new WorkerAgent({
      genome: TEST_GENOME,
      reasoning: provider,
      computer: null,
      taskBrief: 'do nothing',
      maxSteps: 1,
      maxReasoningRetries: 0,
      reasoningRetryBackoffMs: [],
    });
    const result = await agent.run();
    expect(result.status).toBe('failure');
    expect(result.failureClass).toBe('PROVIDER_FAILURE');
    expect(result.reasoningRetries).toBe(0);
  });

  it('emits a worker-finished event carrying the failureClass', async () => {
    const provider = new ScriptedReasoningProvider([
      { error: new Error('ECONNREFUSED') },
      { error: new Error('ECONNREFUSED') },
    ]);
    const events: WorkerLoopEvent[] = [];
    const sink: WorkerEventSink = (e) => events.push(e);
    const agent = new WorkerAgent({
      genome: TEST_GENOME,
      reasoning: provider,
      computer: null,
      taskBrief: 'do nothing',
      maxSteps: 1,
      maxReasoningRetries: 1,
      reasoningRetryBackoffMs: [0],
      onEvent: sink,
    });
    await agent.run();
    const finished = events.find((e) => e.type === 'worker-finished');
    expect(finished).toBeDefined();
    if (finished?.type === 'worker-finished') {
      expect(finished.result.failureClass).toBe('PROVIDER_FAILURE');
      expect(finished.result.reasoningRetries).toBe(1);
    }
  });
});
