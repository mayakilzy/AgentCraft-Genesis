import { describe, expect, it } from 'vitest';

/**
 * G5-02 — AG-UI Event Bridge focused tests.
 *
 * These tests exercise the translation from Genesis FlightEvents to AG-UI
 * protocol Events. They verify:
 *   1. Mission lifecycle mapping (started → RUN_STARTED, finished → RUN_FINISHED/RUN_ERROR).
 *   2. Worker lifecycle mapping (started/finished → SUBAGENT_*).
 *   3. Worker step mapping (→ TOOL_CALL_START/RESULT/END).
 *   4. Event ordering (causal sequence preserved).
 *   5. Run identity coherence (runId = missionId throughout).
 *   6. Consumer failure isolation (sink throwing does NOT affect bridge).
 *   7. No sensitive data leakage (no secrets in emitted events).
 *   8. Inner recorder forwarding (decorator pattern).
 */

import { EventType, PROTOCOL_VERSION } from '@ag-ui/core';

import { AgUiEventBridge, MemoryAgUiSink } from '../../src/agui/event-bridge.js';
import { MemoryFlightRecorder } from '../../src/mission/flight-recorder.js';
import type { FlightEvent } from '../../src/mission/flight-recorder.js';

/** Helper: build a bridge + sink pair. */
function makeBridge(): { bridge: AgUiEventBridge; sink: MemoryAgUiSink } {
  const sink = new MemoryAgUiSink();
  const bridge = new AgUiEventBridge(sink);
  return { bridge, sink };
}

/** Helper: a minimal mission-started event. */
function missionStarted(missionId = 'mission-test-1'): FlightEvent {
  return {
    type: 'mission-started',
    at: '2026-10-07T00:00:00.000Z',
    missionId,
    goalOutcome: 'test mission',
    budgetUsd: 10,
  };
}

/** Helper: a minimal mission-finished event. */
function missionFinished(
  missionId: string,
  status: 'success' | 'partial' | 'failure',
): FlightEvent {
  return {
    type: 'mission-finished',
    at: '2026-10-07T00:00:01.000Z',
    missionId,
    status,
    wallMs: 1000,
    reasoningCalls: 1,
    worker_reasoning_calls: 1,
    reviewer_calls: 0,
    handoff_calls: 0,
  };
}

/** Helper: a minimal worker-started event. */
function workerStarted(workerId: string, role: string): FlightEvent {
  return {
    type: 'worker-started',
    workerId,
    role,
    tier: 'default',
  };
}

/** Helper: a minimal worker-step event. */
function workerStep(workerId: string, step: number, action: string, ok: boolean): FlightEvent {
  return {
    type: 'worker-step',
    workerId,
    step,
    action,
    ok,
    elapsedMs: 10,
  };
}

/** Helper: a minimal worker-finished event. */
function workerFinished(workerId: string, summary: string): FlightEvent {
  return {
    type: 'worker-finished',
    workerId,
    result: {
      workerId,
      status: 'success' as const,
      summary,
      evidence: [],
      artifacts: [],
      steps: 1,
      reasoningCalls: 1,
      refusals: [],
    },
  };
}

describe('AgUiEventBridge — mission lifecycle mapping', () => {
  it('maps mission-started to RUN_STARTED with protocol version', () => {
    const { bridge, sink } = makeBridge();
    bridge.record(missionStarted('m1'));
    const events = sink.collected() as Array<{ type: string; runId?: string; protocolVersion?: string }>;
    expect(events.length).toBe(1);
    expect(events[0].type).toBe(EventType.RUN_STARTED);
    expect(events[0].runId).toBe('m1');
    expect(events[0].protocolVersion).toBe(PROTOCOL_VERSION);
  });

  it('maps mission-finished success to RUN_FINISHED with success outcome', () => {
    const { bridge, sink } = makeBridge();
    bridge.record(missionStarted('m2'));
    bridge.record(missionFinished('m2', 'success'));
    const events = sink.collected() as Array<{ type: string; outcome?: { type: string } }>;
    const finished = events.find((e) => e.type === EventType.RUN_FINISHED);
    expect(finished).toBeDefined();
    expect(finished!.outcome).toEqual({ type: 'success' });
  });

  it('maps mission-finished failure to RUN_ERROR (NOT RUN_FINISHED)', () => {
    const { bridge, sink } = makeBridge();
    bridge.record(missionStarted('m3'));
    bridge.record(missionFinished('m3', 'failure'));
    const events = sink.collected() as Array<{ type: string }>;
    const hasRunError = events.some((e) => e.type === EventType.RUN_ERROR);
    const hasRunFinished = events.some((e) => e.type === EventType.RUN_FINISHED);
    expect(hasRunError).toBe(true);
    expect(hasRunFinished).toBe(false);
  });

  it('maps mission-finished partial to RUN_FINISHED without success outcome', () => {
    const { bridge, sink } = makeBridge();
    bridge.record(missionStarted('m4'));
    bridge.record(missionFinished('m4', 'partial'));
    const events = sink.collected() as Array<{ type: string; outcome?: unknown }>;
    const finished = events.find((e) => e.type === EventType.RUN_FINISHED);
    expect(finished).toBeDefined();
    expect(finished!.outcome).toBeUndefined();
  });
});

describe('AgUiEventBridge — worker lifecycle mapping', () => {
  it('maps worker-started to SUBAGENT_STARTED', () => {
    const { bridge, sink } = makeBridge();
    bridge.record(missionStarted('m5'));
    bridge.record(workerStarted('w1', 'Analyst'));
    const events = sink.collected() as Array<{ type: string; subagentRunId?: string; name?: string }>;
    const started = events.find((e) => e.type === EventType.SUBAGENT_STARTED);
    expect(started).toBeDefined();
    expect(started!.subagentRunId).toBe('w1');
    expect(started!.name).toBe('Analyst');
  });

  it('maps worker-finished to SUBAGENT_FINISHED + text message with summary', () => {
    const { bridge, sink } = makeBridge();
    bridge.record(missionStarted('m6'));
    bridge.record(workerStarted('w2', 'Writer'));
    bridge.record(workerFinished('w2', 'I wrote a report'));
    const events = sink.collected() as Array<{ type: string; messageId?: string; delta?: string }>;
    const finished = events.find((e) => e.type === EventType.SUBAGENT_FINISHED);
    expect(finished).toBeDefined();
    const textContent = events.find((e) => e.type === EventType.TEXT_MESSAGE_CONTENT);
    expect(textContent).toBeDefined();
    expect(textContent!.delta).toBe('I wrote a report');
  });
});

describe('AgUiEventBridge — worker step (tool call) mapping', () => {
  it('maps worker-step to TOOL_CALL_START → TOOL_CALL_RESULT → TOOL_CALL_END', () => {
    const { bridge, sink } = makeBridge();
    bridge.record(missionStarted('m7'));
    bridge.record(workerStarted('w3', 'Engineer'));
    bridge.record(workerStep('w3', 1, 'run_command', true));
    const types = (sink.collected() as Array<{ type: string }>).map((e) => e.type);
    expect(types).toContain(EventType.TOOL_CALL_START);
    expect(types).toContain(EventType.TOOL_CALL_RESULT);
    expect(types).toContain(EventType.TOOL_CALL_END);
    const startIdx = types.indexOf(EventType.TOOL_CALL_START);
    const resultIdx = types.indexOf(EventType.TOOL_CALL_RESULT);
    const endIdx = types.indexOf(EventType.TOOL_CALL_END);
    expect(startIdx).toBeLessThan(resultIdx);
    expect(resultIdx).toBeLessThan(endIdx);
  });

  it('toolCallId is consistent across START/RESULT/END for one step', () => {
    const { bridge, sink } = makeBridge();
    bridge.record(missionStarted('m8'));
    bridge.record(workerStarted('w4', 'Engineer'));
    bridge.record(workerStep('w4', 1, 'write_file', true));
    const events = sink.collected() as Array<{ type: string; toolCallId?: string }>;
    const toolEvents = events.filter((e) => e.toolCallId !== undefined);
    const ids = new Set(toolEvents.map((e) => e.toolCallId));
    expect(ids.size).toBe(1);
  });

  it('maps call_tool (MCP) action generically — no MCP-specific AG-UI subsystem', () => {
    const { bridge, sink } = makeBridge();
    bridge.record(missionStarted('m9'));
    bridge.record(workerStarted('w5', 'Analyst'));
    bridge.record(workerStep('w5', 1, 'call_tool', true));
    const events = sink.collected() as Array<{ type: string; toolCallName?: string }>;
    const start = events.find((e) => e.type === EventType.TOOL_CALL_START);
    expect(start).toBeDefined();
    expect(start!.toolCallName).toBe('call_tool');
    const hasMcpSpecificEvent = events.some((e) =>
      typeof e.type === 'string' && e.type.includes('MCP'),
    );
    expect(hasMcpSpecificEvent).toBe(false);
  });
});

describe('AgUiEventBridge — event ordering and run identity', () => {
  it('preserves causal ordering: RUN_STARTED → SUBAGENT → TOOL_CALL → SUBAGENT_FINISHED → RUN_FINISHED', () => {
    const { bridge, sink } = makeBridge();
    bridge.record(missionStarted('m10'));
    bridge.record(workerStarted('w6', 'Worker'));
    bridge.record(workerStep('w6', 1, 'run_command', true));
    bridge.record(workerFinished('w6', 'done'));
    bridge.record(missionFinished('m10', 'success'));
    const types = (sink.collected() as Array<{ type: string }>).map((e) => e.type);
    const runStartIdx = types.indexOf(EventType.RUN_STARTED);
    const subStartIdx = types.indexOf(EventType.SUBAGENT_STARTED);
    const toolCallIdx = types.indexOf(EventType.TOOL_CALL_START);
    const subFinishedIdx = types.indexOf(EventType.SUBAGENT_FINISHED);
    const runFinishedIdx = types.indexOf(EventType.RUN_FINISHED);
    expect(runStartIdx).toBeLessThan(subStartIdx);
    expect(subStartIdx).toBeLessThan(toolCallIdx);
    expect(toolCallIdx).toBeLessThan(subFinishedIdx);
    expect(subFinishedIdx).toBeLessThan(runFinishedIdx);
  });

  it('run identity is coherent — runId stays the missionId throughout', () => {
    const { bridge, sink } = makeBridge();
    const missionId = 'mission-coherent-1';
    bridge.record(missionStarted(missionId));
    bridge.record(missionFinished(missionId, 'success'));
    const events = sink.collected() as Array<{ type: string; runId?: string }>;
    const runEvents = events.filter((e) => e.runId !== undefined);
    expect(runEvents.length).toBeGreaterThan(0);
    for (const e of runEvents) {
      expect(e.runId).toBe(missionId);
    }
  });
});

describe('AgUiEventBridge — consumer failure isolation', () => {
  it('a throwing sink does NOT propagate errors to the bridge caller', () => {
    const throwingSink: { emit(event: unknown): void } = {
      emit() {
        throw new Error('consumer exploded');
      },
    };
    const bridge = new AgUiEventBridge(throwingSink);
    expect(() => bridge.record(missionStarted('m11'))).not.toThrow();
    expect(() => bridge.record(missionFinished('m11', 'success'))).not.toThrow();
  });

  it('a throwing sink does NOT prevent the inner recorder from receiving events', () => {
    const throwingSink: { emit(event: unknown): void } = {
      emit() {
        throw new Error('consumer exploded');
      },
    };
    const inner = new MemoryFlightRecorder();
    const bridge = new AgUiEventBridge(throwingSink, { inner });
    bridge.record(missionStarted('m12'));
    bridge.record(missionFinished('m12', 'success'));
    expect(inner.events.length).toBe(2);
    expect(inner.events[0].type).toBe('mission-started');
    expect(inner.events[1].type).toBe('mission-finished');
  });
});

describe('AgUiEventBridge — no sensitive data leakage', () => {
  it('does not expose worker scratchpads or chain-of-thought in AG-UI events', () => {
    const { bridge, sink } = makeBridge();
    bridge.record(missionStarted('m13'));
    bridge.record(workerStarted('w7', 'Analyst'));
    bridge.record(workerStep('w7', 1, 'run_command', true));
    bridge.record(workerFinished('w7', 'summary text'));
    bridge.record(missionFinished('m13', 'success'));
    const serialized = sink.events.join('\n');
    expect(serialized).not.toMatch(/(token|secret|password|api[_-]?key|authorization)/i);
    expect(serialized).not.toMatch(/(scratchpad|chain.of.thought|private.reasoning)/i);
  });

  it('does not leak credential-like values from the goal outcome', () => {
    const { bridge, sink } = makeBridge();
    bridge.record({
      type: 'mission-started',
      at: '2026-10-07T00:00:00.000Z',
      missionId: 'm14',
      goalOutcome: 'analyze data with token=sk-1234567890abcdef',
      budgetUsd: 10,
    });
    const serialized = sink.events.join('\n');
    expect(serialized).not.toContain('sk-1234567890abcdef');
  });
});

describe('AgUiEventBridge — inner recorder forwarding (decorator)', () => {
  it('forwards events to the inner recorder AND the AG-UI sink', () => {
    const inner = new MemoryFlightRecorder();
    const sink = new MemoryAgUiSink();
    const bridge = new AgUiEventBridge(sink, { inner });
    bridge.record(missionStarted('m15'));
    bridge.record(missionFinished('m15', 'success'));
    expect(inner.events.length).toBe(2);
    expect(sink.events.length).toBeGreaterThan(0);
    const aguiTypes = (sink.collected() as Array<{ type: string }>).map((e) => e.type);
    expect(aguiTypes).toContain(EventType.RUN_STARTED);
    expect(aguiTypes).toContain(EventType.RUN_FINISHED);
  });
});
