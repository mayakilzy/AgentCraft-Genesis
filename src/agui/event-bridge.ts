/**
 * G5-02 — AG-UI Event Bridge.
 *
 * The outbound interoperability boundary between Genesis internal execution
 * and an external application/UI consumer. This is NOT a fourth operational
 * pillar and NOT a replacement for FlightRecorder — it is a protocol
 * translation layer that:
 *
 *   1. Consumes Genesis FlightEvents (the internal evidence vocabulary).
 *   2. Translates them into official AG-UI protocol Events.
 *   3. Emits the AG-UI events to an external sink (the stream boundary).
 *
 * Architecture:
 *
 *   Genesis Internal Execution
 *         │
 *         ▼ (FlightEvent vocabulary — Genesis-owned, protocol-neutral)
 *   FlightRecorder port
 *         │
 *         ├── (optional inner recorder: FileFlightRecorder, MemoryFlightRecorder)
 *         │
 *         ▼
 *   AgUiEventBridge (implements FlightRecorder)
 *         │
 *         ▼ (official AG-UI Event types — protocol-owned)
 *   AgUiEventSink (the stream boundary)
 *         │
 *         ▼
 *   External Consumer
 *
 * MissionOrchestrator remains protocol-neutral: it calls `recorder.record()`
 * with Genesis FlightEvents. The bridge is injected as the recorder (or as
 * a decorator wrapping an inner recorder). Zero AG-UI types leak into the
 * orchestrator or any other internal runtime code.
 *
 * Anti-reimplementation: AG-UI event types, the EventType enum, and
 * PROTOCOL_VERSION are all from the official @ag-ui/core package. Genesis
 * constructs events that conform to the official schemas; it does not
 * redefine them.
 */

import { EventType, PROTOCOL_VERSION } from '@ag-ui/core';

import type { FlightEvent, FlightRecorder } from '../mission/flight-recorder.js';

// ---------------------------------------------------------------------------
// The external stream boundary
// ---------------------------------------------------------------------------

/**
 * The sink that receives serialized AG-UI events. This is the boundary
 * between Genesis and the external consumer. Implementations:
 *   - MemoryAgUiSink (tests + probe — collects events in-process, but
 *     serializes each through JSON to exercise the wire format).
 *   - Future: stdio, HTTP/SSE, WebSocket sinks for real network consumers.
 *
 * The sink is an OBSERVER. It must NOT control Genesis execution. If the
 * sink throws, the bridge catches the error and continues — a broken
 * consumer cannot corrupt mission truth.
 */
export interface AgUiEventSink {
  emit(event: unknown): void;
}

/**
 * An in-process sink that collects AG-UI events. Each event is JSON-serialized
 * on emit (to exercise the wire format) and stored. The consumer reads the
 * collected JSON strings and parses them — proving the boundary is real even
 * without a network transport.
 */
export class MemoryAgUiSink implements AgUiEventSink {
  readonly events: string[] = [];

  emit(event: unknown): void {
    this.events.push(JSON.stringify(event));
  }

  /** Parse all collected events back into objects (the consumer's view). */
  collected(): unknown[] {
    return this.events.map((line) => JSON.parse(line));
  }
}

// ---------------------------------------------------------------------------
// The bridge
// ---------------------------------------------------------------------------

export interface AgUiEventBridgeOptions {
  /**
   * An inner FlightRecorder to also forward events to (decorator pattern).
   * When provided, every FlightEvent goes to BOTH the inner recorder AND
   * the AG-UI sink. This lets a mission keep its durable flight record
   * while also streaming to an external consumer.
   */
  readonly inner?: FlightRecorder;
  /**
   * The AG-UI threadId. Defaults to a stable id per bridge instance. In
   * AG-UI, a thread is the conversation context; a run is one execution
   * within it. Genesis maps: threadId = bridge instance, runId = missionId.
   */
  readonly threadId?: string;
}

/**
 * The AG-UI Event Bridge. Implements FlightRecorder so it can be injected
 * anywhere a FlightRecorder is expected (including MissionOrchestrator's
 * `recorder` option). Translates Genesis FlightEvents into official AG-UI
 * Events and emits them to the sink.
 *
 * ISOLATION: if the sink throws during emit(), the error is swallowed.
 * The bridge must NEVER let a consumer failure propagate back into Genesis
 * execution. The inner recorder (if any) still receives the event.
 */
export class AgUiEventBridge implements FlightRecorder {
  private readonly sink: AgUiEventSink;
  private readonly inner: FlightRecorder | undefined;
  private readonly threadId: string;
  private runId: string | undefined;
  private started = false;

  constructor(sink: AgUiEventSink, options: AgUiEventBridgeOptions = {}) {
    this.sink = sink;
    this.inner = options.inner;
    this.threadId = options.threadId ?? `genesis-thread-${Date.now()}`;
  }

  record(event: FlightEvent): void {
    // Always forward to the inner recorder first (mission truth is Genesis-owned).
    this.inner?.record(event);
    // Translate + emit. Isolation: a sink failure must NOT propagate.
    try {
      this.translate(event).forEach((aguiEvent) => this.sink.emit(aguiEvent));
    } catch {
      // Swallow — the consumer is non-authoritative. Genesis execution continues.
    }
  }

  /**
   * Translate one Genesis FlightEvent into zero or more AG-UI Events.
   * Returns an array because some Genesis events map to multiple AG-UI events
   * (e.g. worker-step → TOOL_CALL_START + TOOL_CALL_RESULT + TOOL_CALL_END).
   */
  private translate(event: FlightEvent): unknown[] {
    switch (event.type) {
      case 'mission-started':
        return this.onMissionStarted(event);
      case 'mission-finished':
        return this.onMissionFinished(event);
      case 'worker-started':
        return this.onWorkerStarted(event);
      case 'worker-finished':
        return this.onWorkerFinished(event);
      case 'worker-step':
        return this.onWorkerStep(event);
      case 'verification':
        return this.onVerification(event);
      // Events that are evidence-only (internal) and do not map to AG-UI:
      case 'requirements-compiled':
      case 'plan-created':
      case 'genomes-compiled':
      case 'worker-retry':
      case 'human-intervention':
      case 'repository':
      case 'reasoning-fallback':
      case 'handoff':
        return [];
      default:
        return [];
    }
  }

  private onMissionStarted(event: Extract<FlightEvent, { type: 'mission-started' }>): unknown[] {
    this.runId = event.missionId;
    this.started = true;
    return [
      {
        type: EventType.RUN_STARTED,
        threadId: this.threadId,
        runId: event.missionId,
        protocolVersion: PROTOCOL_VERSION,
        timestamp: Date.now(),
      },
    ];
  }

  private onMissionFinished(event: Extract<FlightEvent, { type: 'mission-finished' }>): unknown[] {
    if (!this.started) return [];
    if (event.status === 'failure') {
      return [
        {
          type: EventType.RUN_ERROR,
          message: `mission ${event.missionId} failed`,
          timestamp: Date.now(),
        },
      ];
    }
    // success or partial → RUN_FINISHED. Partial maps to RUN_FINISHED without
    // an explicit success outcome (absent outcome = completed without result).
    const outcome = event.status === 'success'
      ? { type: 'success' as const }
      : undefined;
    return [
      {
        type: EventType.RUN_FINISHED,
        threadId: this.threadId,
        runId: event.missionId,
        ...(outcome === undefined ? {} : { outcome }),
        timestamp: Date.now(),
      },
    ];
  }

  private onWorkerStarted(event: Extract<FlightEvent, { type: 'worker-started' }>): unknown[] {
    return [
      {
        type: EventType.SUBAGENT_STARTED,
        subagentRunId: event.workerId,
        name: event.role,
        timestamp: Date.now(),
      },
    ];
  }

  private onWorkerFinished(event: Extract<FlightEvent, { type: 'worker-finished' }>): unknown[] {
    const result = event.result;
    const events: unknown[] = [
      {
        type: EventType.SUBAGENT_FINISHED,
        subagentRunId: result.workerId,
        name: event.result.workerId,
        timestamp: Date.now(),
      },
    ];
    // Emit the worker's finish summary as a text message — this is the
    // "useful output/result" the consumer should see.
    if (result.summary.trim().length > 0) {
      const messageId = `msg-${result.workerId}`;
      events.push(
        {
          type: EventType.TEXT_MESSAGE_START,
          messageId,
          role: 'assistant',
          timestamp: Date.now(),
        },
        {
          type: EventType.TEXT_MESSAGE_CONTENT,
          messageId,
          delta: result.summary,
          timestamp: Date.now(),
        },
        {
          type: EventType.TEXT_MESSAGE_END,
          messageId,
          timestamp: Date.now(),
        },
      );
    }
    return events;
  }

  private onWorkerStep(event: Extract<FlightEvent, { type: 'worker-step' }>): unknown[] {
    // A worker step is an action invocation. Map to TOOL_CALL lifecycle.
    // The toolCallId ties START → RESULT → END together.
    const toolCallId = `tc-${event.workerId}-${event.step}`;
    const events: unknown[] = [
      {
        type: EventType.TOOL_CALL_START,
        toolCallId,
        toolCallName: event.action,
        timestamp: Date.now(),
      },
    ];
    // Only emit a result when the step has an ok value (it always does for
    // real steps; the stage-input synthetic step has step: 0 and may lack ok).
    if (event.ok !== undefined) {
      events.push({
        type: EventType.TOOL_CALL_RESULT,
        messageId: `msg-tc-${event.workerId}-${event.step}`,
        toolCallId,
        content: event.ok ? 'ok' : 'failed',
        timestamp: Date.now(),
      });
    }
    events.push({
      type: EventType.TOOL_CALL_END,
      toolCallId,
      timestamp: Date.now(),
    });
    return events;
  }

  private onVerification(event: Extract<FlightEvent, { type: 'verification' }>): unknown[] {
    // Emit a STATE_SNAPSHOT so the consumer sees verification outcome.
    return [
      {
        type: EventType.STATE_SNAPSHOT,
        snapshot: {
          verification: {
            ok: event.ok,
            passed: event.passed,
            failed: event.failed,
          },
        },
        timestamp: Date.now(),
      },
    ];
  }
}
