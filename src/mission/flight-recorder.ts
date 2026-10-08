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

/**
 * Repository mission progress (GROUP 3, TASK-020): the state of the mission
 * workspace — worktrees committed, integration merged or conflicted,
 * rollback — so the durable record rebuilds the repository side of a
 * mission the same way worker events rebuild the cognitive side.
 */
export interface MissionEventRepository {
  readonly type: 'repository';
  readonly missionId: string;
  readonly phase:
    | 'workspace-prepared'
    | 'worktree-committed'
    | 'integration-conflict'
    | 'integrated'
    | 'rolled-back';
  readonly workerId?: string;
  readonly branch?: string;
  readonly changedFiles?: readonly string[];
  readonly detail?: string;
}

/**
 * Reasoning substitution (GROUP 3, TASK-022 development fallback rule): one
 * event per reasoning call served by the declared development fallback
 * instead of the configured external provider. Structural visibility — a
 * fallback-served mission can never be confused with a real-provider run.
 */
export interface MissionEventReasoningFallback {
  readonly type: 'reasoning-fallback';
  readonly missionId: string;
  readonly seq: number;
  readonly phase: 'requested' | 'answered' | 'timeout';
  readonly reasoning_source: 'DEVELOPMENT_REASONING_FALLBACK';
  readonly external_provider: 'unavailable';
  /**
   * Who actually served the journal. 'GLM_PRIMARY_BUILDER' is the
   * historical Experiment 003 actor; TASK-023's cross-arm isolation serves
   * every request from fresh stateless GLM sessions and labels them
   * 'GLM_FRESH_ISOLATED_SESSION' — the record always names the real actor.
   */
  readonly fallback_actor: 'GLM_PRIMARY_BUILDER' | 'GLM_FRESH_ISOLATED_SESSION';
  readonly tier: string;
  /**
   * TASK-022A: the logical worker instance this call belongs to (present on
   * instance-scoped views only; mission-scope calls, e.g. the reviewer, have
   * none). Maps the event to the instance's journal directory.
   */
  readonly instance?: string;
  readonly waitMs?: number;
  readonly promptChars?: number;
  readonly completionChars?: number;
}

/**
 * G6-01 — Failure classification event. Emitted when a worker, runtime, or
 * verification component classifies a failure using the Section 13 taxonomy.
 * The event records the class (PROVIDER_FAILURE, RUNTIME_FAILURE, etc.), the
 * component that classified it, and a one-line message that has already been
 * scrubbed of secrets. The event is APPEND-ONLY: a mission that fails and
 * recovers emits one failure-classified event per failure, plus a final
 * mission-finished event with the terminal status.
 *
 * This event is the observability hook for future Mission Control: it lets
 * the UI answer "what failed and where?" without chain-of-thought.
 */
export interface MissionEventFailureClassified {
  readonly type: 'failure-classified';
  readonly missionId: string;
  /** The component that classified the failure (worker, runtime, verification). */
  readonly component: 'worker' | 'runtime' | 'verification' | 'orchestrator';
  /** Worker id (when component=worker); undefined for mission-scope failures. */
  readonly workerId?: string;
  /** The Section 13 failure class. */
  readonly failureClass: string;
  /** One-line message (already scrubbed of secrets, capped at 200 chars). */
  readonly message: string;
  /** Whether the component will retry the failed operation. */
  readonly retryable: boolean;
  /** Attempt number within the retry budget (1=first attempt, 2=first retry, etc.). */
  readonly attempt?: number;
}

/**
 * G6-02 — Federation event: a bounded task was delegated to an external
 * A2A agent. Emitted by FederationService when sendMessage succeeds and
 * the remote task id is known. Per Section 28: additive event type;
 * schema is NOT frozen in G6-02.
 */
export interface MissionEventFederationDelegated {
  readonly type: 'federation-delegated';
  readonly missionId?: string;
  readonly externalAgentId: string;
  readonly externalAgentName: string;
  readonly remoteTaskId: string;
  readonly taskChars: number;
}

/** G6-02 — Federation event: remote task state changed (polled). */
export interface MissionEventFederationStateChange {
  readonly type: 'federation-state-change';
  readonly missionId?: string;
  readonly remoteTaskId: string;
  readonly remoteState: string;
}

/** G6-02 — Federation event: terminal result received from the remote agent. */
export interface MissionEventFederationResultReceived {
  readonly type: 'federation-result-received';
  readonly missionId?: string;
  readonly remoteTaskId: string;
  readonly status: string;
  readonly resultChars: number;
  readonly evidenceCount: number;
}

/** G6-02 — Federation event: delegation failed (failure class from G6-01 taxonomy). */
export interface MissionEventFederationFailed {
  readonly type: 'federation-failed';
  readonly missionId?: string;
  readonly remoteTaskId: string;
  readonly failureClass: string;
  readonly message: string;
}

/** G6-02 — Federation event: delegation was cancelled (locally or remotely). */
export interface MissionEventFederationCancelled {
  readonly type: 'federation-cancelled';
  readonly missionId?: string;
  readonly remoteTaskId: string;
  readonly reason: string;
}

/** G6-02 — Federation event union. */
export type MissionEventFederation =
  | MissionEventFederationDelegated
  | MissionEventFederationStateChange
  | MissionEventFederationResultReceived
  | MissionEventFederationFailed
  | MissionEventFederationCancelled;

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
  | MissionEventRepository
  | MissionEventReasoningFallback
  | MissionEventFailureClassified
  | MissionEventFederation
  | WorkerLoopEvent
  | HandoffEvent;

/** The port mission components emit structured events through. */
export interface FlightRecorder {
  record(event: FlightEvent): void;
}

/** Collects events in memory — tests and small inline runs. */
export class MemoryFlightRecorder implements FlightRecorder {
  readonly events: FlightEvent[] = [];
  /**
   * G6-08 (Phase 3 / RC-6): maximum number of events retained. When this cap
   * is reached, the OLDEST event is dropped before each new push. Default:
   * 1000. Set to Infinity (or a large number) for tests that need the full
   * event history.
   */
  readonly maxEvents: number;
  private readonly maxFieldLength: number;

  constructor(opts: { maxEvents?: number; maxFieldLength?: number } = {}) {
    this.maxEvents = opts.maxEvents ?? 1000;
    this.maxFieldLength = opts.maxFieldLength ?? DEFAULT_MAX_FIELD_LENGTH;
  }

  record(event: FlightEvent): void {
    // G6-08 (Phase 3 / RC-6): bound the event log to prevent unbounded memory
    // growth in long-running missions. Each event carries reasoning text,
    // tool payloads, and other payload — without a cap, a single mission
    // could produce thousands of events and exhaust memory.
    if (this.events.length >= this.maxEvents) {
      this.events.shift();  // drop oldest
    }
    // G6-08 (Phase 3 / C-VERIFY-FINDING-009): sanitize events on push to match
    // FileFlightRecorder behavior — secrets should never leak through the
    // in-memory recorder either.
    const sanitized = sanitize(event, this.maxFieldLength) as FlightEvent;
    this.events.push(sanitized);
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
 *
 * G6-01 (P0 H-33): expanded coverage for known provider token formats
 * (GitHub PAT, OpenAI/Azure keys, AWS access keys, generic API keys).
 * Each pattern is anchored to its provider-specific shape to minimize
 * false positives — a generic `key=...` is NOT redacted because it
 * could be a configuration key, not a credential.
 */
const SECRET_PATTERNS: readonly { pattern: RegExp; replacement: string }[] = [
  { pattern: /Bearer\s+[A-Za-z0-9._~+/=-]+/gi, replacement: 'Bearer [redacted]' },
  // GitHub PAT: ghp_<36 chars>, github_pat_<22+ chars>, gho_, ghs_, ghu_
  { pattern: /gh[pousr]_[A-Za-z0-9]{36,}/gi, replacement: 'ghp_[redacted]' },
  { pattern: /github_pat_[A-Za-z0-9_]{22,}/gi, replacement: 'github_pat_[redacted]' },
  // Anthropic: sk-ant-<...> — MUST come before generic sk- to avoid sk-[redacted] masking
  { pattern: /sk-ant-[A-Za-z0-9_-]{20,}/gi, replacement: 'sk-ant-[redacted]' },
  // OpenAI: sk-<48 chars>, sk-proj-<...>
  { pattern: /sk-(?:proj-)?[A-Za-z0-9_-]{20,}/gi, replacement: 'sk-[redacted]' },
  // AWS: AKIA<16 chars> (access key id shape)
  { pattern: /AKIA[0-9A-Z]{16}/g, replacement: 'AKIA[redacted]' },
  // Azure: <key> accounts with generic endings — match only when paired with key-like prefix
  { pattern: /(token|secret|password|api[_-]?key|access[_-]?key|auth[_-]?token)["'=:\s]+[A-Za-z0-9._~+/=-]{8,}/gi, replacement: '$1=[redacted]' },
  { pattern: /(authorization["'=:\s]+)[^\s"',}]+/gi, replacement: '$1[redacted]' },
  // Generic env var assignments: KEY=value where KEY looks like a credential
  { pattern: /\b([A-Z][A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY|APIKEY|ACCESS_KEY|PRIVATE_KEY))\s*=\s*[^\s"'`,}]+/gi, replacement: '$1=[redacted]' },
];

const SECRET_KEY = /(token|secret|password|authorization|api[-_]?key|access[-_]?key|auth[-_]?token|private[-_]?key|credential)/i;

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
