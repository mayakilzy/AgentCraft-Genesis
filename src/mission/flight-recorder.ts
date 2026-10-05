import type { GoalRequirements } from '../contracts/core.js';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { WorkerLoopEvent } from '../worker/worker-agent.js';
import type { HandoffEvent } from '../worker/handoff.js';

/**
 * Flight Recorder port (TASK-014 delivers the durable file recorder).
 *
 * The vocabulary is defined here because the Mission Orchestrator (TASK-012)
 * is its first consumer: a recorder must capture enough to REBUILD what
 * happened in a mission — the organization, the decisions, the actions, the
 * failures — without storing transcripts as if they were knowledge. Raw logs
 * stay separate from the structured record; no secrets are ever recorded.
 *
 * Worker-scope events (worker-started/step/finished) and handoffs reuse the
 * shapes the worker loop and channel already emit; mission-scope events carry
 * the missionId. A file recorder scopes records per mission file, so worker
 * events do not need to repeat it.
 */

export interface MissionEventMissionStarted {
  readonly type: 'mission-started';
  readonly at: string;
  readonly missionId: string;
  readonly goalOutcome: string;
  readonly budgetUsd: number;
}

export interface MissionEventRequirementsCompiled {
  readonly type: 'requirements-compiled';
  readonly missionId: string;
  readonly domain: GoalRequirements['domain'];
  readonly capabilityNeeds: readonly string[];
  readonly successCriteria: readonly string[];
  readonly budgetUsd: number;
}

export interface MissionEventPlanCreated {
  readonly type: 'plan-created';
  readonly missionId: string;
  readonly workers: readonly { id: string; role: string; needs: readonly string[] }[];
  readonly rationale: string;
}

export interface MissionEventGenomesCompiled {
  readonly type: 'genomes-compiled';
  readonly missionId: string;
  readonly workers: readonly {
    id: string;
    tier: string;
    tools: readonly string[];
    computerRequired: boolean;
  }[];
  readonly gaps: readonly { workerId: string; need: string; reason: string }[];
}

export interface MissionEventVerification {
  readonly type: 'verification';
  readonly missionId: string;
  readonly ok: boolean;
  readonly passed: number;
  readonly failed: number;
  readonly failures: readonly string[];
}

export interface MissionEventWorkerRetry {
  readonly type: 'worker-retry';
  readonly missionId: string;
  readonly workerId: string;
  readonly reason: string;
}

export interface MissionEventMissionFinished {
  readonly type: 'mission-finished';
  readonly at: string;
  readonly missionId: string;
  readonly status: 'success' | 'partial' | 'failure';
  readonly wallMs: number;
  /** Workers' own loop reasoning calls, coordinator included (GROUP 2 field). */
  readonly reasoningCalls: number;
  /**
   * GROUP 3 metric separation (review requirement): the ambiguous single
   * "LLM calls" number is decomposed into what the components actually are.
   * `total_provider_calls` is present when a provider calls source was given.
   */
  readonly worker_reasoning_calls: number;
  readonly reviewer_calls: number;
  readonly handoff_calls: number;
  readonly total_provider_calls?: number;
}

export interface MissionEventHumanIntervention {
  readonly type: 'human-intervention';
  readonly missionId: string;
  readonly note: string;
}

/** The structured flight record vocabulary. */
export type FlightEvent =
  | MissionEventMissionStarted
  | MissionEventRequirementsCompiled
  | MissionEventPlanCreated
  | MissionEventGenomesCompiled
  | MissionEventVerification
  | MissionEventWorkerRetry
  | MissionEventMissionFinished
  | MissionEventHumanIntervention
  | WorkerLoopEvent
  | HandoffEvent;

/** The port mission components emit structured events through. */
export interface FlightRecorder {
  record(event: FlightEvent): void;
}

/** Collects events in memory — tests and small inline runs. */
export class MemoryFlightRecorder implements FlightRecorder {
  readonly events: FlightEvent[] = [];

  record(event: FlightEvent): void {
    this.events.push(event);
  }
}

// ---------------------------------------------------------------------------
// Durable file recorder (TASK-014)
// ---------------------------------------------------------------------------

/**
 * Secret shapes that must never reach a flight record. Redaction is a floor,
 * not a vault: components simply never record credentials in the first
 * place; this catches accidental leaks (a token echoed by a command, a
 * bearer header captured in a diagnostic string).
 */
const SECRET_PATTERNS: readonly { pattern: RegExp; replacement: string }[] = [
  { pattern: /Bearer\s+[A-Za-z0-9._~+/=-]+/gi, replacement: 'Bearer [redacted]' },
  { pattern: /(token|secret|password|api[_-]?key)["'=:\s]+[A-Za-z0-9._~+/=-]{8,}/gi, replacement: '$1=[redacted]' },
  { pattern: /(authorization["'=:\s]+)[^\s"',}]+/gi, replacement: '$1[redacted]' },
];

const SECRET_KEY = /(token|secret|password|authorization|api[-_]?key)/i;

/** Default cap for any single string field in a record. */
export const DEFAULT_MAX_FIELD_LENGTH = 2_000;

function scrub(text: string): string {
  let out = text;
  for (const { pattern, replacement } of SECRET_PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

/** Deep-walk an event: redact secret-looking keys, bound string length. */
function sanitize(
  value: unknown,
  maxFieldLength: number,
  depth = 0,
): unknown {
  if (depth > 6) return '[depth-capped]';
  if (typeof value === 'string') {
    const scrubbed = scrub(value);
    return scrubbed.length > maxFieldLength
      ? `${scrubbed.slice(0, maxFieldLength)}…[truncated]`
      : scrubbed;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 100).map((item) => sanitize(item, maxFieldLength, depth + 1));
  }
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) {
      out[key] = SECRET_KEY.test(key)
        ? '[redacted]'
        : sanitize(inner, maxFieldLength, depth + 1);
    }
    return out;
  }
  return value;
}

export interface FileFlightRecorderOptions {
  /** Directory for the mission's records (created if absent). */
  readonly dir: string;
  readonly missionId: string;
  /** Cap for any single string field (default 2000). */
  readonly maxFieldLength?: number;
}

/**
 * The durable flight recorder: a structured JSONL record per mission plus a
 * SEPARATE raw log for process output. The structured record carries what
 * happened (organization, decisions, actions, failures, timings); the raw
 * log carries what the processes printed. Neither stores transcripts as
 * knowledge, and both are scrubbed of secrets.
 */
export class FileFlightRecorder implements FlightRecorder {
  private readonly structuredPath: string;
  private readonly rawPath: string;
  private readonly maxFieldLength: number;
  private closed = false;

  constructor(options: FileFlightRecorderOptions) {
    mkdirSync(options.dir, { recursive: true });
    this.structuredPath = join(options.dir, `${options.missionId}.jsonl`);
    this.rawPath = join(options.dir, `${options.missionId}.raw.log`);
    this.maxFieldLength = options.maxFieldLength ?? DEFAULT_MAX_FIELD_LENGTH;
  }

  record(event: FlightEvent): void {
    if (this.closed) return;
    const stamped = {
      at: new Date().toISOString(),
      ...(sanitize(event, this.maxFieldLength) as Record<string, unknown>),
    };
    appendFileSync(this.structuredPath, `${JSON.stringify(stamped)}\n`, 'utf8');
  }

  /** Raw process output — separate file, prefixed by source, scrubbed. */
  raw(source: string, chunk: string): void {
    if (this.closed) return;
    const line = `[${new Date().toISOString()}] [${scrub(source)}] ${chunk
      .split('\n')
      .map((linePart) => scrub(linePart).slice(0, 2_000))
      .join('\n')}`;
    appendFileSync(this.rawPath, `${line}\n`, 'utf8');
  }

  /** Raw-log sink for a named source (worker computer processes). */
  rawSink(source: string): (chunk: string) => void {
    return (chunk: string) => this.raw(source, chunk);
  }

  close(): void {
    this.closed = true;
  }
}
